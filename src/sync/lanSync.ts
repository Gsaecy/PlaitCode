/**
 * 局域网跨平台对齐：网络层（HTTP + UDP 发现）与状态维护。
 *
 * 设计取舍（写给以后的自己和评审）：
 *
 * 1. **不引入依赖**。只用 Node 自带的 `http` / `dgram` / `crypto` / `os`：这个扩展
 *    的卖点之一是「装上就能用」，为一个可选功能加 native 依赖不值得。
 * 2. **每台设备都开一个监听**，而不是让对端轮询。轮询要么延迟高、要么请求多；
 *    而「每台机器自己一个端口」在同一 WiFi 里并不冲突（IP 不同）。主机负责转发。
 * 3. **配对码是唯一凭据**，每个请求都要带。同一个 WiFi 上的陌生设备扫到端口也进不来。
 * 4. **网络输入全部当作不可信**：`parseSyncMessage` 卡长度 + 校验形状，处理器只认
 *    校验通过的对象；任何异常都只在日志里留一行，绝不让它冒到面板。
 * 5. **默认关闭**（`hwchat.lanSync.enabled` 默认 false），不影响现有任何功能。
 */

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { hostname, networkInterfaces, platform as osPlatform } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ALIGNMENT_FILE,
  MAX_GROUP_MESSAGES,
  MAX_MESSAGE_BYTES,
  MAX_NOTES,
  MAX_PEERS,
  SYNC_PROTOCOL_VERSION,
  buildLedger,
  describeSyncState,
  findDivergences,
  groupAgreement,
  makeGroupMessage,
  makeNote,
  makeReport,
  makeRequirement,
  pairingMatches,
  parseSyncMessage,
  renderGroupLine,
  renderGroupTranscript,
  renderLedger,
  shouldAutoRespond,
  type GroupPhase,
  type ReportStatus,
  type SyncGroupMessage,
  type SyncApprovalMessage,
  type SyncControlMessage,
  type RemotePreset,
  type SyncMessage,
  type SyncNote,
  type SyncPeer,
  type SyncPlatform,
  type SyncReport,
  type SyncRequirement,
} from './lanProtocol';
import {
  MOBILE_COOKIE,
  MOBILE_PATH,
  MOBILE_SESSION_TTL_MS,
  MobileGate,
  mobileCookie,
  parseCookies,
  renderMobilePage,
  type MobileApprovalView,
  type MobileStatePayload,
} from './mobileControl';

/** 手机上挂着的审批卡最多等这么久，过期就按「拒绝」收尾，免得线程一直挂着。 */
const REMOTE_APPROVAL_TTL_MS = 3 * 60_000;

export interface LanSyncBridge {
  /** 本机这一轮的身份（名称、平台、项目、扩展版本）。 */
  peer(): SyncPeer;
  /** 收到对端需求时让面板开跑；返回 false 表示现在没法跑（面板在忙）。 */
  runRequirement(requirement: SyncRequirement): Promise<boolean>;
  /**
   * 收到对端的协作消息时交给本机 agent。
   *
   * 返回 false 表示面板正忙、消息已记录但没进对话 —— 这时它还在 `recentNotes()`
   * 里，用户或 agent 下次 `team_sync status` 能看到，不会丢。
   */
  runNote?(note: SyncNote): Promise<boolean>;
  /**
   * 群里出现了新发言（包括自己的）：面板把它追加到对话里，用户就能像看群一样看整个过程。
   *
   * 失败不影响同步本身：记录文件照样写，用户仍能在 `docs/TEAM-CHAT.md` 里回看。
   */
  onGroupMessage?(message: SyncGroupMessage): Promise<void>;
  /**
   * 有一台陌生设备想连进来，问一下用户。
   *
   * 这是「傻瓜式」的关键：用户不用抄配对码，只要在弹窗上点一次「允许」。
   * 返回 true 之后这台设备会被记住，以后自动重连不再询问。
   */
  approvePeer?(peer: SyncPeer): Promise<boolean>;
  /** 把账本写进工作区（没有工作区时由实现方决定写到哪 / 跳过）。 */
  writeLedger(markdown: string): Promise<void>;
  /** 把团队群记录写进工作区。 */
  writeTranscript(markdown: string): Promise<void>;
  /** 日志（输出通道）。 */
  log(line: string, level?: 'info' | 'warn'): void;
  /** 状态变化时刷新状态栏。 */
  onState?: () => void;
  /**
   * 手机发来的一句话：走和群窗口完全相同的入口（判断「回答追问还是新需求」、广播、开跑）。
   *
   * 不在网络层重复实现这套判断 —— 两处判断迟早会不一致，那正是「手机说的和电脑说的不一样」的根因。
   */
  onMobileMessage?(text: string): Promise<{ ok: boolean; message: string }>;
  /** 手机上是否允许批准工具授权（用户可在设置里关掉，关掉后手机只能看和说话）。 */
  canApproveFromPhone?(): boolean;
  /**
   * 本机**新产生**的一条消息（需求 / 报告 / 协作消息 / 群发言）。
   *
   * 局域网模式下它已经自己广播了；跨网中继模式下由这一条钩子把密文送去中转。
   * 只在「本机产生」时调用，收到别人的消息不会再触发，避免回声。
   *
   * 返回值就是**送达凭据**：没连中继要如实说 `ok: false`，
   * 不能静默丢弃——否则 agent 会把「发出去了」当成「对方收到了」，两台设备各说各的。
   */
  onOutgoing?(message: SyncMessage): Promise<{ ok: boolean; message: string }> | void;
  /**
   * 中继上收到「甲方在群里发的需求」：本机要真的开跑。
   *
   * 与 `onMobileMessage` 的区别：那条会**再广播一次**（局域网里由本机转发），
   * 这条不会 —— 中继已经把消息发给所有设备了，再广播就是环。
   */
  onRelayUserMessage?(text: string): Promise<void> | void;
  /**
   * 手机发来的远程控制：改权限档位 / 改步数 / 中止当前任务。
   *
   * 返回一句给人看的结果（手机上会显示）。
   */
  onRemoteControl?(control: {
    action: 'preset' | 'steps' | 'stop' | 'state';
    preset?: RemotePreset;
    steps?: number;
  }): Promise<{ ok: boolean; message: string }>;
  /** 向频道广播「本机当前的权限档位 / 步数 / 是否在跑」，手机据此显示真实状态。 */
  onBroadcastControl?(state: { preset: RemotePreset; steps: number; running: boolean }): void;
}

export type LanSyncRole = 'off' | 'hub' | 'peer';

/** 只依赖 dispose()，不 import vscode —— 这样整个网络层能在 Node 里直接跑测试。 */
export interface Disposable {
  dispose(): void;
}

interface PersistedState {
  pairingCode?: string;
  requirements: SyncRequirement[];
  reports: SyncReport[];
  notes?: SyncNote[];
  /** 团队群发言。 */
  group?: SyncGroupMessage[];
  /** 已经被用户允许过的设备 id：重连不再打扰。 */
  approved?: string[];
  /** 上次的角色与主机地址：下次开窗口自动恢复连接。 */
  role?: 'hub' | 'peer';
  hub?: string;
  port?: number;
}

const STATE_LIMIT = 300;
const REQUEST_TIMEOUT_MS = 4_000;
const BODY_LIMIT = MAX_MESSAGE_BYTES + 16 * 1024;
const DISCOVER_MAGIC = 'PLAITCODE-SYNC-DISCOVER/1';
const HUB_MAGIC = 'PLAITCODE-SYNC-HUB/1';

function platformOf(value: string): SyncPlatform {
  return value === 'win32' || value === 'darwin' ? value : 'linux';
}

/** 本机所有非回环 IPv4 地址（用于告诉对端「来这个地址找我」）。 */
export function lanAddresses(): string[] {
  const result: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) result.push(entry.address);
    }
  }
  return result;
}

function isIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * 每张网卡的子网定向广播地址（如 `192.168.1.255`）。
 *
 * 只发 `255.255.255.255` 时，多网卡机器会让系统挑一张网卡出去，路由器也常直接丢弃；
 * 定向到本网段才是同一 WiFi 下最稳的一条路。
 */
export function subnetBroadcasts(): string[] {
  const result = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !entry.netmask) continue;
      if (!isIPv4(entry.address) || !isIPv4(entry.netmask)) continue;
      const address = entry.address.split('.').map(Number);
      const mask = entry.netmask.split('.').map(Number);
      result.add(address.map((part, index) => (part & (mask[index] ?? 0)) | (~(mask[index] ?? 0) & 255)).join('.'));
    }
  }
  return [...result];
}

/** 发现包的收件人：全局广播 + 各网段定向广播。 */
function broadcastTargets(): string[] {
  return ['255.255.255.255', ...subnetBroadcasts()];
}

/** 这个地址是不是本机自己的（用来避开「自己加入自己」）。 */
function isOwnAddress(value: string): boolean {
  if (!value) return false;
  if (value === '127.0.0.1' || value === 'localhost' || value === '::1') return true;
  return lanAddresses().includes(value);
}

/**
 * 两台都点了按钮、各自成了主机时，谁该让位。
 *
 * 规则：id 大的让位，id 小的继续当主机。只让一边让，不会两边同时让步。
 * **旧版广播里没有 `peer` 字段，也不会让位** —— 这时本机无条件让，
 * 否则两边会永远对着待命。
 */
export function yieldDecision(selfId: string, otherPeerId: unknown): 'stay' | 'yield' {
  if (typeof otherPeerId !== 'string' || !otherPeerId) return 'yield';
  if (otherPeerId === selfId) return 'stay';
  return selfId > otherPeerId ? 'yield' : 'stay';
}

