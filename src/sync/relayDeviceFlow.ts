/**
 * 设备码登录（VS Code 扩展用）。
 *
 * 扩展没法接收浏览器的重定向，所以走一圈：
 *  1. 扩展调 `/v1/auth/device/start`，拿到一个 8 位码；
 *  2. 扩展用浏览器打开登录页（带上这个码）；
 *  3. 用户在浏览器里用 GitHub 登录；
 *  4. 服务端给这台设备签发令牌，写进这个码的结果里；
 *  5. 扩展轮询 `/v1/auth/device/poll` 拿到令牌，开始协作。
 *
 * 这是 GitHub CLI 等工具的通行做法，不需要注册自定义 URL scheme，
 * 也不需要用户手动复制粘贴任何字符串。
 */

import { randomBytes } from 'node:crypto';

/** 去掉了 0/O/1/I 这些容易看错的字符。 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface DeviceFlowResult {
  /** 设备明文令牌（只在这里出现一次，库里只存哈希）。 */
  token: string;
  deviceId: string;
  memberId: string;
  memberName: string;
  orgId: string;
  orgName: string;
  grants: Array<{ channelId: string; role: string }>;
}

interface Entry {
  code: string;
  createdAt: number;
  deviceName: string;
  platform: string;
  result?: DeviceFlowResult;
}

export interface DeviceFlowOptions {
  /** 一个码多久失效。默认 10 分钟，够慢吞吞登录一次。 */
  ttlMs?: number;
  /** 内存里最多同时挂多少个未完成的码，防止被刷。 */
  maxPending?: number;
  now?: () => number;
}

export class DeviceFlow {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxPending: number;
  private readonly now: () => number;

  constructor(options: DeviceFlowOptions = {}) {
    this.ttlMs = Math.max(60_000, options.ttlMs ?? 10 * 60_000);
    this.maxPending = Math.max(8, options.maxPending ?? 200);
    this.now = options.now ?? Date.now;
  }

  private newCode(): string {
    const bytes = randomBytes(8);
    let out = '';
    for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
    return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
  }

  /** 起一个待登录的会话。 */
  start(input: { deviceName?: string; platform?: string } = {}): { code: string; expiresIn: number } {
    this.sweep();
    if (this.entries.size >= this.maxPending) {
      // 满了就丢最老的一个：宁可让最早那次重来，也不让内存无上限
      const oldest = [...this.entries.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
      if (oldest) this.entries.delete(oldest.code);
    }
    const code = this.newCode();
    this.entries.set(code, {
      code,
      createdAt: this.now(),
      deviceName: (input.deviceName ?? 'VS Code').slice(0, 80),
      platform: (input.platform ?? 'unknown').slice(0, 20),
    });
    return { code, expiresIn: Math.round(this.ttlMs / 1000) };
  }

  /** 取一个还没过期的会话（浏览器回调里用）。 */
  peek(code: string): Entry | undefined {
    const entry = this.entries.get(normalizeCode(code));
    if (!entry) return undefined;
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(entry.code);
      return undefined;
    }
    return entry;
  }

  /** 登录成功，把结果挂上去等扩展来取。 */
  bind(code: string, result: DeviceFlowResult): boolean {
    const entry = this.peek(code);
    if (!entry || entry.result) return false;
    entry.result = result;
    return true;
  }

  /**
   * 扩展轮询。
   *
   * 取走即失效：同一个码不能换第二次令牌，避免被截获后重复领取。
   */
  poll(code: string): { status: 'pending' | 'ready' | 'expired'; result?: DeviceFlowResult; deviceName?: string } {
    const entry = this.entries.get(normalizeCode(code));
    if (!entry) return { status: 'expired' };
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(entry.code);
      return { status: 'expired' };
    }
    if (!entry.result) return { status: 'pending', deviceName: entry.deviceName };
    this.entries.delete(entry.code);
    return { status: 'ready', result: entry.result };
  }

  /** 清掉过期的（每次 start 顺带扫一遍）。 */
  sweep(): void {
    const now = this.now();
    for (const [code, entry] of this.entries) {
      if (now - entry.createdAt > this.ttlMs) this.entries.delete(code);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** 用户可能带空格或小写粘贴，统一成大写并去掉分隔符。 */
function normalizeCode(code: string): string {
  const clean = code.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
