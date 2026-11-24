/**
 * 中继审计日志：**只记元数据，永不记明文**。
 *
 * 企业采购会问三个问题，这一层就是为了答它们：
 *  1. 谁在什么时候从哪台设备发了消息？（`publish`）
 *  2. 谁被拒绝了？（`denied`，含 403/429）
 *  3. 这些记录能不能拿走？（JSONL 一行一条，直接喂 SIEM / 日志平台）
 *
 * 中继本来就看不懂消息内容（端到端加密），所以这份日志天然不含正文 ——
 * 这对企业是卖点，不是限制。
 */

import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AuditEvent {
  /** 事件名：publish / presence / denied / startup / shutdown */
  event: string;
  /** 频道号（由密钥单向派生，反推不出密钥）。 */
  channel?: string;
  /** 发送方设备 id。 */
  device?: string;
  /** 消息 id（不含正文）。 */
  message?: string;
  /** 客户端 IP（可用 includeIp:false 关掉，某些地区 IP 属于个人信息）。 */
  ip?: string;
  /** 密文字节数（用于容量分析，不含内容）。 */
  bytes?: number;
  /** 补充说明，例如被拒绝的原因。 */
  detail?: string;
}

export interface AuditOptions {
  /** 落盘路径；不填就只走 `sink`（stdout）。 */
  path?: string;
  /** 单个文件上限，超过就轮转。 */
  maxBytes?: number;
  /** 保留几个历史文件（`audit.jsonl.1`、`.2`…）。 */
  keep?: number;
  /** 是否记录客户端 IP。 */
  includeIp?: boolean;
  /** 额外输出（一般是 stdout，交给 journald 收集）。 */
  sink?: (line: string) => void;
  now?: () => Date;
}

export class AuditLog {
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly includeIp: boolean;
  /** 串行化写入：保证文件里的顺序与事件发生顺序一致。 */
  private queue: Promise<void> = Promise.resolve();
  private written = 0;

  constructor(private readonly options: AuditOptions = {}) {
    this.maxBytes = Math.max(4 * 1024, options.maxBytes ?? 20 * 1024 * 1024);
    this.keep = Math.max(1, Math.min(options.keep ?? 3, 20));
    this.includeIp = options.includeIp ?? true;
  }

  /** 记一条。永不抛错、永不阻塞调用方 —— 审计不能把正常请求拖垮。 */
  record(event: AuditEvent): void {
    const payload = {
      ts: (this.options.now?.() ?? new Date()).toISOString(),
      event: event.event,
      ...(event.channel ? { channel: event.channel } : {}),
      ...(event.device ? { device: event.device } : {}),
      ...(event.message ? { message: event.message } : {}),
      ...(event.ip && this.includeIp ? { ip: event.ip } : {}),
      ...(typeof event.bytes === 'number' ? { bytes: event.bytes } : {}),
      ...(event.detail ? { detail: event.detail } : {}),
    };
    const line = `${JSON.stringify(payload)}\n`;
    try {
      this.options.sink?.(line.trimEnd());
    } catch {
      // sink 是外部回调，出错不能影响主流程
    }
    const path = this.options.path;
    if (!path) return;
    this.queue = this.queue
      .then(() => this.append(path, line))
      .catch(() => undefined);
  }

  /** 等所有已排队的记录落盘（关服务、测试用）。 */
  async flush(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  /**
   * 读最近若干条（网页控制台用）。
   *
   * 只读当前文件不读轮转出来的历史：控制台是"最近发生了什么"，
   * 要看全量应该去日志平台。返回新的在前。
   */
  async tail(count = 200): Promise<Array<Record<string, unknown>>> {
    const path = this.options.path;
    if (!path) return [];
    await this.flush();
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return [];
    }
    const lines = raw.split('\n').filter((line) => line.trim());
    const limit = Math.max(1, Math.min(Math.floor(count), 1_000));
    const out: Array<Record<string, unknown>> = [];
    for (const line of lines.slice(-limit)) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === 'object') out.push(parsed as Record<string, unknown>);
      } catch {
        // 半行（进程被杀时）跳过
      }
    }
    return out.reverse();
  }

  private async append(path: string, line: string): Promise<void> {
    const bytes = Buffer.byteLength(line);
    if (this.written === 0) {
      // 第一次写之前看一眼现有大小，避免重启后从 0 重新计数
      this.written = await stat(path).then((info) => info.size).catch(() => 0);
    }
    if (this.written + bytes > this.maxBytes) {
      await this.rotate(path);
      this.written = 0;
    }
    await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
    await appendFile(path, line, 'utf8');
    this.written += bytes;
  }

  private async rotate(path: string): Promise<void> {
    for (let index = this.keep; index >= 1; index -= 1) {
      const from = index === 1 ? path : `${path}.${index - 1}`;
      const to = `${path}.${index}`;
      await rename(from, to).catch(() => undefined);
    }
  }
}