/** 邀请码字符集：去掉了 0/O、1/I 这类抄写时容易看错的字符。 */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_LENGTH = 6;

/**
 * 发现端口：双方约定的**固定会合点**。
 *
 * 不能跟着 HTTP 端口走 —— HTTP 端口被占用时会自动换成系统分配的值，
 * 一旦发现端口也跟着漂，两台设备就再也找不到彼此了。
 */
const DISCOVERY_PORT = 47_821;

/** 生成邀请码（6 位，人可抄写）。传 `random` 便于测试固定输出。 */
export function makeInviteCode(random: () => number = Math.random): string {
  let code = '';
  for (let index = 0; index < INVITE_LENGTH; index += 1) {
    code += INVITE_ALPHABET[Math.floor(random() * INVITE_ALPHABET.length)] ?? 'A';
  }
  return code;
}

/** 用户手抄常带小写和空格，统一成大写再去比对。 */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export class LanSyncService implements Disposable {
  private server?: Server;
  private udp?: UdpSocket;
  private role: LanSyncRole = 'off';
  /** HTTP 实际监听端口：被占用时会换成系统分配的端口。 */
  private port = 47821;
  /**
   * 用户配置的端口，UDP 发现固定用它。
   *
   * 发现必须有一个双方都知道的固定端口，所以它不能跟着 HTTP 端口漂 ——
   * 否则端口一换，对端就再也找不到这台机器。
   */
  private configuredPort = 47821;
  private hubAddress = '';
  private code = '';
  private requirements: SyncRequirement[] = [];
  private reports: SyncReport[] = [];
  private notes: SyncNote[] = [];
  /** 团队群的全部发言（需求 / 解析 / 进度 / 结果）。 */
  private group: SyncGroupMessage[] = [];
  /** 用户点过「允许」的设备。重连时直接放行，不再弹窗。 */
  private approved = new Set<string>();
  /** 上次的角色与主机：下次激活自动恢复（用户不用重复操作）。 */
  private lastRole: 'hub' | 'peer' = 'hub';
  private lastHub = '';
  private lastPort = 0;
  /** 正在让位给另一台主机：避免重复触发。 */
  private yielding = false;
  /** 本机群聊的邀请码（主机才有值）。空串表示这不是一个「等邀请码的群聊」。 */
  private inviteCode = '';
  /**
   * UDP 发现端口（固定，不随 HTTP 端口变化）。
   * 可注入只是为了让测试在同一台机器上跑；生产永远用 `DISCOVERY_PORT`。
   */
  readonly discoveryPort: number = DISCOVERY_PORT;
  private readonly peers = new Map<string, { peer: SyncPeer; address: string }>();
  private disposed = false;
  private announceTimer?: NodeJS.Timeout;
  /** 手机遥控是否开启。开着时即使没做双机同步也保留监听（单机也能用手机指挥）。 */
  private mobileEnabled = false;
  private readonly gate = new MobileGate();
  private readonly approvals = new Map<string, { view: MobileApprovalView; resolve: (allow: boolean) => void; timer: NodeJS.Timeout }>();
  /** 本地 id → 线上 id / 反向（桌面用本地 id 收卡，跨网手机用线上 id）。 */
  private readonly localToWire = new Map<string, string>();
  private readonly wireToLocal = new Map<string, string>();
  private approvalSequence = 0;

  constructor(
    private readonly storagePath: string,
    private readonly bridge: LanSyncBridge,
  ) {}

  /** 读取持久化的配对码与历史记录（同步调用，避免每次判断都要 await）。 */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      this.code = typeof parsed.pairingCode === 'string' ? parsed.pairingCode : '';
      this.requirements = Array.isArray(parsed.requirements)
        ? parsed.requirements.map((item) => parseSyncMessage(item)).filter((item): item is SyncRequirement => item?.kind === 'requirement')
        : [];
      this.reports = Array.isArray(parsed.reports)
        ? parsed.reports.map((item) => parseSyncMessage(item)).filter((item): item is SyncReport => item?.kind === 'report')
        : [];
      this.notes = Array.isArray(parsed.notes)
        ? parsed.notes.map((item) => parseSyncMessage(item)).filter((item): item is SyncNote => item?.kind === 'note').slice(-MAX_NOTES)
        : [];
      this.group = Array.isArray(parsed.group)
        ? parsed.group.map((item) => parseSyncMessage(item)).filter((item): item is SyncGroupMessage => item?.kind === 'group').slice(-MAX_GROUP_MESSAGES)
        : [];
      this.approved = new Set(Array.isArray(parsed.approved)
        ? parsed.approved.filter((item): item is string => typeof item === 'string').slice(0, 32)
        : []);
      this.lastRole = parsed.role === 'peer' ? 'peer' : 'hub';
      this.lastHub = typeof parsed.hub === 'string' ? parsed.hub : '';
      this.lastPort = typeof parsed.port === 'number' && parsed.port > 0 ? parsed.port : 0;
    } catch {
      // 第一次运行没有文件，正常。
    }
    if (!this.code) {
      this.code = randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})(?!$)/, '$1-');
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const state: PersistedState = {
      pairingCode: this.code,
      requirements: this.requirements.slice(-STATE_LIMIT),
      reports: this.reports.slice(-STATE_LIMIT * 3),
      notes: this.notes.slice(-MAX_NOTES),
      group: this.group.slice(-MAX_GROUP_MESSAGES),
      approved: [...this.approved],
      role: this.lastRole,
      hub: this.lastHub,
      port: this.lastPort,
    };
    try {
      await mkdir(dirname(this.storagePath), { recursive: true });
      await writeFile(this.storagePath, JSON.stringify(state), 'utf8');
    } catch (error) {
      this.bridge.log(`[sync] 保存状态失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  pairingCode(): string {
    return this.code;
  }

  /**
   * **一键连接**：这是给用户的唯一入口，不需要懂主机/从机/配对码。
   *
   * 行为按「哪边先点」自动兜底：
   *  - 同一个 WiFi 里已经有主机 → 直接加入（对端弹一次「允许吗」，点允许即可）；
   *  - 没有主机 → 自己成为主机待命，并提示另一台设备也点同一个按钮。
   *
   * 每台设备都点同一个按钮，谁先谁后都能连上 —— 这就是「傻瓜式」的核心。
   */
  /** 记住用户配置的端口：UDP 发现立刻换过去，HTTP 端口随后由 startListener 调成实际值。 */
  private usePort(port: number): void {
    const value = port > 0 ? port : this.configuredPort;
    this.configuredPort = value;
    this.port = value;
  }

  async autoConnect(port?: number): Promise<{ ok: boolean; message: string; role: LanSyncRole }> {
    const targetPort = port && port > 0 ? port : (this.lastPort || this.configuredPort);
    this.usePort(targetPort);
    // 先在局域网里找已有主机（多试几次，给对方一点启动时间）。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const found = await this.discover();
      if (found) {
        const joined = await this.joinHub(found, targetPort);
        if (joined.ok) {
          this.lastRole = 'peer';
          this.lastHub = found;
          this.lastPort = targetPort;
          await this.persist();
          return { ok: true, message: joined.message, role: 'peer' };
        }
        this.bridge.log(`[sync] 找到主机但加入失败：${joined.message}`, 'warn');
      }
    }
    const started = await this.startHub(targetPort);
    if (started.ok) {
      this.lastRole = 'hub';
      this.lastHub = '';
      this.lastPort = targetPort;
      await this.persist();
      return { ok: true, message: started.message, role: 'hub' };
    }
    return { ok: false, message: started.message, role: 'off' };
  }

  /** 上次连接的角色与地址（启动时自动恢复用）。 */
  lastConnection(): { role: 'hub' | 'peer'; hub: string; port: number } {
    return { role: this.lastRole, hub: this.lastHub, port: this.lastPort };
  }

  /**
   * 恢复到上次的连接状态。
   *
   * 用户不用每次开窗口都点一遍：上次是主机就继续当主机，上次加入了某台就继续连那台
   * （连不上就退回「成为主机待命」，绝不会卡在一个失败的连接上）。
   */
  async resume(port?: number): Promise<{ ok: boolean; message: string; role: LanSyncRole }> {
    const last = this.lastConnection();
    const targetPort = port && port > 0 ? port : (last.port || this.port);
    if (last.role === 'peer' && last.hub) {
      const joined = await this.joinHub(last.hub, targetPort);
      if (joined.ok) return { ok: true, message: joined.message, role: 'peer' };
      this.bridge.log(`[sync] 上次的主机没响应（${last.hub}），改为本机待命`, 'warn');
    }
    const started = await this.startHub(targetPort);
    return { ok: started.ok, message: started.message, role: started.ok ? 'hub' : 'off' };
  }

  /** 本机身份（面板拼「按本机平台做等价实现」时用）。 */
  localPeer(): SyncPeer {
    return this.bridge.peer();
  }

  /**
   * 中继收到的一条消息：并入本机状态。
   *
   * 用 `relay: false`：中继已经把它发给所有设备了，这里再转发就是回路。
   */
  async ingestRelayMessage(message: SyncMessage): Promise<void> {
    /*
     * 审批决定走独立分支：它不是"项目讨论"，不进群记录、也不触发 agent。
     * 混进 applyMessage 会让看板把一张授权卡当成进度。
     */
    if (message.kind === 'approval') {
      this.ingestRelayApproval(message);
      return;
    }
    if (message.kind === 'control') {
      await this.ingestRelayControl(message);
      return;
    }
    /*
     * 手机（或另一台设备）以**甲方**身份在群里发的需求，本机也要真的开跑。
     *
     * 群消息本身不触发执行（那是防「两个 agent 互相接龙」的设计），但甲方发的话
     * 是唯一的例外：他说要做，就得做。上层用 `origin: 'sync'` 交出去，本机**不会**
     * 再广播一次 —— 手机已经通过中继广播过了，再发就是环。
     *
     * 去重按 id：同一条消息被重复投递（断线重连）时只开跑一次。
     *
     * **指派**：消息带 `assignee` 时只有被指派的那台跑 —— 一个人两台电脑接力时，
     * 不说清谁做就是两边各做一遍，改动还会互相覆盖。没带 assignee 才按旧行为全都跑。
     */
    const fresh = message.kind === 'group' && !this.group.some((item) => item.id === message.id);
    await this.applyMessage(message, { relay: false });
    if (!fresh || message.kind !== 'group') return;
    if (message.author !== 'user' || message.phase !== 'requirement') return;
    if (message.from.id === this.bridge.peer().id) return;
    if (message.assignee && message.assignee !== this.bridge.peer().id) {
      this.bridge.log(`[relay] 这条需求指派给 ${message.assignee}，本机不执行`);
      return;
    }
    try {
      await this.bridge.onRelayUserMessage?.(message.body);
    } catch (error) {
      this.bridge.log(`[relay] 处理甲方需求失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  /**
   * 中继上收到 **远程控制** 指令（改权限档位 / 改步数 / 中止）。
   *
   * 只接受「允许手机批准授权」开启时的指令：这是同一条信任边界的延伸，
   * 关掉后手机只能看和说话，不能动电脑上的权限。
   */
  private async ingestRelayControl(message: SyncControlMessage): Promise<void> {
    if (message.from.id === this.bridge.peer().id) return;
    if (message.action === 'state') {
      /* 手机在问「你现在是什么设置」：直接把真实状态广播回去。 */
      if (this.bridge.canApproveFromPhone?.() ?? false) {
        const result = await this.bridge.onRemoteControl?.({ action: 'state' });
        if (result) this.bridge.log(`[relay] 已回复手机的状态查询：${result.message}`);
      }
      return;
    }
    if (!(this.bridge.canApproveFromPhone?.() ?? false)) {
      this.bridge.log(`[relay] 收到远程控制（${message.action}），但本机没允许手机操作，已忽略`, 'warn');
      return;
    }
    const apply = this.bridge.onRemoteControl;
    if (!apply) return;
    try {
      const result = await apply({
        action: message.action,
        ...(message.preset ? { preset: message.preset } : {}),
        ...(message.steps !== undefined ? { steps: message.steps } : {}),
      });
      this.bridge.log(`[relay] 远程控制 ${message.action}：${result.message}`);
    } catch (error) {
      this.bridge.log(`[relay] 远程控制失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  /**
   * 中继上收到一条**审批决定**：结算本机挂着的授权卡。
   *
   * 只认自己名下的卡（id 带本机设备前缀），别的设备的卡不归这里管。
   * 已经处理过 / 过期的不再结算 —— 桌面弹窗可能抢先点了。
   */
  private ingestRelayApproval(message: SyncApprovalMessage): void {
    if (message.phase !== 'decision') return;
    if (message.from.id === this.bridge.peer().id) return;
    const applied = this.resolveApproval(message.id, message.allow === true);
    this.bridge.log(
      `[relay] 来自 ${message.from.name} 的授权：${message.allow ? '允许' : '拒绝'} ${message.id}`
      + (applied ? '' : '（这张卡已处理或已过期，或不属于本机）'),
    );
  }

  /**
   * 把「当前权限档位 / 步数 / 是否在跑」广播给频道。
   *
   * 手机不是猜的：它显示的一定是电脑上真实生效的值。
   * 走 control 通道而不是群消息，避免把设置变更写进项目讨论记录。
   */
  broadcastControl(state: { preset: RemotePreset; steps: number; running: boolean }): void {
    this.relayOut({
      kind: 'control',
      id: `ctl-${this.bridge.peer().id.slice(0, 16)}-${Date.now().toString(36)}`,
      from: this.bridge.peer(),
      action: 'state',
      preset: state.preset,
      steps: state.steps,
      running: state.running,
      at: Date.now(),
    });
  }

  /** 本机产生的消息交给中继（没接中继时是空操作）。 */
  /**
   * 把一条消息送去中继，并把**真实结果**带回来。
   *
   * 这里以前是空操作：没连中继就直接 return，消息无声消失。
   * 结果就是用户遇到的那种局面——一边说「已同步」，另一边什么都没有，
   * 而两边都拿不出证据。现在无论成没成都必须有一句话。
   */
  private async relayOut(message: SyncMessage): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.bridge.onOutgoing?.(message);
      if (!result) return { ok: false, message: '没有配置中继，这条只留在本机' };
      return result;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.bridge.log(`[relay] 发送失败：${text}`, 'warn');
      return { ok: false, message: `中继发送失败：${text}` };
    }
  }

  /* ------------------------------------------------------------------ *
   * 手机遥控
   * ------------------------------------------------------------------ */

  /**
   * 开 / 关手机遥控。
   *
   * 关键点：**单机也要能开**。用户可能只有一台电脑，手机只是遥控器；
   * 所以这里不依赖 `role`，只要开着就保留监听。
   */
  async setMobileControl(enabled: boolean, port?: number): Promise<{ ok: boolean; message: string; url?: string }> {
    this.mobileEnabled = enabled;
    if (port && port > 0) this.usePort(port);
    if (!enabled) {
      this.gate.revokeAll();
      for (const id of [...this.approvals.keys()]) this.resolveApproval(id, false);
      if (this.role === 'off') this.stopListener();
      this.bridge.onState?.();
      return { ok: true, message: '手机遥控已关闭。' };
    }
    try {
      await this.ensureListener();
    } catch (error) {
      this.mobileEnabled = false;
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `手机遥控启动失败：${message}（端口 ${this.port} 可能被占用）` };
    }
    const code = this.gate.issueCode();
    this.bridge.onState?.();
    return {
      ok: true,
      message: `手机遥控已打开：同一 WiFi 下打开 ${this.mobileUrl()} 并输入 ${code.code}，或直接扫二维码。`,
      url: this.mobileUrl(),
    };
  }

  mobileAllowed(): boolean {
    return this.mobileEnabled;
  }

  /**
   * 手机要打开的那个地址。
   *
   * 一台机器常有好几个局域网地址（WiFi + 有线 + WSL/Hyper-V/VMware 虚拟网卡），
   * 取"第一个"经常取到虚拟网卡，手机根本连不上。所以按常见家庭/办公网段排序，
   * 面板上再把其余地址列出来当备选。
   */
  mobileUrl(): string {
    const all = lanAddresses();
    const score = (ip: string): number => {
      if (ip.startsWith('192.168.')) return 0;
      if (ip.startsWith('10.')) return 1;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
      if (ip.startsWith('169.254.')) return 4;
      return 3;
    };
    const address = [...all].sort((left, right) => score(left) - score(right))[0] ?? '127.0.0.1';
    return `http://${address}:${this.port}${MOBILE_PATH}`;
  }

  /** 带码的地址：拼成二维码，手机扫一下就进（不用手输 6 位）。 */
  mobileUrlWithCode(): string {
    const code = this.gate.currentCode().code;
    return `${this.mobileUrl()}?c=${code}`;
  }

  mobileInfo(): { enabled: boolean; url: string; qrText: string; code: string; expiresAt: number; sessions: number; addresses: string[] } {
    const current = this.gate.currentCode();
    return {
      enabled: this.mobileEnabled,
      url: this.mobileUrl(),
      qrText: `${this.mobileUrl()}?c=${current.code}`,
      code: current.code,
      expiresAt: current.expiresAt,
      sessions: 0,
      addresses: lanAddresses().map((address) => `http://${address}:${this.port}${MOBILE_PATH}`),
    };
  }

  /** 换一张新码（旧码立刻作废）。 */
  rotateMobileCode(): string {
    return this.gate.rotate().code;
  }

  /** 手机页面轮询的状态：成员 / 发言 / 未答追问 / 待审批。 */
  mobileState(): MobileStatePayload {
    const base = this.groupState();
    return {
      device: this.bridge.peer().name,
      role: this.role,
      peers: base.peers,
      messages: base.messages.slice(-60),
      ...(base.openQuestion ? { openQuestion: base.openQuestion } : {}),
      approvals: [...this.approvals.values()].map((entry) => entry.view),
      canApprove: this.bridge.canApproveFromPhone?.() ?? false,
    };
  }

  /** 手机上是否允许批准授权（用户在设置里可关）。 */
  remoteApprovalEnabled(): boolean {
    return this.mobileEnabled && (this.bridge.canApproveFromPhone?.() ?? false);
  }

  /**
   * 登记一张「等手机/电脑谁来批」的授权卡。
   *
   * 返回的 Promise 由**先到的一方**结算：手机点「允许」或电脑上点「允许」都行；
   * 三分钟没人处理就自动按拒绝收尾，绝不让工具线程一直挂着。
   */
  awaitApproval(
    input: { title: string; summary: string; detail: string; risk: MobileApprovalView['risk'] },
    id = `m-${++this.approvalSequence}`,
  ): Promise<boolean> {
    /* 线上 id 带设备前缀：两台电脑都可能有 approval-7，不带前缀会互相销卡。 */
    const wireId = `${this.bridge.peer().id.slice(0, 20)}:${id}`.slice(0, 64);
    this.localToWire.set(id, wireId);
    this.wireToLocal.set(wireId, id);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.resolveApproval(id, false), REMOTE_APPROVAL_TTL_MS);
      timer.unref?.();
      this.approvals.set(id, {
        // 局域网手机页看到的仍是原 id（行为不变）；跨网手机看到的是 wireId
        view: { id, at: Date.now(), ...input },
        resolve,
        timer,
      });
      /*
       * 跨网时把这张卡广播出去：手机不在同一个 WiFi，只能经中继看到它。
       * 局域网/中继都可能没连，`onOutgoing` 内部是空操作，不影响本机弹窗。
       * 授权细节（要跑的命令）不写进群记录，只走这条专用消息。
       */
      void this.bridge.onOutgoing?.({
        kind: 'approval',
        id: wireId,
        from: this.bridge.peer(),
        phase: 'request',
        title: input.title,
        summary: input.summary,
        detail: input.detail,
        risk: input.risk,
        at: Date.now(),
      });
    });
  }

  /** 结算一张授权卡；返回 false 表示它已经不在（被抢先处理或过期了）。 */
  resolveApproval(id: string, allow: boolean): boolean {
    /* 三个入口都会来：桌面/局域网手机用本地 id，跨网手机用带前缀的线上 id。 */
    const local = this.approvals.has(id) ? id : this.wireToLocal.get(id);
    if (!local) return false;
    const entry = this.approvals.get(local);
    if (!entry) return false;
    this.approvals.delete(local);
    const wire = this.localToWire.get(local);
    if (wire) this.wireToLocal.delete(wire);
    this.localToWire.delete(local);
    clearTimeout(entry.timer);
    entry.resolve(allow);
    return true;
  }

  /** 当前挂着几张待批（状态栏提示用）。 */
  pendingApprovalCount(): number {
    return this.approvals.size;
  }

  /**
   * 设置配对码。
   *
   * 所有设备必须填**同一个**值才能互通：这是唯一的凭据，也是「同一个 WiFi 上
   * 有陌生设备」时唯一的防线。由用户在设置里填，或加入时按主机显示的那串填。
   */
  async setPairingCode(code: string): Promise<void> {
    const value = code.trim().toUpperCase();
    if (!value) return;
    this.code = value;
    await this.persist();
  }

  state(): { role: LanSyncRole; peers: number; requirements: number; divergences: number; address: string; text: string } {
    const rows = buildLedger(this.requirements, this.reports);    const divergences = findDivergences(rows).length;
    return {
      role: this.role,
      peers: this.role === 'off' ? 0 : this.peers.size + (this.role === 'hub' ? 1 : 1),
      requirements: rows.length,
      divergences,
      address: this.role === 'hub' ? `:${this.port}` : this.hubAddress,
      text: describeSyncState({
        role: this.role,
        peers: this.role === 'off' ? 0 : this.peers.size + 1,
        requirements: rows.length,
        divergences,
      }),
    };
  }

  /**
   * 成为主机（host）。
   *
   * 主机同时是「转运站」和「参与者」：自己也会收到并执行需求，并且负责把需求
   * 转发给所有已登记的设备。
   */
  async startHub(port = this.configuredPort): Promise<{ ok: boolean; message: string }> {
    if (this.role === 'hub' && this.server) return { ok: true, message: `已在主机模式（:${this.port}）` };
    this.stopListener();
    this.usePort(port);
    try {
      await this.startListener();
      await this.startDiscovery();
      this.role = 'hub';
      this.hubAddress = '';
      this.bridge.log(`[sync] 主机已启动，端口 ${this.port}（发现端口 ${this.configuredPort}），配对码 ${this.code}`);
      this.bridge.onState?.();
      return {
        ok: true,
        message: `主机已启动。同一 WiFi 的另一台设备点一次「连接另一台设备」就能加入；配对码 ${this.code}。`,
      };
    } catch (error) {
      this.role = 'off';
      const message = error instanceof Error ? error.message : String(error);
      this.bridge.log(`[sync] 启动主机失败：${message}`, 'warn');
      return { ok: false, message: `启动主机失败：${message}` };
    }
  }

  /** 本机群聊的邀请码；不是主机时为空串。 */
  currentInviteCode(): string {
    return this.inviteCode;
  }

  /**
   * 启动群聊：生成邀请码并成为主机，等别人填码进来。
   *
   * 这是新的、也是唯一的开群入口 —— 不做「自动找设备然后互相比谁让位」那一套。
   * 谁开群谁当主机，谁想进来谁填码，角色永远清楚。
   */
  async startGroup(port?: number): Promise<{ ok: boolean; message: string; code?: string }> {
    const code = makeInviteCode();
    const started = await this.startHub(port);
    if (!started.ok) {
      this.inviteCode = '';
      return { ok: false, message: started.message };
    }
    this.inviteCode = code;
    // 立刻用新码广播一次，别让从机等下一个周期。
    this.announceNow();
    this.bridge.log(`[sync] 群聊已开，邀请码 ${code}`);
    this.bridge.onState?.();
    return { ok: true, code, message: `群聊已开。让另一台设备「加入群聊」并填邀请码 ${code}。` };
  }

  /**
   * 填邀请码加入群聊。
   *
   * 邀请码既用来**找到**群（广播里带码），也用来**通过**主机的校验 ——
   * 用户只需要抄一个 6 位码，不需要知道 IP、端口、配对码。
   *
   * `address` 只在广播被拦时兜底（高级用法 / 测试），正常路径不要传。
   */
  async joinGroup(code: string, port?: number, address?: string): Promise<{ ok: boolean; message: string }> {
    const wanted = normalizeInviteCode(code);
    if (!wanted) return { ok: false, message: '请填写邀请码。' };
    this.usePort(port ?? this.configuredPort);
    this.stopListener();
    try {
      await this.startListener();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `本机监听失败：${message}` };
    }
    const typed = address?.trim();
    const target = typed ? normalizeHubAddress(typed, this.port) : await this.discover(wanted);
    if (!target) {
      this.role = 'off';
      this.stopListener();
      return {
        ok: false,
        message: `没找到邀请码 ${wanted} 的群聊。请确认另一台电脑已经点了「启动群聊」，并且两台在同一个 WiFi。`,
      };
    }
    return this.finishJoin(target, wanted);
  }

  /**
   * 主机那边记着自己是哪个群，所以重复加入要被认出来。
   *
   * 「一个设备只能进一次」：同一台设备再填一次码，不能变成两台。
   * 设备身份用本机稳定 id（`localPeer`），换机器才会变。
   */
  /**
   * 配对请求：**保留服务端给的原因**。
   *
   * `postJson` 会把 4xx 统一吞成 undefined，于是「邀请码不对」和「主机没响应」
   * 在界面上变成同一句话 —— 前者要用户重新抄码，后者要检查网络，不能混。
   */
  private async pairRequest(
    target: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
    try {
      const text = await postRaw(target, '/hwchat-sync/v1/pair', JSON.stringify(body));
      const data = JSON.parse(text) as Record<string, unknown>;
      return { ok: true, data };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const match = raw.match(/\{"ok":false,"error":"([^"]*)"\}/);
      return { ok: false, error: match?.[1] || raw.slice(0, 160) };
    }
  }

  private async finishJoin(target: string, code: string): Promise<{ ok: boolean; message: string }> {
    const answer = await this.pairRequest(target, {
      protocol: SYNC_PROTOCOL_VERSION,
      code,
      peer: this.bridge.peer(),
      port: this.port,
    });
    if (!answer.ok) {
      this.role = 'off';
      this.stopListener();
      const reason = answer.error ?? '';
      // 邀请码错与连不上，用户要做的事完全不同，分开说。
      if (/邀请码/.test(reason)) {
        return { ok: false, message: `加入失败：${reason}。请核对另一台电脑上显示的邀请码。` };
      }
      return { ok: false, message: `加入失败：这台电脑连不上 ${target}（${reason || '没有响应'}）。请确认两台在同一个 WiFi。` };
    }
    const response = answer.data ?? {};
    if (Array.isArray(response.peers)) this.absorbPeers(response.peers);
    this.role = 'peer';
    this.hubAddress = target;
    this.inviteCode = '';
    this.bridge.log(`[sync] 已加入群聊 ${target}（邀请码 ${code}）`);
    this.bridge.onState?.();
    if (response.already === true) {
      return { ok: true, message: '这台已经在群里了。' };
    }
    return { ok: true, message: '已加入群聊。两台设备会一起执行群里的需求。' };
  }

  /** 立刻广播一次（邀请码变了、刚开群时用）。 */
  private announceNow(): void {
    const payload = Buffer.from(JSON.stringify({
      magic: HUB_MAGIC,
      peer: this.bridge.peer().id,
      code: this.inviteCode,
      port: this.port,
      addresses: lanAddresses(),
    }));
    for (const target of broadcastTargets()) {
      this.udp?.send(payload, this.discoveryPort, target, () => { /* 广播失败无所谓，周期广播还会再发 */ });
    }
  }

  /** 加入某台主机。地址留空时用 UDP 广播自动寻找。 */
  async joinHub(address?: string, port = this.configuredPort): Promise<{ ok: boolean; message: string }> {
    this.usePort(port);
    this.stopListener();
    try {
      await this.startListener();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `本机监听失败：${message}` };
    }
    /*
     * 手动填的地址常常只有 IP（`192.168.0.3`），不补端口就会连到 80 端口 —— 
     * 对端根本没在那儿监听。这里把端口补齐，用户不用记端口号。
     */
    const typed = address?.trim();
    const target = typed ? normalizeHubAddress(typed, this.configuredPort) : await this.discover();
    if (!target) {
      this.role = 'off';
      this.stopListener();
      return {
        ok: false,
        message: typed
          ? `地址看不懂：${typed}。填 IP 就行（例如 192.168.0.3），端口会自动补上。`
          : '没有自动找到主机。如果两台设备和路由器都正常，请在另一台上点一次「连接另一台设备」，或直接在「高级」里填它的 IP。',
      };
    }
    const response = await this.postJson(target, '/hwchat-sync/v1/pair', {
      protocol: SYNC_PROTOCOL_VERSION,
      code: this.code,
      peer: this.bridge.peer(),
      port: this.port,
    }).catch(() => undefined);    if (!response?.ok) {
      this.role = 'off';
      this.stopListener();
      const reason = typeof response?.error === 'string' ? response.error : '对端无响应或配对码不符';
      return { ok: false, message: `加入失败：${reason}` };
    }
    if (Array.isArray(response.peers)) this.absorbPeers(response.peers);
    this.role = 'peer';
    this.hubAddress = target;
    this.bridge.log(`[sync] 已加入主机 ${target}（配对码 ${this.code}）`);
    this.bridge.onState?.();
    return { ok: true, message: `已加入主机 ${target}。现在两边的设备会在同一个需求下一起执行。` };
  }

  stop(): void {
    this.stopDiscovery();
    this.role = 'off';
    this.hubAddress = '';
    // 手机遥控开着的时候监听要留着：否则「断开双机同步」会顺手把手机也踢下线。
    if (!this.mobileEnabled) this.stopListener();
    this.bridge.onState?.();
  }

  private stopDiscovery(): void {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = undefined;
    }
    this.udp?.close();
    this.udp = undefined;
  }

  private stopListener(): void {
    this.stopDiscovery();
    this.server?.close();
    this.server = undefined;
  }

  /** 监听已经开着就复用：手机遥控和双机同步共用同一个端口。 */
  private async ensureListener(): Promise<void> {
    if (this.server) return;
    await this.startListener();
  }

  private async startListener(): Promise<void> {
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    const listen = (port: number): Promise<void> => new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '0.0.0.0');
    });
    try {
      await listen(this.configuredPort);
    } catch (error) {
      /*
       * 端口被上一次没退干净的窗口（或另一个 VS Code 窗口）占着。
       * 换系统分配的端口继续：对端是靠广播包里带的真实端口连过来的，
       * 用户不该为了这个去看日志、改设置。
       */
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      await listen(0);
      this.bridge.log(`[sync] 端口 ${this.configuredPort} 被占用，改用 ${(server.address() as AddressInfo).port}`);
    }
    const address = server.address();
    if (address && typeof address === 'object' && address.port > 0) this.port = address.port;
    this.server = server;
  }

  /** UDP 发现：主机周期广播自己，加入方广播询问。 */
  private async startDiscovery(): Promise<void> {
    const udp = createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      udp.once('error', reject);
      udp.bind(this.discoveryPort, () => {
        udp.off('error', reject);
        resolve();
      });
    });
    udp.on('error', (error) => this.bridge.log(`[sync] UDP 错误：${error.message}`, 'warn'));
    udp.on('message', (buffer, remote) => {
      const text = buffer.toString('utf8');
      const selfId = this.bridge.peer().id;

      /* ---------- 1. 有人在找主机：回一句「我在这儿」 ---------- */
      let isAsk = false;
      if (text === DISCOVER_MAGIC) {
        isAsk = true;
        // 旧版询问拿不到设备 id，只能按 IP 挡掉自己发的那一条（广播会回环）。
        if (isOwnAddress(remote.address)) return;
      } else {
        let parsed: { magic?: unknown; peer?: unknown; addresses?: unknown; port?: unknown } | undefined;
        try {
          parsed = JSON.parse(text) as typeof parsed;
        } catch {
          return;
        }
        if (parsed?.magic === DISCOVER_MAGIC) {
          isAsk = true;
          /*
           * 按**设备 id** 挡自己，不按 IP。
           *
           * 按 IP 会把「同一台电脑上开的另一个窗口」也挡掉 —— 一个窗口做 Windows 版、
           * 一个窗口做 macOS 版是很正常的用法，那样就永远连不上了。
           */
          if (typeof parsed.peer === 'string' && parsed.peer === selfId) return;
        } else if (parsed?.magic === HUB_MAGIC) {
          this.considerYielding(parsed, udp);
          return;
        } else {
          return;
        }
      }
      if (isAsk) {
        const reply = JSON.stringify({ magic: HUB_MAGIC, peer: selfId, port: this.port, addresses: lanAddresses() });
        udp.send(reply, remote.port, remote.address);
        return;
      }
    });
    this.udp = udp;
    /*
     * 广播自己「已经是主机」。
     *
     * `peer` 必须带上：让位要靠它比 id。漏掉的话两台新版会互相把对方当成旧版，
     * **双方同时让位**，结果都变成从机，谁也连不上。
     */
    const announce = (): void => {
      const payload = Buffer.from(JSON.stringify({
        magic: HUB_MAGIC,
        peer: this.bridge.peer().id,
        /*
         * 邀请码必须出现在广播里：从机就是靠它找到「我要进的那个群」。
         * 没有码时（旧模式 / 高级手动连接）发空串，从机按码找时就找不到它。
         */
        code: this.inviteCode,
        port: this.port,
        addresses: lanAddresses(),
      }));
      for (const target of broadcastTargets()) udp.send(payload, this.discoveryPort, target, () => { /* 广播失败无所谓 */ });
    };
    // 先立刻喊一声：否则两台同时点按钮时要干等 15 秒才知道对方也是主机。
    announce();
    this.announceTimer = setInterval(announce, 5_000);
    this.announceTimer.unref?.();
  }

  /**
   * 听到别的主机广播：两台都点了按钮时，谁让位。
   *
   * 两边各自成为主机、谁也不连谁是用户最容易踩的坑（他就是这么操作的）。
   * 规则按设备 id：id 大的降为从机去加入对方，只让一边让，不会两边同时让步。
   * **旧版广播没有 `peer` 字段，而且它自己不会让位** —— 这时本机无条件让，
   * 否则两边会永远对着待命；旧版配对接口是同一套，让位后照样能连上。
   */
  private considerYielding(
    other: { peer?: unknown; code?: unknown; addresses?: unknown; port?: unknown },
    udp: UdpSocket,
  ): void {
    if (this.role !== 'hub' || this.yielding) return;
    if (yieldDecision(this.bridge.peer().id, other.peer) === 'stay') return;
    const addresses = Array.isArray(other.addresses)
      ? other.addresses.filter((item): item is string => typeof item === 'string' && Boolean(item))
      : [];
    // 优先连非本机地址；同一台机器上的另一个窗口则直接用它的地址。
    const address = addresses.find((item) => !isOwnAddress(item)) ?? (other.peer ? addresses[0] : undefined);
    if (!address) return;
    const otherCode = typeof other.code === 'string' ? other.code : '';
    const target = `http://${address}:${typeof other.port === 'number' ? other.port : this.port}`;
    this.yielding = true;
    this.bridge.log(`[sync] 发现另一台也开了群聊（${address}），本机让位并加入`);
    // 延后一拍：join 会关掉当前这个发现 socket，不能在它自己的回调里直接关。
    setTimeout(() => {
      /*
       * 对方开着群聊时**用它给的邀请码进群** —— 走的就是「填码进群」同一条路径，
       * 两台都点了「启动群聊」也能自动收敛成「一台主机 + 一台成员」。
       * 对方没有码（旧版 / 高级手动模式）才退回旧的配对方式。
       */
      const attempt = otherCode
        ? this.joinGroup(otherCode, this.configuredPort, target)
        : this.joinHub(target, this.configuredPort);
      void attempt
        .then((result) => {
          this.yielding = false;
          if (result.ok) this.bridge.onState?.();
          else this.bridge.log(`[sync] 让位失败：${result.message}`, 'warn');
        })
        .catch(() => { this.yielding = false; });
    }, 0);
    void udp;
  }

  /**
   * 找主机。
   *
   * 传了邀请码就只认**码对得上**的群聊 —— 这是「填码进群」能成立的关键：
   * 用户不需要知道对方 IP，广播里带着码自己就对上了。
   * 不传码时保持旧行为（自动找任意一台主机），供「高级 → 手动连接」使用。
   */
  private async discover(expectedCode?: string): Promise<string> {
    const udp = createSocket({ type: 'udp4', reuseAddr: true });
    return new Promise((resolve) => {
      let settled = false;
      const timers: NodeJS.Timeout[] = [];
      const finish = (value: string): void => {
        if (settled) return;
        settled = true;
        for (const timer of timers) clearTimeout(timer);
        try { udp.close(); } catch { /* 已关闭 */ }
        resolve(value);
      };
      // 按码找可以多等一会儿：用户抄码需要时间，主机广播也要有时间轮到。
      timers.push(setTimeout(() => finish(''), expectedCode ? 4_000 : 2_000));
      udp.on('error', () => finish(''));
      udp.on('message', (buffer) => {
        try {
          const parsed = JSON.parse(buffer.toString('utf8')) as {
            magic?: string;
            peer?: unknown;
            code?: unknown;
            addresses?: unknown;
            port?: unknown;
          };
          if (parsed.magic !== HUB_MAGIC || !Array.isArray(parsed.addresses)) return;
          // 码对不上就不是我要找的群。
          if (expectedCode && parsed.code !== expectedCode) return;
          /*
           * 是不是自己，按**设备 id** 判断，不按 IP 判断。
           *
           * 本机如果同时也是主机，它的广播会绕回自己这里，必须排除；
           * 但同一台电脑上开的另一个窗口 IP 也一样 —— 按 IP 判断会把对方一起排掉，
           * 那种用法（一个窗口做 Windows 版、一个做 macOS 版）就永远连不上。
           */
          if (typeof parsed.peer === 'string' && parsed.peer === this.bridge.peer().id) return;
          const usable = parsed.addresses.filter(
            (item): item is string => typeof item === 'string' && Boolean(item),
          );
          // 优先选非本机地址；全都是本机地址时说明是同一台机器上的另一个窗口，也应当能连。
          const address = usable.find((item) => !isOwnAddress(item)) ?? (parsed.peer ? usable[0] : undefined);
          if (address) finish(`http://${address}:${typeof parsed.port === 'number' ? parsed.port : this.port}`);
        } catch {
          // 不是我们的包。
        }
      });
      udp.bind(() => {
        /*
         * 询问包带上设备 id：主机靠它区分「本机回环」与「同一台机器上的另一个窗口」。
         * 旧版收到 JSON 会当垃圾丢弃，所以新版同时再发一条旧格式，保证能连上旧设备。
         */
        const payload = Buffer.from(JSON.stringify({ magic: DISCOVER_MAGIC, peer: this.bridge.peer().id }));
        udp.setBroadcast(true);
        /*
         * UDP 广播不可靠：丢一个包就是「找不到设备」。
         *
         * 所以发四轮，而且不只发 255.255.255.255 —— 多网卡机器上系统常把全局广播
         * 从错误的网卡送出去，路由器也经常直接丢弃；定向到本网段才走得通。
         */
        const ask = (): void => {
          for (const target of broadcastTargets()) udp.send(payload, this.discoveryPort, target, () => { /* 忽略 */ });
        };
        ask();
        timers.push(setTimeout(ask, 350), setTimeout(ask, 800), setTimeout(ask, 1_300));
      });
    });
  }

  private absorbPeers(value: unknown): void {
    if (!Array.isArray(value)) return;
    const selfId = this.bridge.peer().id;
    for (const item of value.slice(0, MAX_PEERS)) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { peer?: unknown; address?: unknown };
      const message = parseSyncMessage({ kind: 'report', requirementId: 'x', from: record.peer, status: 'planned' });
      if (!message) continue;
      // 对端可能把它看到的「我们」也发回来；把自己记成队友会让设备数虚高一位。
      if (message.from.id === selfId) continue;
      const address = typeof record.address === 'string' ? record.address : '';
      this.peers.set(message.from.id, { peer: message.from, address });
    }
    this.bridge.onState?.();
  }

  private selfAddress(remoteAddress: string | undefined): string {
    const own = lanAddresses();
    // 尽量回给对方能连上的那个网段：取与请求来源同前缀的第一个地址。
    if (remoteAddress) {
      const prefix = remoteAddress.split('.').slice(0, 3).join('.');
      const sameSubnet = own.find((address) => address.startsWith(`${prefix}.`));
      if (sameSubnet) return `http://${sameSubnet}:${this.port}`;
    }
    return own[0] ? `http://${own[0]}:${this.port}` : '';
  }

  private peerList(): Array<{ peer: SyncPeer; address: string }> {
    return [...this.peers.values()].filter((entry) => entry.peer.id !== this.bridge.peer().id);
  }

  /** 对端设备清单（「同步核对」要让人看见到底连上了谁）。 */
  remotePeers(): Array<{ name: string; platform: string; address: string }> {
    return this.peerList().map((entry) => ({
      name: entry.peer.name,
      platform: entry.peer.platform,
      address: entry.address,
    }));
  }

  /** 本机实际监听端口与发现端口（核对端口是否被换过）。 */
  ports(): { listen: number; discovery: number } {
    return { listen: this.port, discovery: this.discoveryPort };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '/';
    const route = url.split('?')[0] ?? '/';
    const json = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
      });
      response.end(payload);
    };
    try {
      if (request.method === 'GET' && route === '/hwchat-sync/v1/ping') {
        json(200, { ok: true, protocol: SYNC_PROTOCOL_VERSION, peer: this.bridge.peer(), role: this.role });
        return;
      }
      /*
       * 手机遥控走独立的一组路由（`/m`），排在配对码闸门前面：
       * 手机是用 6 位码换 Cookie 的，没有配对码可带。
       */
      if (route === MOBILE_PATH || route.startsWith(`${MOBILE_PATH}/`)) {
        await this.handleMobileRequest(request, response, route);
        return;
      }
      if (request.method !== 'POST') {
        json(404, { ok: false, error: 'not found' });
        return;
      }
      const body = await readBody(request);
      if (!body) {
        json(413, { ok: false, error: 'body too large' });
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        json(400, { ok: false, error: 'invalid json' });
        return;
      }
      /*
       * 配对码：**每个**请求都要带，别人在同一个 WiFi 上扫到端口也进不来。
       *
       * `/pair` 例外：它的放行判断在下面（已允许过的设备 / 对得上码 / 用户点「允许」
       * 三种途径），所以不能在这里一刀切 —— 否则「傻瓜式」的弹窗永远走不到。
       */
      if (route !== '/hwchat-sync/v1/pair' && !pairingMatches(parsed.code, this.code)) {
        json(403, { ok: false, error: 'pairing code mismatch' });
        return;
      }
      if (route === '/hwchat-sync/v1/pair') {
        const message = parseSyncMessage({ kind: 'report', requirementId: 'pair', from: parsed.peer, status: 'planned' });
        let already = false;
        if (message) {
          /*
           * 加入方自己的地址必须算准，否则主机会把需求「转发」到自己身上。
           *
           * 这里优先用加入方声明的地址；没有就用**请求来源的 IP** 加它自报的端口 ——
           * 绝不能回落到 `selfAddress()`，那是主机自己的地址（第一版就是这个 bug）。
           */
          const remoteIp = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
          const declaredPort = typeof parsed.port === 'number' && parsed.port > 0 && parsed.port < 65_536
            ? parsed.port
            : this.port;
          const address = typeof parsed.address === 'string' && parsed.address
            ? parsed.address
            : (remoteIp ? `http://${remoteIp}:${declaredPort}` : '');
          /*
           * 放行判断，**填码进群**优先：
           *  1. 邀请码对得上 → 直接放行（这就是正常路径）；
           *  2. 这台设备以前进过这个群 → 放行（重连不再打扰）；
           *  3. 都没有时问用户一次「允许吗」——保留给「高级 → 手动连接」那种没有码的场景。
           * 没有 `approvePeer` 实现时退回「码必须对」（测试环境 / 无人值守）。
           */
          const known = this.approved.has(message.from.id);
          const supplied = normalizeInviteCode(typeof parsed.code === 'string' ? parsed.code : '');
          const codeOk = this.inviteCode
            ? supplied === normalizeInviteCode(this.inviteCode)
            : pairingMatches(parsed.code, this.code);
          let allowed = codeOk || known;
          if (!allowed && this.bridge.approvePeer) {
            allowed = await this.bridge.approvePeer(message.from).catch(() => false);
          }
          if (!allowed) {
            this.bridge.log(`[sync] 邀请码不对，拒绝：${message.from.name}`);
            json(403, { ok: false, error: '邀请码不对' });
            return;
          }
          if (!known) {
            this.approved.add(message.from.id);
            await this.persist();
          }
          const alreadyIn = this.peers.has(message.from.id);
          already = alreadyIn;
          this.peers.set(message.from.id, { peer: message.from, address });
          if (alreadyIn) this.bridge.log(`[sync] ${message.from.name} 已在群里，重复加入不重复计数`);
          else this.bridge.log(`[sync] 设备加入：${message.from.name}（${message.from.project}）${address ? ` → ${address}` : ''}`);
        }
        json(200, {
          ok: true,
          already,
          peers: this.peerList(),
          hub: { peer: this.bridge.peer(), address: this.selfAddress(request.socket.remoteAddress) },
        });
        return;
      }
      if (route === '/hwchat-sync/v1/message') {
        const message = parseSyncMessage(parsed.message);
        if (!message) {
          json(400, { ok: false, error: 'invalid message' });
          return;
        }
        // 主机先落账，再转发给其它设备（不回给发送方，避免回声）。
        await this.applyMessage(message, { relay: true, from: message.from.id });
        json(200, { ok: true });
        return;
      }
      /*
       * 对端（非主机）的接收端口：主机把需求转发到这里。
       *
       * 只接受主机转发的消息，且同样校验配对码 —— 这样即使有人知道端口，
       * 没有配对码也没法让别人的机器执行任务。
       */
      if (route === '/hwchat-sync/v1/deliver') {
        const message = parseSyncMessage(parsed.message);
        if (!message) {
          json(400, { ok: false, error: 'invalid message' });
          return;
        }
        if (message.kind === 'requirement') this.peers.set(message.from.id, { peer: message.from, address: '' });
        await this.applyMessage(message, { relay: false });
        json(200, { ok: true });
        return;
      }
      json(404, { ok: false, error: 'not found' });
    } catch (error) {
      this.bridge.log(`[sync] 处理请求失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
      try { json(500, { ok: false, error: 'internal' }); } catch { /* 已结束 */ }
    }
  }

  /**
   * 落地一条消息并（可选）转发。
   *
   * 幂等：同一个需求 id 只记一次，同一条报告按「平台 + 时间」取最新 ——
   * 网络重发、主机与对端都收到同一条消息时不会重复渲染。
   */
  private async handleMobileRequest(request: IncomingMessage, response: ServerResponse, route: string): Promise<void> {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      const payload = JSON.stringify(body);
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
        ...headers,
      });
      response.end(payload);
    };
    const sendHtml = (status: number, body: string): void => {
      response.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        // 页面只用内联脚本，禁止别人嵌框架、禁止嗅探类型。
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      });
      response.end(body);
    };

    if (!this.mobileEnabled) {
      send(404, { ok: false, error: '手机遥控未开启' });
      return;
    }

    const client = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const cookies = parseCookies(request.headers.cookie);
    const authed = this.gate.authorize(cookies[MOBILE_COOKIE]);

    if (route === MOBILE_PATH) {
      if (request.method !== 'GET') {
        send(405, { ok: false, error: 'method not allowed' });
        return;
      }
      sendHtml(200, renderMobilePage({
        device: this.bridge.peer().name,
        authed,
        canApprove: this.bridge.canApproveFromPhone?.() ?? false,
      }));
      return;
    }

    if (route === `${MOBILE_PATH}/login`) {
      if (request.method !== 'POST') {
        send(405, { ok: false, error: 'method not allowed' });
        return;
      }
      const raw = await readBody(request);
      if (!raw) {
        send(413, { ok: false, error: 'body too large' });
        return;
      }
      let code = '';
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        code = typeof parsed.code === 'string' ? parsed.code : String(parsed.code ?? '');
      } catch {
        send(400, { ok: false, error: 'invalid json' });
        return;
      }
      const result = this.gate.redeem(code, client);
      if (!result.ok) {
        this.bridge.log(`[mobile] ${client || '未知来源'} 验证码不正确`, 'warn');
        send(401, { ok: false, error: result.error });
        return;
      }
      this.bridge.log(`[mobile] ${client || '未知来源'} 已进入团队群`);
      send(200, { ok: true }, {
        'set-cookie': mobileCookie(result.token, Math.floor(MOBILE_SESSION_TTL_MS / 1000)),
      });
      return;
    }

    if (!authed) {
      send(401, { ok: false, error: '会话已过期，请重新输入验证码。' });
      return;
    }

    if (route === `${MOBILE_PATH}/state`) {
      if (request.method !== 'GET') {
        send(405, { ok: false, error: 'method not allowed' });
        return;
      }
      send(200, this.mobileState());
      return;
    }

    if (route !== `${MOBILE_PATH}/send` && route !== `${MOBILE_PATH}/approve`) {
      send(404, { ok: false, error: 'not found' });
      return;
    }
    if (request.method !== 'POST') {
      send(405, { ok: false, error: 'method not allowed' });
      return;
    }
    /*
     * 改状态的接口要求这个自定义头：跨站表单发不出自定义头，
     * 配合 `SameSite=Strict` 就挡住了「别的网页借你的浏览器指挥这台电脑」。
     */
    if (request.headers['x-hwchat-mobile'] !== '1') {
      send(403, { ok: false, error: '缺少请求头' });
      return;
    }
    const raw = await readBody(request);
    if (!raw) {
      send(413, { ok: false, error: 'body too large' });
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      send(400, { ok: false, error: 'invalid json' });
      return;
    }

    if (route === `${MOBILE_PATH}/send`) {
      const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      if (!text) {
        send(400, { ok: false, error: '内容为空' });
        return;
      }
      if (!this.bridge.onMobileMessage) {
        send(503, { ok: false, error: '本机还没准备好接收手机消息，请重试。' });
        return;
      }
      const result = await this.bridge.onMobileMessage(text.slice(0, 4_000));
      send(result.ok ? 200 : 409, result);
      return;
    }

    const id = typeof parsed.id === 'string' ? parsed.id : '';
    const allow = parsed.allow === true;
    if (!id) {
      send(400, { ok: false, error: '缺少审批号' });
      return;
    }
    if (!this.remoteApprovalEnabled()) {
      send(403, { ok: false, error: '这台电脑没有允许「手机批准授权」。' });
      return;
    }
    if (!this.resolveApproval(id, allow)) {
      send(409, { ok: false, error: '这张卡已经处理过了（或在电脑上已过期）。' });
      return;
    }
    this.bridge.log(`[mobile] 来自手机的授权：${allow ? '允许' : '拒绝'} ${id}`);
    send(200, { ok: true });
  }

  private async applyMessage(message: SyncMessage, options: { relay: boolean; from?: string }): Promise<void> {
    // 审批卡与远程控制不是"项目事件"：它们有自己的生命周期，不写进需求/报告/群记录
    if (message.kind === 'approval') {
      if (message.phase === 'decision') this.ingestRelayApproval(message);
      return;
    }
    if (message.kind === 'control') {
      void this.ingestRelayControl(message);
      return;
    }
    if (message.kind === 'requirement') {
      const exists = this.requirements.some((item) => item.id === message.id);
      if (!exists) {
        this.requirements = [...this.requirements, message].slice(-STATE_LIMIT);
        await this.persist();
        this.bridge.log(`[sync] 收到需求 ${message.id}：${message.title}（来自 ${message.from.name}）`);
        // 本机执行（除发起方自己）。
        if (message.from.id !== this.bridge.peer().id) {
          const accepted = await this.bridge.runRequirement(message).catch((error: unknown) => {
            this.bridge.log(`[sync] 本机执行需求失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
            return false;
          });
          if (!accepted) this.bridge.log('[sync] 面板正忙，需求已记录，稍后可手动继续', 'warn');
        }
      }
    } else {
      if (message.kind === 'group') {
        /*
         * 群消息：只记录与展示，**绝不触发对端重新开跑** —— 否则「解析」「结果」
         * 会互相激发，两个 agent 能聊到把额度烧光。需求本身（kind=requirement）
         * 才是唯一的执行触发器。
         */
        if (!this.group.some((item) => item.id === message.id)) {
          this.group = [...this.group, message].slice(-MAX_GROUP_MESSAGES);
          await this.persist();
          this.bridge.log(`[sync] 群消息：${renderGroupLine(message)}`);
          await this.bridge.onGroupMessage?.(message).catch(() => undefined);
          await this.refreshTranscript();
          /*
           * 甲方回答了乙方的追问 → 本机这一侧也要接着做。
           *
           * 这是「追问直到达成一致」能闭环的地方：不重新开一轮，甲方的话会被
           * 记录却没人接，两个 agent 就永远停在「等你回答」。
           */
          if (message.author === 'user' && message.phase === 'answer' && message.from.id !== this.bridge.peer().id) {
            const requirement = this.requirementById(message.requirementId);
            if (requirement && this.role !== 'off') {
              await this.bridge.runRequirement(requirement).catch(() => false);
            }
          }
        }
      } else if (message.kind === 'note') {
        /*
         * 协作消息：先记账，再交给本机 agent。
         *
         * 幂等按 id 去重 —— 同一台设备既是发起方又收到转发时会重复到达一次。
         */
        if (!this.notes.some((item) => item.id === message.id)) {
          this.notes = [...this.notes, message].slice(-MAX_NOTES);
          await this.persist();
          this.bridge.log(`[sync] 队友消息（${message.from.name}）：${message.body.slice(0, 80)}`);
          if (message.from.id !== this.bridge.peer().id && shouldAutoRespond(message)) {
            const accepted = await this.bridge.runNote?.(message).catch((error: unknown) => {
              this.bridge.log(`[sync] 交付队友消息失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
              return false;
            });
            if (accepted === false) this.bridge.log('[sync] 面板正忙，队友消息已记录（team_sync status 可查看）', 'warn');
          }
        }
      } else {
        const key = `${message.requirementId}\u0000${message.from.platform}\u0000${message.from.id}`;
        const index = this.reports.findIndex((item) => `${item.requirementId}\u0000${item.from.platform}\u0000${item.from.id}` === key);
        if (index >= 0) {
          if (message.at >= this.reports[index]!.at) this.reports[index] = message;
        } else {
          this.reports = [...this.reports, message].slice(-STATE_LIMIT * 3);
        }
        await this.persist();
        this.bridge.log(`[sync] 收到报告：${message.from.name} ${message.status} ${message.requirementId}`);
      }
    }
    if (options.relay && this.role === 'hub') {
      const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.code, message });
      const targets = this.peerList().filter((entry) => entry.address && entry.peer.id !== options.from);
      await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
    }
    await this.refreshLedger();
    this.bridge.onState?.();
  }

  /** 把账本写进仓库：这是「对齐」的可见产物，人和模型都能读。 */
  private async refreshLedger(): Promise<void> {
    const rows = buildLedger(this.requirements, this.reports);
    if (!rows.length) return;
    try {
      // 带名册进去，「哪台设备没有报告」才有依据（设备数不固定，不能靠平台枚举猜）
      const roster = [this.bridge.peer(), ...this.peerList().map((entry) => entry.peer)];
      await this.bridge.writeLedger(renderLedger(rows, Date.now(), roster));
    } catch (error) {
      this.bridge.log(`[sync] 写账本失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  /**
   * 本机发起一条需求：先本地执行，再广播给对端。
   *
   * 顺序很重要 —— 先本地开跑，用户立刻看到自己的设备动起来了；广播失败也只影响对端，
   * 不会让本机白等一次网络超时。
   */
  async shareRequirement(text: string): Promise<{ ok: boolean; message: string; requirement?: SyncRequirement }> {
    const requirement = makeRequirement(this.bridge.peer(), text);
    if (!requirement) return { ok: false, message: '需求内容为空。' };
    const exists = this.requirements.some((item) => item.id === requirement.id);
    if (!exists) this.requirements = [...this.requirements, requirement].slice(-STATE_LIMIT);
    await this.persist();
    await this.refreshLedger();
    const relayResult = await this.relayOut(requirement);

    if (this.role !== 'off') {
      const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.code, message: requirement });
      if (this.role === 'hub') {
        const targets = this.peerList().filter((entry) => entry.address);
        const results = await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
        const failed = results.filter((result) => result.status === 'rejected').length;
        const delivered = targets.length - failed;
        this.bridge.onState?.();
        return {
          ok: targets.length === 0 || delivered > 0,
          message: targets.length
            ? `已同步给 ${delivered}/${targets.length} 台设备（需求号 ${requirement.id}）。`
            : `本机已记录（需求号 ${requirement.id}），当前没有其它设备加入。`,
          requirement,
        };
      }
      const response = await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', {
        protocol: SYNC_PROTOCOL_VERSION,
        code: this.code,
        message: requirement,
      }).catch(() => undefined);
      this.bridge.onState?.();
      return {
        ok: Boolean(response?.ok),
        message: response?.ok
          ? `已交给主机转发（需求号 ${requirement.id}）。`
          : `本机已记录，但同步失败（主机没响应）。需求号 ${requirement.id}。`,
        requirement,
      };
    }
    this.bridge.onState?.();
    if (relayResult.ok) {
      return { ok: true, message: `已发到中继（需求号 ${requirement.id}）。`, requirement };
    }
    return {
      ok: false,
      message: `本机已记录（需求号 ${requirement.id}），但**没有同步到任何其它设备**：${relayResult.message}。`,
      requirement,
    };
  }

  /**
   * 多台 agent 之间的**协作消息**（用户说的「像同事一样沟通、互通有无」）。
   *
   * 与 `shareRequirement` 的区别：需求一定会开跑一轮；协作消息只是把一段话送给
   * 对端 agent，由它判断要不要动手、要不要回。这也是「不要为了回应而改代码」的落点。
   */
  async shareNote(input: { body: string; topic?: string; replyTo?: string }): Promise<{ ok: boolean; message: string }> {
    const note = makeNote(this.bridge.peer(), input);
    if (!note) return { ok: false, message: '消息内容为空。' };
    this.notes = [...this.notes, note].slice(-MAX_NOTES);
    await this.persist();
    void this.relayOut(note);
    if (this.role === 'off') {
      this.bridge.onState?.();
      return { ok: true, message: '本机已记录。局域网同步未启用，没有发出。' };
    }
    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.code, message: note });
    if (this.role === 'hub') {
      const targets = this.peerList().filter((entry) => entry.address);
      const results = await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
      const delivered = results.filter((result) => result.status === 'fulfilled').length;
      this.bridge.onState?.();
      return {
        ok: targets.length === 0 || delivered > 0,
        message: targets.length ? `已发给 ${delivered}/${targets.length} 台设备。` : '已记录，当前没有其它设备加入。',
      };
    }
    const response = await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', {
      protocol: SYNC_PROTOCOL_VERSION,
      code: this.code,
      message: note,
    }).catch(() => undefined);
    this.bridge.onState?.();
    return { ok: Boolean(response?.ok), message: response?.ok ? '已发给对端。' : '记录成功，但发送失败（主机没响应）。' };
  }

  /**
   * 在团队群里发言（本机 agent 或用户）。
   *
   * 与 `shareNote` 的区别：这是**群记录**，会写进 `docs/TEAM-CHAT.md` 并追加到对话里，
   * 而且**不会**触发对端开跑 —— 只有用户的需求（`shareRequirement`）才触发。
   */
  async postGroup(input: {
    author: 'user' | 'agent';
    phase: GroupPhase;
    body: string;
    requirementId?: string;
    assignee?: string;
    project?: string;
  }): Promise<{ ok: boolean; message: string; group?: SyncGroupMessage }> {
    /*
     * 关联需求：没指定就用最近的一条。
     *
     * 模型经常只写 `action=analysis` 而忘了带需求号 —— 让它自己再猜一次毫无价值，
     * 而「最近一条需求」在真实使用里几乎总是对的。
     */
    const requirementId = input.requirementId
      || this.requirements[this.requirements.length - 1]?.id
      || '';
    const group = makeGroupMessage(this.bridge.peer(), { ...input, requirementId });
    if (!group) return { ok: false, message: '群消息内容为空。' };
    this.group = [...this.group, group].slice(-MAX_GROUP_MESSAGES);
    await this.persist();
    await this.refreshTranscript();
    void this.relayOut(group);
    await this.bridge.onGroupMessage?.(group).catch(() => undefined);
    this.bridge.onState?.();
    if (this.role === 'off') return { ok: true, message: '已记入团队群（未启用局域网同步，没有发给队友）。', group };

    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.code, message: group });
    if (this.role === 'hub') {
      const targets = this.peerList().filter((entry) => entry.address);
      await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
    } else {
      await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', { code: this.code, message: group }).catch(() => undefined);
    }
    return { ok: true, message: '已发到团队群。', group };
  }

  /** 群里的最近发言（`team_sync status` 与面板用）。 */
  recentGroup(limit = 12): SyncGroupMessage[] {
    return this.group.slice(-Math.max(1, limit));
  }

  /**
   * 团队群窗口要显示的全部状态（一次取完，避免面板多次调用）。
   *
   * 面板据此渲染：成员、发言、以及「乙方正在等你回答」的那条追问 ——
   * 群窗口要做的事只有三件：看谁说了什么、回答追问、发新需求。
   */
  groupState(): {
    role: LanSyncRole;
    peers: SyncPeer[];
    messages: SyncGroupMessage[];
    openQuestion?: { requirementId: string; body: string };
  } {
    const questionId = this.openQuestionRequirement();
    const question = questionId
      ? [...this.group].reverse().find((message) => message.requirementId === questionId && message.phase === 'question')
      : undefined;
    return {
      role: this.role,
      peers: [this.bridge.peer(), ...this.peerList().map((entry) => entry.peer)],
      messages: this.group,
      ...(question && questionId
        ? { openQuestion: { requirementId: questionId, body: question.body } }
        : {}),
    };
  }

  /**
   * 当前有没有「乙方问了、甲方还没回答」的需求，返回它的需求号。
   *
   * 面板用它决定：甲方下一条消息是**回答追问**（并入同一条需求），
   * 还是一条**新需求**（新开一条、再广播给对端）。判错会让追问永远收不了尾。
   */
  openQuestionRequirement(): string | undefined {
    for (let index = this.requirements.length - 1; index >= 0; index -= 1) {
      const requirement = this.requirements[index]!;
      if (groupAgreement(this.group, requirement.id) === 'awaiting-user') return requirement.id;
    }
    return undefined;
  }

  /** 按需求号取需求（收到甲方回答时要重新交给本机 agent）。 */
  requirementById(id: string): SyncRequirement | undefined {
    return this.requirements.find((item) => item.id === id);
  }

  /**
   * 把群记录写进仓库。
   *
   * 与对齐账本分工：账本是**状态表**（谁做完没做完），群记录是**过程**（谁说了什么）。
   * 两者都进仓库，人和模型都能读。
   */
  private async refreshTranscript(): Promise<void> {
    if (!this.group.length) return;
    try {
      await this.bridge.writeTranscript(renderGroupTranscript(this.group));
    } catch (error) {
      this.bridge.log(`[sync] 写群记录失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  /** 最近的协作消息（`team_sync` 的 status 与面板展示用）。 */  recentNotes(limit = 10): SyncNote[] {
    return this.notes.slice(-Math.max(1, limit));
  }

  /** 已有需求的标题，用来把「需求」和「聊天」关联起来（agent 回答时不必自己翻账本）。 */
  requirementTitles(limit = 8): string[] {
    return this.requirements.slice(-limit).map((item) => `${item.id}：${item.title}`);
  }

  /** 本机报告一条进度：写本地账本并同步给对端。 */
  async report(input: {
    requirementId: string;
    status: ReportStatus;
    summary?: string;
    files?: string[];
    note?: string;
  }): Promise<void> {
    const report = makeReport(this.bridge.peer(), input);
    const key = `${report.requirementId}\u0000${report.from.platform}\u0000${report.from.id}`;
    const index = this.reports.findIndex((item) => `${item.requirementId}\u0000${item.from.platform}\u0000${item.from.id}` === key);
    if (index >= 0) this.reports[index] = report;
    else this.reports = [...this.reports, report].slice(-STATE_LIMIT * 3);
    await this.persist();
    await this.refreshLedger();
    void this.relayOut(report);
    if (this.role === 'off') return;
    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.code, message: report });
    if (this.role === 'hub') {
      const targets = this.peerList().filter((entry) => entry.address);
      await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
    } else {
      await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', { code: this.code, message: report }).catch(() => undefined);
    }
    this.bridge.onState?.();
  }

  /** 手动推一次账本（工作区刚打开 / 用户点「打开账本」时用）。 */
  async syncLedger(): Promise<void> {
    await this.refreshLedger();
  }

  private async postJson(address: string, path: string, body: unknown): Promise<Record<string, unknown> | undefined> {
    const payload = JSON.stringify(body);
    const result = await postRaw(address, path, payload);
    try {
      return JSON.parse(result) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.approvals.keys()]) this.resolveApproval(id, false);
    this.gate.revokeAll();
    this.stopListener();
    this.role = 'off';
  }
}

function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        resolve(undefined);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(undefined));
  });
}

/** 把「只有 IP」的输入补齐成完整地址；看不懂就返回空串。 */
export function normalizeHubAddress(input: string, port: number): string {
  const value = input.replace(/\/+$/, '');
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    if (!url.port) url.port = String(port);
    return url.origin;
  } catch {
    return '';
  }
}

function postRaw(address: string, path: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(path, address.startsWith('http') ? address : `http://${address}`);
    } catch (error) {
      reject(error);
      return;
    }
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 500) >= 400) reject(new Error(`${response.statusCode}: ${text.slice(0, 200)}`));
        else resolve(text);
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end(payload);
  });
}

/** 设备名：主机名 + 平台，例如「MacBook-Pro · macOS」。 */
export function defaultDeviceName(): string {
  const name = hostname().replace(/\.local$/i, '');
  return `${name} · ${defaultPlatform()}`;
}

export function defaultPlatform(): SyncPlatform {
  return platformOf(osPlatform());
}

/** 稳定设备 id：主机名 + 平台 + 用户名哈希（同机重启不变，换机不同）。 */
export function peerIdFor(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

/** 账本路径（有 docs/ 就放进 docs/，否则放工作区根）。 */
export function ledgerPathFor(root: string): string {
  return join(root, ALIGNMENT_FILE);
}
