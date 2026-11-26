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
import { createConnection } from 'node:net';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { hostname, networkInterfaces, platform as osPlatform } from 'node:os';
import { readDeviceName } from './deviceInfo';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type AgentActivity,
  ALIGNMENT_FILE,
  ASSET_CHUNK_CHARS,
  ASSET_MAX_CHUNKS,
  MAX_DIALOGUE_NOTES,
  MAX_GROUP_MESSAGES,
  MAX_MESSAGE_BYTES,
  MAX_NOTES,
  MAX_PEERS,
  SYNC_PROTOCOL_VERSION,
  buildLedger,
  describeSyncState,
  deviceLabel,
  findDivergences,
  groupAgreement,
  makeGroupMessage,
  makeNote,
  makeReceipt,
  makeReport,
  makeRequirement,
  pairingMatches,
  parseSyncMessage,
  questionOptions,
  renderGroupLine,
  renderGroupTranscript,
  renderLedger,
  noteAddressedTo,
  assignmentNotice,
  peerGroupLineReason,
  sortGroupTimeline,
  type GroupPhase,
  type PeerLine,
  type ReportStatus,
  type SyncGroupMessage,
  type SyncApprovalMessage,
  type SyncControlMessage,
  type RemotePreset,
  type SyncMessage,
  type SyncNote,
  type GroupAssetRef,
  type SyncAssetChunk,
  type SyncPeer,
  type SyncPlatform,
  type SyncReport,
  type SyncRequirement,
} from './lanProtocol';
import { initialTeamPhase, isTeamPhase, looksLikeExplicitGoAhead, looksLikePlanApproval, looksLikePlanRejection, teamPhaseLabel, type TeamPhase } from './planGate';
import { TEAM_DISCIPLINE_PROMPT, RECENT_POST_WINDOW, checkTeamPost, staleNudgeBody, staleWatchVerdict } from './processDiscipline';
import { normalizeRepoUrl } from './projectRef';
import { projectGate } from './projectGate';
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
  /**
   * 本机执行一条需求。
   *
   * `readOnly`：只读执行（能读能答、不能改文件）。项目不一致时用这一档 ——
   * 既能照常回复，又不会去改另一个项目的代码。
   */
  runRequirement(requirement: SyncRequirement, options?: { readOnly?: boolean }): Promise<boolean>;
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
   * 把**对端的内容**显示进「团队任务」对话（只显示，不额外开一轮）。
   *
   * 为什么必须单独有它（2026-11-26 用户实况）：「macOS 的消息，团队窗口 Windows 显示已读，
   * 但 Windows 的团队任务对话框实际没有 macOS 的新消息进去。」
   *
   * 根因：群消息（`team_sync action=analysis|question|progress|result`）以前**只**记进群记录、
   * 只画在团队群窗口，从未进过团队任务对话；只有 `send|ask`（note）才会进。
   * 于是「谁用了哪种动作」决定了对面能不能看见 —— 跟操作系统无关，纯属两条路径不一致。
   *
   * 这里只**追加显示**（进对话存档，下一轮读上下文时自然带上），**不触发任何运行**：
   * 群消息终究不是执行触发器（否则两个 agent 会互相接龙）。
   */
  onPeerLine?(line: PeerLine): Promise<void>;
  /**
   * 收到「已读回执」：有设备读到了群消息，面板要把「已读」画到对应气泡下面。
   *
   * 与 `onGroupMessage` 分开：回执不是发言，不追加气泡、不写群记录。
   */
  onGroupRead?(): Promise<void>;
  /**
   * 某台设备的 agent 状态变了（跑 / 停 / 出错 / 等确认）。
   *
   * 面板据此重画指示灯；与「已读回执」分开，便于各自节流。
   */
  onAgentState?(): Promise<void> | void;
  /**
   * 另一台发来的附件已经收齐并落到本机磁盘。
   *
   * 面板据此把「图片还在路上」换成真图；agent 那一轮则通过
   * `waitForAssets()` 拿到本机路径后再读。
   */
  onAssetReady?(id: string, path: string): Promise<void> | void;
  /**
   * 有更新的用户消息要执行，正在跑的那条必须停下。
   *
   * 用户明确要求：多台设备、多位用户在同一项目下发的命令冲突时，
   * **按时间先后执行最新的那条**。不打断旧的那条，两个 agent 会各做一半、
   * 改动互相覆盖，比谁都不做更难查。
   */
  onSuperseded?(info: { stopped: string; next: string; from: string }): void;
  /** 本机工作区里的项目名（供面板展示与选择）。 */
  localProjects?(): string[];
  /** 本机每个项目的仓库地址（与 `localProjects()` 同序）。 */
  localProjectRepos?(): string[];
  /** 本机当前工作区的仓库地址。 */
  localRepo?(): string;
  /**
   * 项目不一致：**先追问，别直接开跑**。
   *
   * 用户要求：选中不同项目时 agent 要问清楚，确认后才调整。
   * 同一 GitHub 账号、只是本机还没这个项目 → 提示去拉取。
   */
  onProjectMismatch?(info: {
    required: string;
    local: string;
    from: string;
    sameAccount: boolean;
    hasLocalCandidate: boolean;
  }): void;
  /** 本机 GitHub 登录名（拿不到就返回空串）。 */
  localLogin?(): string;
  /**
   * 主机没了（重启、改 IP、或对方断开）。
   *
   * 用来提示用户「你已经不在群里了」，而不是让界面继续显示「已连接」。
   */
  onHostLost?(address: string): void;
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
   * 本机刚输入、还没判断完的一条群发言：面板要**立刻**把它画出来。
   *
   * 判断是不是任务要问一次模型（一两秒），如果等它回来再上屏，
   * 用户发完话看着空荡荡的群会以为没发出去 —— 网络慢的那台尤其明显。
   */
  onGroupPending?(): void;
  /**
   * 另一台在群里说的、已被对方判定为「闲聊 / 问答」的一句话。
   *
   * 群里有两个 agent：甲方说「报数」，两台都该各自报自己的情况。
   * 以前只有发消息那台在答，看起来就像对方根本没进群。
   */
  onRemoteGroupChat?(message: SyncGroupMessage): Promise<void> | void;
  /**
   * 手机发来的一句话：走和群窗口完全相同的入口（判断「回答追问还是新需求」、广播、开跑）。
   *
   * 不在网络层重复实现这套判断 —— 两处判断迟早会不一致，那正是「手机说的和电脑说的不一样」的根因。
   */
  onMobileMessage?(text: string, assignee?: string): Promise<{ ok: boolean; message: string }>;
  /** 手机上是否允许批准工具授权（用户可在设置里关掉，关掉后手机只能看和说话）。 */
  canApproveFromPhone?(): boolean;
  /**
   * 自主迭代模式：谈定就开工，不等甲方确认。
   *
   * 用户 2026-11-26：「增加一个自主迭代模式，就是 agent 相互沟通好都确认没问题不需要用户确认，
   * 然后开始执行，适合自主迭代项目」。**只影响「要不要等甲方点头」**，
   * 不影响「先谈、只读」——谈判阶段照样没有写工具。
   */
  autonomousMode?(): boolean;
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
    action: 'preset' | 'steps' | 'stop' | 'state' | 'project' | 'stopGroup';
    preset?: RemotePreset;
    steps?: number;
    /** `project` 用：要切到的项目名与仓库地址（名字来自本机项目列表）。 */
    project?: string;
    repo?: string;
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
  /** 已读回执：群消息 id → 已读的设备 id。 */
  reads?: Record<string, string[]>;
  /** 已经被用户允许过的设备 id：重连不再打扰。 */
  approved?: string[];
  /**
   * 方案阶段：需求 id → 阶段。
   *
   * **必须落盘**：阶段原本只在内存里，重载窗口 / 重启 VS Code 就退回「谈」，
   * 甲方确认过的需求又变成「不许动手」—— 用户看到的是「确认了怎么还不动」。
   */
  phases?: Record<string, TeamPhase>;
  /** 上次的角色与主机地址：下次开窗口自动恢复连接。 */
  role?: 'hub' | 'peer';
  hub?: string;
  port?: number;
  /**
   * 本机选定的协作项目（文件夹名）与它的仓库地址。
   *
   * **必须落盘**：以前这两个只在内存里，`persist()` 不写、`load()` 也不读 ——
   * 于是「换项目」看起来点了没反应（重载/重开窗口就回到默认）。
   */
  collabProject?: string;
  collabRepo?: string;
  /**
   * 本机群的邀请码。
   *
   * 必须持久化：VS Code 重启后监听器没了，但用户手上/剪贴板里的邀请串还在。
   * 不恢复的话，另一台拿着这个码永远连不上（表现为 ECONNREFUSED）。
   */
  inviteCode?: string;
}

const STATE_LIMIT = 300;
/**
 * 「我在等队友回话」最多挡多久。
 *
 * 太短：队友在跑长任务时会被误判成「不用等了」；太长：对方离线时这一轮永远
 * 交不出结果。10 分钟与「一轮重活」同量级，超时就按「不再等」处理。
 */
const ASK_WAIT_EXPIRY_MS = 10 * 60_000;
/** 队友消息交付失败后的重投间隔：一轮收尾通常几秒内就结束。 */
const NOTE_RETRY_MS = 4_000;
/** 排队待交付的队友消息上限（长时间忙时兜底，不无限堆积）。 */
const MAX_PENDING_NOTES = 40;
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

/**
 * 挑一个最可能被对方连上的本机地址。
 *
 * 一台机器常有 WiFi + 有线 + WSL/Hyper-V/VMware 虚拟网卡，取「第一个」经常取到
 * 虚拟网卡（`172.x`），对方根本连不上，所以按常见家庭/办公网段排序。
 */
export function preferredAddress(): string {
  const score = (ip: string): number => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    if (ip.startsWith('169.254.')) return 4;
    return 3;
  };
  return [...lanAddresses()].sort((left, right) => score(left) - score(right))[0] ?? '';
}

/**
 * 邀请串：**一段文本同时带地址和码**，复制粘贴就能进群。
 *
 * 为什么不只给 6 位码：找群要靠 UDP 广播，而广播在开着代理 TUN、
 * 或路由器禁广播的环境里会完全失效（实测 macOS 一个包都收不到）。
 * 把地址写进邀请串里，就不再依赖广播。
 */
export function makeInviteText(code: string, port: number): string {
  const host = preferredAddress();
  return host ? `${host}:${port}#${code}` : code;
}

/** 解析邀请串：`192.168.0.3:47821#K7M2QX`、`K7M2QX`、纯地址都能认。 */
export function parseInviteText(input: string): { code: string; address?: string } {
  const raw = input.trim();
  const hash = raw.indexOf('#');
  if (hash >= 0) {
    const left = raw.slice(0, hash).trim();
    const code = normalizeInviteCode(raw.slice(hash + 1));
    return left ? { code, address: left } : { code };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(raw)) return { code: '', address: raw };
  return { code: normalizeInviteCode(raw) };
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
  /**
   * **已经收到、但还没交给本机 agent 的协作消息**（队友说给本机的话）。
   *
   * 2026-11-26 的真实故障（日志逐条可查）：Windows 这台在 00:06→08:01 之间收到
   * **14 条**队友消息，每一条都记了「队友消息（…）」，紧接着一行
   * 「面板正忙，队友消息已记录（team_sync status 可查看）」—— 也就是说消息到网了、
   * 落库了，但 `runNote()` 因为「本机正在跑」返回 false，而**没有任何重试**。
   * 用户看到的就是：Windows 问的问题 macOS 秒回，Windows 却毫无反应。
   *
   * 现在改成**排队重投**：忙就先攒着，一空下来（定时重试 + 每轮结束时主动 flush）
   * 逐条交付。交付成功才出队；同一条按 id 去重。
   */
  private pendingNotes: SyncNote[] = [];
  /**
   * 甲方按过「停止执行」：队友消息只记录、不交付，直到甲方重新发话。
   *
   * 见 `holdNoteDelivery()` / `resumeNoteDelivery()`。
   */
  private notesHeld = false;
  /** 自上次真正推进以来，agent 一共发了多少条（「停线」判据，见 `processDiscipline`）。 */
  private stalePosts = 0;
  /** 已经在哪条需求上停线提醒过（同一条需求只提醒一次，避免自己也刷屏）。 */
  private staleNudgedAt = '';
  /** 重投定时器：只在队列非空时存在。 */
  private noteRetryTimer?: ReturnType<typeof setInterval>;
  /**
   * 每条需求现在走到哪一步：谈 / 等确认 / 执行。
   *
   * 用户 2026-11-26：「我希望他们先沟通，只读取各自设备上的文件，不修改，沟通好了必须出一份
   * 各自都同意且认为可行的方案给用户，用户确认了再动手修改文件。」
   * 阶段存在**服务层**而不是面板里：面板可能被关掉、被重载，而「这条需求还没批准」这件事
   * 不能因为重启就被忘掉（忘了就等于默认批准）。
   */
  private phases = new Map<string, TeamPhase>();
  /**
   * 本机 agent 问出去、**还没等到回话**的问题。
   *
   * 用户实况（2026-11-25）：「每次我要求群里的 agent 互相沟通、达成一致的方案的时候，
   * 就会有 agent 单方面读取并发出结果。我并没有看到沟通，实际上其他 agent 还没有执行完。」
   *
   * 根因不是提示词不够严：一轮跑完就会无条件往群里发「结果」，无论队友有没有回过话。
   * 所以这里按事实记账 —— 有未回答的提问时，这一轮的收尾**不许自称结果**，
   * 只能发「等对方回话」的进度；对方回话本身还会把本机叫醒去合并结论。
   */
  private pendingAsks: {
    noteId: string;
    topic: string;
    requirementId: string;
    at: number;
    /** 这条提问发给了谁（群里其它每一台）。全部回话才算「谈过了」。 */
    targets: { id: string; label: string }[];
    /** 已经回话的 target id。 */
    replied: string[];
  }[] = [];
  /** 正在 `waitForReply` 的提问：noteId → 唤醒函数。 */
  private askWaiters = new Map<string, () => void>();
  /** 每条提问收到的回答（按到达顺序）。 */
  private askReplies = new Map<string, SyncNote[]>();
  /** 团队群的全部发言（需求 / 解析 / 进度 / 结果）。 */
  private group: SyncGroupMessage[] = [];
  /**
   * 群消息 → 已读它的设备 id。
   *
   * 用户要求（2026-11-25）：「我发 @所有人的消息，window 这个 agent 收到后，
   * 这个消息下面会显示 Windows 这个 agent 已读」——否则分不清「没收到」和
   * 「收到了但正忙」。回执独立成 `kind: 'receipt'`，不进群记录、不产生气泡。
   */
  private reads = new Map<string, Set<string>>();
  /**
   * 附件分片的收件箱：资产 id → 已到的分片。
   *
   * 用户 2026-11-25：「我发在群聊天的图片，没法传递到各自 agent 的设备上，
   * 所以会显示看不到」。图片必须**真的传过去**，另一台的 agent 才看得到；
   * 但单条消息有 80 KB 上限，所以拆成分片、到齐才落盘（缺片绝不当成完整图）。
   */
  private readonly assetInbox = new Map<string, {
    name: string;
    mimeType: string;
    kind: 'image' | 'file';
    total: number;
    parts: Array<string | undefined>;
  }>();
  /** 已落盘的附件：资产 id → 本机文件路径。 */
  private readonly assetPaths = new Map<string, string>();
  /**
   * 每台设备的 agent 状态（团队群的指示灯）。
   *
   * 本机由面板上报（跑没跑、是不是卡在等确认），对端通过 `agentState` 控制消息上报；
   * 谁都不上报时按「空闲」显示，而不是瞎猜成「运行中」。
   */
  private readonly activities = new Map<string, { state: AgentActivity; at: number }>();
  /** 用户点过「允许」的设备。重连时直接放行，不再弹窗。 */
  private approved = new Set<string>();
  /** 上次的角色与主机：下次激活自动恢复（用户不用重复操作）。 */
  private lastRole: 'hub' | 'peer' = 'hub';
  private lastHub = '';
  private lastPort = 0;
  /** 正在让位给另一台主机：避免重复触发。 */
  private yielding = false;
  /** peer 心跳：主机没了要能发现，否则界面会一直显示「已连接」。 */
  private heartbeatTimer?: NodeJS.Timeout;
  private hostMisses = 0;
  /** 正在跑的需求（用来判断「新消息该不该顶掉它」）。 */
  private runningRequirement?: { id: string; createdAt: number };
  /**
   * Lamport 逻辑时钟：让**所有设备**对「谁更新」的判定一致。
   *
   * 只用本机 `Date.now()` 不行 —— 两台机器的时钟差几秒就会出现
   * 「A 认为 B 更新、B 认为 A 更新」，于是两边各跑各的，冲突反而更多。
   */
  private lastClock = 0;
  /** 本机群聊的邀请码（主机才有值）。空串表示这不是一个「等邀请码的群聊」。 */
  private inviteCode = '';
  /**
   * 加入别人群聊时用的邀请码。
   *
   * 之后每条消息都要带它 —— 否则主机按旧配对码校验会一律 403，
   * 表现就是「加入成功，但群消息和需求都传不过去」。
   */
  private joinedCode = '';
  /**
   * 本机参与协作的项目名（工作区文件夹名）。
   *
   * 只是**本地标签**：真正的项目身份是下面的 `collabRepo`（GitHub 仓库地址）。
   */
  private collabProject = '';
  /** 本机参与协作的项目的仓库地址（项目唯一 ID）。 */
  private collabRepo = '';
  /**
   * 刚发出去、还没判定完的一条群发言（只在本机显示，不广播）。
   *
   * 判断「这是闲聊还是任务」要问一次模型，通常一两秒。这段时间里用户的
   * 话必须已经在群窗口里，否则会以为没发出去。
   */
  private pendingGroup?: { body: string; at: number };
  /** 「发送中」的兜底计时器：中途抛错也不让它一直挂在群里。 */
  private pendingTimer?: NodeJS.Timeout;
  /** 最近若干条处置轨迹：谁发的、本机有没有作答。核对面板直接看这个。 */
  private traces: string[] = [];
  /**
   * UDP 发现端口（固定，不随 HTTP 端口变化）。
   * 可注入只是为了让测试与真实运行中的实例隔离；生产永远用 `DISCOVERY_PORT`。
   */
  readonly discoveryPort: number;
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
    options: { discoveryPort?: number } = {},
  ) {
    this.discoveryPort = options.discoveryPort && options.discoveryPort > 0
      ? options.discoveryPort
      : DISCOVERY_PORT;
  }

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
      this.reads = new Map(Object.entries(parsed.reads ?? {})
        .filter(([, ids]) => Array.isArray(ids))
        .map(([id, ids]) => [id, new Set((ids as unknown[]).filter((item): item is string => typeof item === 'string'))] as const)
        .slice(-MAX_GROUP_MESSAGES));
      this.approved = new Set(Array.isArray(parsed.approved)
        ? parsed.approved.filter((item): item is string => typeof item === 'string').slice(0, 32)
        : []);
      /*
       * 阶段：只认认识的阶段名。
       *
       * 「谈判 / 等确认」这类状态必须以文件为准 —— 内存里丢了就成了「默认可以动手」的反面
       * （默认是 negotiate，安全方向），但会让甲方确认过的需求突然又不动手。
       */
      this.phases = new Map(
        Object.entries(parsed.phases ?? {})
          .filter(([id, phase]) => id.length > 0 && isTeamPhase(phase))
          .map(([id, phase]) => [id, phase as TeamPhase] as const)
          .slice(-STATE_LIMIT * 4),
      );
      this.lastRole = parsed.role === 'peer' ? 'peer' : 'hub';
      this.lastHub = typeof parsed.hub === 'string' ? parsed.hub : '';
      this.lastPort = typeof parsed.port === 'number' && parsed.port > 0 ? parsed.port : 0;
    this.inviteCode = typeof parsed.inviteCode === 'string' ? parsed.inviteCode : '';
    this.collabProject = typeof parsed.collabProject === 'string' ? parsed.collabProject.slice(0, 80) : '';
    this.collabRepo = normalizeRepoUrl(typeof parsed.collabRepo === 'string' ? parsed.collabRepo : '');
    } catch {
      // 第一次运行没有文件，正常。
    }
    // 读回来之后先自愈：历史版本可能把仓库地址存成了项目名。
    this.repairCollabTarget();
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
      reads: Object.fromEntries([...this.reads.entries()].map(([id, peers]) => [id, [...peers]])),
      approved: [...this.approved],
      phases: Object.fromEntries(this.phases),
      role: this.lastRole,
      hub: this.lastHub,
      port: this.lastPort,
      ...(this.inviteCode ? { inviteCode: this.inviteCode } : {}),
      ...(this.collabProject ? { collabProject: this.collabProject } : {}),
      ...(this.collabRepo ? { collabRepo: this.collabRepo } : {}),
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
    const base = this.bridge.peer();
    /*
     * 群里说一句「用 xxx 项目」就能切项目，这一步必须**立刻**体现在对外身份上，
     * 否则对端要等到下次改设置才发现项目变了。
     */
    return {
      ...base,
      ...(this.collabProject ? { project: this.collabProject } : {}),
      ...(this.collabRepo ? { repo: this.collabRepo } : {}),
      ...(this.ownHost() ? { host: this.ownHost() } : {}),
    };
  }

  /**
   * 本机局域网 IP（只用于「同名设备分不清」时显示）。
   *
   * 枚举网卡不便宜，缓存一次；地址变了（换 WiFi）由下次 reload 重新取，
   * 这一项只影响显示，不影响任何连接逻辑。
   */
  private ownHostCache?: string;
  private ownHost(): string {
    if (this.ownHostCache === undefined) this.ownHostCache = lanAddresses()[0] ?? '';
    return this.ownHostCache;
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
      await this.ingestRelayControl(message, 'relay');
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
  private async ingestRelayControl(message: SyncControlMessage, via: 'lan' | 'relay' = 'lan'): Promise<void> {
    if (message.from.id === this.bridge.peer().id) return;
    /*
     * 两种来源，边界不同：
     *
     * - **同群的可信设备**（对方那台电脑）：可以让我切项目、可以问我的状态；
     *   但**不能**改我的权限档位 / 步数 / 中止任务 —— 那是安全边界，只留给本机和手机授权。
     * - **手机**：要 `canApproveFromPhone()` 才允许动权限。
     *
     * 以前这里一律要求"允许手机操作"，于是另一台电脑让我切项目永远被忽略 ——
     * 用户看到的正是「切换无效」。
     */
    const fromTrustedDevice = this.approved.has(message.from.id);
    if (message.action === 'agentState') {
      // 对端上报状态：只记下来画指示灯，不触发任何执行、也不回包（否则互相回声）。
      if (message.agentState) {
        const previous = this.activities.get(message.from.id)?.state;
        this.activities.set(message.from.id, { state: message.agentState, at: message.at });
        if (previous !== message.agentState) void this.bridge.onAgentState?.();
        this.bridge.onState?.();
      }
      return;
    }
    if (message.action === 'project') {
      if (!fromTrustedDevice) {
        this.bridge.log(`[sync] 收到远程切项目，但来源设备未被信任，已忽略`, 'warn');
        return;
      }
      const apply = this.bridge.onRemoteControl;
      if (!apply) return;
      try {
        const result = await apply({
          action: 'project',
          ...(message.project ? { project: message.project } : {}),
          ...(message.repo ? { repo: message.repo } : {}),
        });
        this.bridge.log(`[sync] 远程切项目：${result.message}`);
      } catch (error) {
        this.bridge.log(`[sync] 远程切项目失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
      }
      return;
    }
    if (message.action === 'state') {
      /* 对方在问「你现在是什么设置」：直接把真实状态广播回去。 */
      if (fromTrustedDevice || (this.bridge.canApproveFromPhone?.() ?? false)) {
        const result = await this.bridge.onRemoteControl?.({ action: 'state' });
        if (result) this.bridge.log(`[relay] 已回复状态查询：${result.message}`);
      }
      return;
    }
    if (message.action === 'stopGroup') {
      /*
       * 甲方在团队群点了「停止执行」：**群里每一台都要停**。
       *
       * 用户 2026-11-26 报障：「团队群的停止执行按钮，点击后群里的 agent 并没有停止」。
       * 复核发现两处会把它吞掉，都已修：
       *
       *  1. **信任判据太窄**：以前要求 `approved`（用户点过「允许」的那台）。
       *     但这条消息能走到这里，说明它**已经带着本群的配对凭据** —— 凭据本身就是身份。
       *     两台自动连上、或重装扩展之后 `approved` 是空的，于是停止被静默忽略，
       *     日志里只有一行 warn，甲方看到的就是「按了没反应」。
       *     停止是**安全动作**（让我的 agent 停手），不是提权，不该要额外授权。
       *  2. **停完又被排队的队友消息重新开跑**：停止 → 那一轮结束 → `flushPendingNotes()`
       *     把排队的消息交给 agent → 立刻又开一轮。看起来就是「停了还在动」。
       *     现在停止会**清空队列并暂停交付**，直到甲方在群里重新说话。
       */
      const stopTrusted = fromTrustedDevice
        || (via === 'relay' && !(message.from.version === 'web' || message.from.name.includes('手机')))
        || (this.bridge.canApproveFromPhone?.() ?? false)
        // 局域网里能走到这里的都已经过配对凭据校验；停止属于安全动作，直接认可。
        || message.from.id !== this.bridge.peer().id;
      if (!stopTrusted) {
        this.bridge.log('[sync] 收到群的停止执行，但来源设备未被信任，已忽略', 'warn');
        return;
      }
      this.bridge.log(`[sync] 收到 ${message.from.name} 的停止执行（凭据已校验）`);
      const result = await this.bridge.onRemoteControl?.({ action: 'stopGroup' });
      if (!result) return;
      this.bridge.log(`[sync] 群的停止执行：${result.message}`);
      this.trace(`收到 ${message.from.name} 的停止执行：${result.message}`);
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
        ...(message.project ? { project: message.project } : {}),
        ...(message.repo ? { repo: message.repo } : {}),
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
      localId: this.bridge.peer().id,
      role: this.role,
      peers: base.peers,
      /*
       * 按**到达顺序**排（`sortGroupTimeline`），不是按两台设备各自的时间戳。
       *
       * 真实故障（2026-11-26）：两台系统时钟差 123 ms，按 `at` 排会把对端的回复
       * 排到我们刚发出的需求前面 —— 手机上看起来就是「回复在我的话上面」。
       */
      messages: sortGroupTimeline(base.messages).slice(-60),
      /*
       * 项目名与已读回执：桌面群窗口都有，手机不给就等于「看不见队友收到没有、
       * 也不知道这一轮在哪个项目里改」。两样都是纯展示，不影响权限。
       */
      ...(this.activeProjectName() ? { projectName: this.activeProjectName() } : {}),
      /* 阶段：手机顶部也显示「沟通中（只读）/ 方案待确认 / 已确认，执行中」。 */
      ...(() => {
        const active = this.activePhase();
        return active ? { phase: active.phase, phaseLabel: this.phaseLabelWithMode(active.phase), autonomous: this.autonomous() } : {};
      })(),
      /*
       * 已读回执**在服务端就翻成人话**。
       *
       * 用户 2026-11-26：「手机上显示的设备都是一串字母数字」。手机拿到的是设备 id，
       * 而 id 只在两台机器的内存里对得上；手机既没有那台设备的历史，也拿不到
       * `peers` 已经被裁掉的老设备 —— 于是只能原样打一串哈希。
       * 这里直接给「已读」的名称，手机端不再需要做任何 id → 名字的猜测。
       */
      reads: Object.fromEntries(Object.entries(this.allReads()).map(([id, peers]) => [
        id,
        peers.map((peerId) => this.labelForPeerId(peerId)),
      ])),
      /** id → 统一标识（系统 · 设备名），手机上任何地方都不再直接显示 id。 */
      labels: Object.fromEntries(this.allPeerIds().map((id) => [id, this.labelForPeerId(id)])),
      /*
       * 队友之间的往来也交给手机。
       *
       * 用户 2026-11-26：「让 agent 的消息也像用户消息一样，能被相互看见」——
       * 手机上看不到 agent 讨论，甲方就无法判断两个 agent 到底谈没谈、谈到哪。
       */
      dialogue: base.dialogue.map((item) => ({
        id: item.id,
        who: item.who,
        body: item.body,
        at: item.at,
        ...(item.receivedAt !== undefined ? { receivedAt: item.receivedAt } : {}),
        replyTo: item.replyTo,
        ...(item.to ? { to: item.to } : {}),
        ...(item.toLabel ? { toLabel: item.toLabel } : {}),
      })),
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
    if (this.role === 'hub' && this.server) return { ok: true, message: `群聊已在运行（端口 ${this.port}）` };
    this.stopListener();
    this.usePort(port);
    try {
      await this.startListener();
      await this.startDiscovery();
      this.role = 'hub';
      this.hubAddress = '';
      this.bridge.log(`[sync] 群聊监听已启动，端口 ${this.port}（发现端口 ${this.configuredPort}）`);
      this.bridge.onState?.();
      return {
        ok: true,
        message: `群聊已就绪（端口 ${this.port}）。把邀请码给对方，对方点「加入群聊」粘贴即可。`,
      };
    } catch (error) {
      this.role = 'off';
      const message = error instanceof Error ? error.message : String(error);
      this.bridge.log(`[sync] 启动主机失败：${message}`, 'warn');
      return { ok: false, message: `启动主机失败：${message}` };
    }
  }

  /** 本机协作项目名（空串=用默认）。 */
  currentProject(): string {
    return this.collabProject;
  }

  /**
   * 这个群在做的项目名 —— **对外唯一口径**。
   *
   * 以前「群里显示的」「agent 回复里标的」「需求带的」各用一套：
   * 有的用 `collabProject`、有的用 `bridge.peer().project`（当前打开的文件夹），
   * 于是群里写 personal-workstation、agent 却说 deepseek-hwchat。
   * 现在只有这一个函数，全部调用它。
   */
  activeProjectName(): string {
    return this.collabProject || this.bridge.peer().project || '';
  }

  /**
   * 自愈存坏的项目选择。
   *
   * 真实坏数据：`github.com/gsaecy/plaitcode` 被当成项目名存了下来，
   * 界面于是显示成仓库地址，看起来「切换错了」。这里把它还原成文件夹名；
   * 还原不出来就清空，宁可回到默认，也不要显示一个不存在的项目。
   */
  private repairCollabTarget(): void {
    const projects = this.bridge.localProjects?.() ?? [];
    const repos = this.bridge.localProjectRepos?.() ?? [];
    const asRepo = normalizeRepoUrl(this.collabProject);
    if (asRepo) {
      const index = repos.findIndex((item) => normalizeRepoUrl(item) === asRepo);
      this.collabProject = index >= 0 ? projects[index] ?? '' : '';
      if (!this.collabRepo) this.collabRepo = asRepo;
      this.bridge.log(`[sync] 修正存坏的项目名：仓库 ${asRepo} → 「${this.collabProject || '（默认）'}」`);
    }
    // 有仓库但没名字：按仓库找回本机对应的文件夹。
    if (!this.collabProject && this.collabRepo) {
      const index = repos.findIndex((item) => normalizeRepoUrl(item) === this.collabRepo);
      if (index >= 0) this.collabProject = projects[index] ?? '';
    }
    // 名字不在本机文件夹里：清掉，别让界面显示一个不存在的项目。
    if (this.collabProject && projects.length && !projects.includes(this.collabProject)) {
      this.bridge.log(`[sync] 项目「${this.collabProject}」不在本机工作区，已清空选择`, 'warn');
      this.collabProject = '';
    }
  }

  /** 本机协作项目的仓库地址（项目唯一 ID）。 */
  currentRepo(): string {
    return this.collabRepo || (this.bridge.localRepo?.() ?? '');
  }

  /**
   * 选定本机参与协作的项目。
   *
   * `repo` 是项目唯一 ID（仓库地址）；`name` 只是本地文件夹名，仅用于展示。
   *
   * **必须容忍传进来的是仓库地址。** 用户实况：让 Windows 切项目，「切换到这个项目」
   * 那个按钮传的是 `info.required`，而它是仓库地址 —— 结果项目名被设成了
   * `github.com/gsaecy/plaitcode`，界面看起来就像"切错了项目"（原来是 deepseek-hwchat）。
   * 所以这里统一解析：仓库地址 → 本机对应文件夹名；解析不出来就别拿它当名字。
   */
  async setCollabProject(name: string, repo = ''): Promise<void> {
    const raw = (name ?? '').trim().slice(0, 200);
    const projects = this.bridge.localProjects?.() ?? [];
    const repos = this.bridge.localProjectRepos?.() ?? [];
    let resolvedName = raw;
    let resolvedRepo = normalizeRepoUrl(repo);
    const asRepo = normalizeRepoUrl(raw);
    if (asRepo) {
      // 传进来的是仓库地址：换成本机那个文件夹的名字（同一个仓库可能叫别的名）。
      const index = repos.findIndex((item) => normalizeRepoUrl(item) === asRepo);
      if (index < 0 && this.currentRepo() !== asRepo) {
        /*
         * 本机没有这个仓库：**不能**把协作项目设成它。
         *
         * 否则这台只是"登记"了一个自己没有的项目，界面看起来切过去了，
         * 实际没有任何目录能改 —— 那正是「切换错了」的体感。
         */
        this.bridge.log(`[sync] 本机没有仓库 ${asRepo}，不切换项目`, 'warn');
        if (this.role !== 'off') {
          await this.postGroup({
            author: 'agent',
            phase: 'analysis',
            body: `本机没有 ${asRepo} 这个项目，所以没有切换。需要先把它拉下来（git clone），我才能在这个项目上干活。`,
          }).catch(() => undefined);
        }
        return;
      }
      resolvedName = index >= 0 ? projects[index] ?? '' : '';
      if (!resolvedRepo) resolvedRepo = asRepo;
    }
    if (resolvedName && projects.length && !projects.includes(resolvedName)) {
      // 名字既不是本机文件夹、也不是仓库：不认，保留原来的选择，避免"切到不存在的项目"。
      this.bridge.log(`[sync] 忽略无法识别的项目「${raw}」（本机没有这个文件夹）`, 'warn');
      return;
    }
    this.collabProject = resolvedName.slice(0, 80);
    this.collabRepo = resolvedRepo;
    await this.persist();
    this.bridge.log(
      `[sync] 协作项目设为「${this.collabProject || '（本机当前文件夹）'}」${this.collabRepo ? `（仓库 ${this.collabRepo}）` : ''}`,
    );
    this.bridge.onState?.();
    /*
     * **切了项目就在群里说一句。**
     *
     * 用户的实况：让 Windows 切项目，「它没回应」—— 只在右侧弹了通知或干脆没声音，
     * 群里的人根本不知道发生了什么。现在不管从哪个入口切的，群里都会有回执。
     */
    if (this.role !== 'off') {
      await this.postGroup({
        author: 'agent',
        phase: 'analysis',
        body: `这台已切到「${this.activeProjectName() || '本机当前文件夹'}」${this.currentRepo() ? `，项目 ID：${this.currentRepo()}` : '（该文件夹未绑定 GitHub 仓库）'}。`,
      }).catch(() => undefined);
    }
  }

  /**
   * 本机有没有对方那个项目。
   *
   * **按仓库地址判断**：同一个仓库在别的机器上可能叫另一个文件夹名。
   */
  hasProject(repoOrName: string): boolean {
    if (!repoOrName) return false;
    const wanted = normalizeRepoUrl(repoOrName);
    if (wanted) {
      if (this.currentRepo() === wanted) return true;
      const repos = this.bridge.localProjectRepos?.() ?? [];
      if (repos.some((item) => normalizeRepoUrl(item) === wanted)) return true;
    }
    return this.localProjects().includes(repoOrName);
  }

  /** 群里最近一条需求的号（回执拿不到自己的需求号时用它兜底）。 */
  latestRequirementId(): string {
    return this.requirements[this.requirements.length - 1]?.id ?? '';
  }

  /** 群里最近一条需求的标题（团队任务窗口显示「在做什么」）。 */
  latestRequirementTitle(): string {
    const last = this.requirements[this.requirements.length - 1];
    return last?.title ?? '';
  }

  /** 本机工作区里的项目名（面板展示 / 选择用）。 */
  localProjects(): string[] {
    return this.bridge.localProjects?.() ?? [];
  }

  /**
   * 立刻把「我刚发的话」画到群窗口里（不等判定）。
   *
   * 只是本机显示：对方看到的是这条话**判定完之后的正式消息**，
   * 两条内容一样，所以不会出现「我这边一条、对面一条不一样」。
   */
  beginPendingGroup(body: string): void {
    const text = (body ?? '').trim();
    if (!text) return;
    this.pendingGroup = { body: text, at: Date.now() };
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => this.endPendingGroup(), 30_000);
    this.pendingTimer.unref?.();
    this.bridge.onGroupPending?.();
  }

  /** 判定结束 / 正式消息已经进群：把临时那条收掉。 */
  endPendingGroup(): void {
    if (!this.pendingGroup) return;
    this.clearPendingGroup();
    this.bridge.onGroupPending?.();
  }

  /** 只清状态、不通知界面（正式消息马上就会触发一次刷新）。 */
  private clearPendingGroup(): void {
    this.pendingGroup = undefined;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }
  }

  /** 本机每个项目的仓库地址（与 `localProjects()` 同序）。 */
  localProjectRepos(): string[] {
    return this.bridge.localProjectRepos?.() ?? [];
  }

  /**
   * 探测每台设备：现在到底是谁、跑的是哪个版本、多久回。
   *
   * 这是「自查」的核心 —— 两台跑不同版本时行为必然不同，
   * 以前只能靠猜「是不是没更新」，现在是直接问出来。
   */
  async probePeers(): Promise<PeerProbe[]> {
    const targets = this.peerList().filter((entry) => entry.address);
    return Promise.all(targets.map(async (entry): Promise<PeerProbe> => {
      const started = Date.now();
      try {
        const text = await getRaw(entry.address, '/hwchat-sync/v1/ping', 3_000);
        const parsed = JSON.parse(text) as { peer?: { version?: unknown }; protocol?: unknown };
        return {
          name: entry.peer.name,
          address: entry.address,
          ok: true,
          ms: Date.now() - started,
          version: typeof parsed.peer?.version === 'string' ? parsed.peer.version : '（旧版未上报）',
          protocol: typeof parsed.protocol === 'number' ? parsed.protocol : 0,
        };
      } catch (error) {
        return {
          name: entry.peer.name,
          address: entry.address,
          ok: false,
          ms: Date.now() - started,
          version: '',
          protocol: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
  }

  /**
   * 让群里**所有 agent** 停手（团队群窗口那颗「停止执行」）。
   *
   * 用户的要求：「团队群界面的停止执行，需要应用到群里的所有 agent，
   * 而不是只应用到本设备的团队任务对话框」。以前那颗按钮只停本机，
   * 另一台收到后毫无察觉，还在继续改文件 —— 甲方以为全都停了。
   *
   * 走 control 通道而不是群消息：群消息会被落成需求，
   * 对端收到反而**再开跑一轮**，正好相反。
   */
  async broadcastStop(): Promise<{ ok: boolean; message: string }> {
    const control: SyncControlMessage = {
      kind: 'control',
      id: `ctl-stopall-${this.bridge.peer().id.slice(0, 8)}-${Date.now().toString(36)}`,
      from: this.localPeer(),
      action: 'stopGroup',
      at: Date.now(),
    };
    /*
     * 先停**本机**。
     *
     * 手机上的「停止执行」走的就是这个方法：单机（`role === 'off'`，只有这台电脑）
     * 根本没有对端可播，以前直接返回「只有本机，已停」却**什么都没停** ——
     * 用户看到的是一句成功提示，实际任务还在跑。桌面群窗口是本机另外调的，
     * 手机没有那条路，所以这里必须自己停。
     */
    const local = await this.bridge.onRemoteControl?.({ action: 'stopGroup' }).catch(() => undefined);
    // 跨网那一路（中继）；没接中继时是空操作，不影响局域网。
    void this.relayOut(control);
    if (this.role === 'off') {
      return {
        ok: local?.ok !== false,
        message: local?.ok === false ? (local.message || '本机没停下来。') : '只有本机，已停。',
      };
    }
    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.credential(), port: this.port, message: control });
    try {
      if (this.role === 'hub') {
        const targets = this.peerList().filter((entry) => entry.address);
        const results = await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
        const delivered = results.filter((result) => result.status === 'fulfilled').length;
        if (!targets.length) return { ok: true, message: '只有本机在线，已停。' };
        this.trace(`让 ${delivered}/${targets.length} 台设备停手`);
        return {
          ok: delivered > 0,
          message: delivered === targets.length
            ? `已通知群里 ${delivered} 台设备停手。`
            : `已通知 ${delivered}/${targets.length} 台设备停手，其余没连上。`,
        };
      }
      const response = await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', {
        code: this.credential(),
        port: this.port,
        message: control,
      }).catch(() => undefined);
      this.trace(response?.ok ? '已让主机转发停止' : '停止指令没能交给主机');
      return response?.ok
        ? { ok: true, message: '已交给主机转发停止。' }
        : { ok: false, message: '没连上主机，只有本机停了。' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.bridge.log(`[sync] 广播停止失败：${reason}`, 'warn');
      return { ok: false, message: `只有本机停了（通知失败：${reason}）。` };
    }
  }

  /** 记一条处置轨迹（只留最近若干条，给核对面板看）。 */
  trace(line: string): void {
    this.traces = [...this.traces, `${new Date().toTimeString().slice(0, 8)} ${line}`].slice(-40);
  }

  /** 最近的处置轨迹：每条群消息到底被谁怎么处理了。 */
  recentTraces(limit = 20): string[] {
    return this.traces.slice(-Math.max(1, limit));
  }

  /**
   * 让**另一台**设备切项目。
   *
   * 用户的需求：「我需要每个设备都能切换项目，而不是只能切换本设备的项目」。
   * 走 control 通道直达那台设备，不动本机选择；对方收到后会自己切，
   * 并在群里回执（所以发起方不用猜成没成）。
   */
  async requestProjectSwitch(
    targetId: string,
    project: string,
    repo = '',
  ): Promise<{ ok: boolean; message: string }> {
    const text = (project ?? '').trim();
    if (!targetId || !text) return { ok: false, message: '没指定设备或项目。' };
    if (this.role === 'off') return { ok: false, message: '现在没有群，无法控制其它设备。' };
    const control: SyncControlMessage = {
      kind: 'control',
      id: `ctl-project-${this.bridge.peer().id.slice(0, 8)}-${Date.now().toString(36)}`,
      from: this.localPeer(),
      action: 'project',
      project: text,
      ...(normalizeRepoUrl(repo) ? { repo: normalizeRepoUrl(repo) } : {}),
      at: Date.now(),
    };
    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.credential(), port: this.port, message: control });
    /*
     * 局域网里可能有多台：找到那台的地址直接投递。
     * 找不到地址就退回主机转发（从机只能经过主机）。
     */
    const entry = this.peerList().find((item) => item.peer.id === targetId && item.address);
    try {
      if (entry?.address) {
        await postRaw(entry.address, '/hwchat-sync/v1/deliver', payload);
        return { ok: true, message: `已让「${entry.peer.name}」切到「${text}」。` };
      }
      if (this.role === 'peer') {
        await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', {
          code: this.credential(),
          port: this.port,
          message: control,
        });
        return { ok: true, message: `已把「切到 ${text}」转给主机。` };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.bridge.log(`[sync] 远程切项目失败：${reason}`, 'warn');
      return { ok: false, message: `没能让那台切项目：${reason}` };
    }
    return { ok: false, message: '没有找到那台设备的地址。' };
  }

  /** 本机群聊的邀请码；不是主机时为空串。 */
  currentInviteCode(): string {
    return this.inviteCode;
  }

  /**
   * 请求要带的通行证。
   *
   * 当主机的用自己群的邀请码；加入别人的用加入时那个码；
   * 都没有才退回旧配对码（高级手动连接）。
   */
  private credential(): string {
    return this.inviteCode || this.joinedCode || this.code;
  }

  /** 复制给别人用的邀请串（带地址，粘贴即可，不依赖广播）。 */
  currentInviteText(): string {
    return this.inviteCode ? makeInviteText(this.inviteCode, this.port) : '';
  }

  /**
   * 启动群聊：生成邀请码并成为主机，等别人填码进来。
   *
   * 这是新的、也是唯一的开群入口 —— 不做「自动找设备然后互相比谁让位」那一套。
   * 谁开群谁当主机，谁想进来谁填码，角色永远清楚。
   */
  async startGroup(port?: number): Promise<{ ok: boolean; message: string; code?: string; text?: string }> {
    const code = makeInviteCode();
    const started = await this.startHub(port);
    if (!started.ok) {
      this.inviteCode = '';
      return { ok: false, message: started.message };
    }
    /*
     * 开新群 = 全新的一段对话。
     *
     * 以前旧群的需求、发言、进度、队友全留着，新群一打开就是上一轮的记录，
     * 用户根本分不清这是新群还是旧群。现在开群就清干净。
     */
    this.requirements = [];
    this.reports = [];
    this.notes = [];
    this.group = [];
    // 新群不该带着上一轮的队友和设备。
    this.peers.clear();
    this.inviteCode = code;
    // 记下**实际**监听端口：重启后按它恢复，端口对不上等于没恢复。
    this.lastPort = this.port;
    // 立刻落盘：不然 VS Code 一重启，这个码就再也对不上了。
    await this.persist();
    // 立刻用新码广播一次，别让从机等下一个周期。
    this.announceNow();
    const text = makeInviteText(code, this.port);
    this.bridge.log(`[sync] 群聊已开，邀请码 ${code}（邀请串 ${text}）`);
    this.bridge.onState?.();
    return {
      ok: true,
      code,
      text,
      message: `群聊已开。邀请码 ${code} —— 在另一台点「加入群聊」，把「复制邀请码」复制到的那一整串粘进去即可。`,
    };
  }

  /**
   * 填邀请码加入群聊。
   *
   * 邀请码既用来**找到**群（广播里带码），也用来**通过**主机的校验 ——
   * 用户只需要抄一个 6 位码，不需要知道 IP、端口、配对码。
   *
   * `address` 只在广播被拦时兜底（高级用法 / 测试），正常路径不要传。
   */
  async joinGroup(
    code: string,
    port?: number,
    address?: string,
    options: { allowWhileHosting?: boolean } = {},
  ): Promise<{ ok: boolean; message: string; needsSwitch?: boolean }> {
    /*
     * 正在当群主的机器不该去加入别人。
     *
     * 加入前会先关掉本机监听 —— 一台正在等别人加入的主机点了「加入群聊」，
     * 就等于把自己的群关了，结果两台谁都不在监听（用户看到的就是「连不上」）。
     * 这里直接拦住并说清该怎么做。
     */
    if (this.role === 'hub' && this.inviteCode && !options.allowWhileHosting) {
      /*
       * 不硬拦，交给上层问用户。
       *
       * 两台都点了「启动群聊」是极常见的操作，直接拒绝会让人以为坏了；
       * 但**默默离开自己的群**更糟 —— 对方还拿着旧码在等。
       * 所以这里只如实返回「需要确认」，由界面弹一次选择。
       */
      return {
        ok: false,
        needsSwitch: true,
        message: `这台电脑正在当群主（邀请码 ${this.inviteCode}）。`,
      };
    }
    /*
     * 输入可以是纯邀请码，也可以是完整邀请串（`192.168.0.3:47821#K7M2QX`）。
     * 后者不需要广播 —— 在广播被拦的环境里这是**唯一**能走通的路。
     */
    const parsed = parseInviteText(code);
    const wanted = parsed.code;
    const direct = address?.trim() || parsed.address;
    if (!wanted) {
      return { ok: false, message: '请填写邀请码（或直接粘贴对方「复制邀请码」复制的那一整串）。' };
    }
    this.bridge.log(`[sync] 加入群聊：规范化后的邀请码 ${wanted}${direct ? `，直连 ${direct}` : ''}`);
    this.usePort(port ?? this.configuredPort);
    this.stopListener();
    try {
      await this.startListener();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.bridge.log(`[sync] 加入群聊失败：本机监听起不来（${message}）`, 'warn');
      return { ok: false, message: `本机监听失败：${message}` };
    }
    let target: string;
    if (direct) {
      // 有地址就直连，完全不碰广播。
      target = normalizeHubAddress(direct, this.port);
      this.bridge.log(`[sync] 加入群聊：按邀请串直连 ${target}`);
    } else {
      this.bridge.log(`[sync] 加入群聊：本机已在 ${this.port} 监听，开始在 ${this.discoveryPort} 上找群`);
      target = await this.discover(wanted);
    }
    if (!target) {
      this.role = 'off';
      this.stopListener();
      /*
       * 分清两种失败：
       *  - 一个群都没听到 → 广播被拦（代理 TUN / 路由器禁广播 / 防火墙）；
       *  - 听到了群但码不对 → 只是抄错了码。
       * 混成一句「没找到」会让用户去查根本没问题的那一项。
       */
      const heard = [...new Set(this.lastHeard.map((item) => item.code).filter(Boolean))];
      const detail = heard.length
        ? `这台电脑听到了 ${heard.length} 个群（${heard.join('、')}），但没有一个和 ${wanted} 一致 —— 请核对另一台电脑上显示的邀请码。`
        : '这台电脑收不到群聊广播（常见于开着代理 TUN、路由器禁广播、或防火墙拦截）。请让对方点「复制邀请码」，然后把整串（形如 192.168.0.3:47821#XXXXXX）粘进来。';
      this.bridge.log(`[sync] 加入群聊失败：${detail}`, 'warn');
      return { ok: false, message: `加入失败：${detail}` };
    }
    this.bridge.log(`[sync] 加入群聊：找到 ${target}，正在配对`);
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
    /*
     * 网络层的瞬时失败要重试。
     *
     * 真机踩过：对方 DHCP 换了 IP（.3 → .2），本机 ARP 缓存里还没有新地址，
     * 第一次连接直接 EHOSTUNREACH；过了几十秒再连就通了。
     * 一次失败就放弃，用户只会看到「连不上」，而实际上再试就好。
     */
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const text = await postRaw(target, '/hwchat-sync/v1/pair', JSON.stringify(body));
        const data = JSON.parse(text) as Record<string, unknown>;
        return { ok: true, data };
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        lastError = raw;
        // 业务错误（邀请码不对等）重试没有意义，只会重复打扰对方。
        if (/\{"ok":false/.test(raw)) break;
        const transient = /EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAGAIN|ECONNRESET/i.test(raw);
        if (!transient || attempt === 3) break;
        this.bridge.log(`[sync] 连接 ${target} 暂时失败（${attempt}/3），稍后重试：${raw.slice(0, 80)}`);
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
    const match = lastError.match(/\{"ok":false,"error":"([^"]*)"\}/);
    return { ok: false, error: match?.[1] || lastError.slice(0, 160) };
  }

  /**
   * 连接前先把 ARP 打通。
   *
   * 对方 DHCP 换过 IP 时，本机 ARP 里没有新地址，第一次连接会 EHOSTUNREACH。
   * 先做一次短超时的 TCP 尝试（不看结果），让系统把 ARP 解析出来，
   * 后续真正的请求就不用再等这一轮。
   */
  private warmUp(target: string): Promise<void> {
    return new Promise((resolve) => {
      let host = '';
      let port = 80;
      try {
        const url = new URL(target);
        host = url.hostname;
        port = Number(url.port) || 80;
      } catch {
        resolve();
        return;
      }
      const socket = createConnection({ host, port, timeout: 1_200 });
      const done = (): void => { socket.destroy(); resolve(); };
      socket.once('connect', done);
      socket.once('timeout', done);
      socket.once('error', done);
    });
  }

  private async finishJoin(target: string, code: string): Promise<{ ok: boolean; message: string }> {
    await this.warmUp(target);
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
      this.bridge.log(`[sync] 加入群聊失败：主机拒绝或不可达（${reason || '没有响应'}）`, 'warn');
      // 邀请码错与连不上，用户要做的事完全不同，分开说。
      if (/邀请码/.test(reason)) {
        return { ok: false, message: `加入失败：${reason}。请核对另一台电脑上显示的邀请码。` };
      }
      /*
       * ECONNREFUSED = 对方机器网络上到了，但**那个端口没有程序在监听**。
       * 唯一原因：对方这会儿没在等（没点「启动群聊」，或重启过 VS Code）。
       * 这和「网络不通」是两件事，不能混成一句话。
       */
      if (/ECONNREFUSED/i.test(reason)) {
        return {
          ok: false,
          message:
            `对方（${target}）没有在等：那台电脑的群聊没开着。` +
            '请在对方点「启动群聊」，然后把新的邀请串复制给你（重启过 VS Code 后旧邀请码会失效）。',
        };
      }
      if (/EHOSTUNREACH|ENETUNREACH|ETIMEDOUT/i.test(reason)) {
        const host = (() => {
          try { return new URL(target).hostname; } catch { return target; }
        })();
        return {
          ok: false,
          message:
            `连不上 ${target}。常见原因（按可能性排序）：\n` +
            `1. 对方电脑的 IP 变了（重启路由器后很常见）→ 请对方重新点「启动群聊」，把新邀请码复制给你；\n` +
            `2. 代理开了 TUN / 增强模式，把局域网流量劫走了 → 两台都关掉代理再试；\n` +
            `3. 两台没接在同一个 WiFi。\n` +
            `可以先在终端跑 \`ping ${host}\` 确认网络通不通。`,
        };
      }
      return { ok: false, message: `加入失败：这台电脑连不上 ${target}（${reason || '没有响应'}）。请确认两台在同一个 WiFi。` };
    }
    const response = answer.data ?? {};
    /*
     * 加入一个新群 = 全新的一段对话：先把上一个群的记录清掉。
     * 否则新群里一打开就是旧需求、旧发言，用户分不清在看哪个群。
     */
    this.requirements = [];
    this.reports = [];
    this.notes = [];
    this.group = [];
    this.peers.clear();
    if (Array.isArray(response.peers)) this.absorbPeers(response.peers);
    /*
     * 加入了谁的群，就信任谁。
     *
     * 不加这一步，主机的 /deliver 会被自己 403 拒绝 ——
     * 表现就是「我加入了，但主机说的话我一条也收不到」。
     */
    const hostPeerId = (response.hub as { peer?: { id?: unknown } } | undefined)?.peer?.id;
    if (typeof hostPeerId === 'string' && hostPeerId) {
      this.approved.add(hostPeerId);
      /*
       * 把主机也记进**成员列表**。
       *
       * 以前只加了「可信名单」，成员列表里没有主机 ——
       * 于是加入方永远显示「等对方加入」（成员数 0），
       * 两台各自看各自的人，像根本没连上。
       */
      const hostPeer = parseSyncMessage({
        kind: 'report',
        requirementId: 'pair',
        from: (response.hub as { peer?: unknown } | undefined)?.peer,
        status: 'planned',
      });
      if (hostPeer) {
        this.peers.set(hostPeer.from.id, { peer: hostPeer.from, address: target });
      }
      await this.persist();
    }
    this.role = 'peer';
    this.hubAddress = target;
    this.inviteCode = '';
    // 记住加入时用的码：后面每条消息都要带它，否则主机会 403。
    this.joinedCode = normalizeInviteCode(code);
    this.hostMisses = 0;
    this.startPeerHeartbeat();    this.bridge.log(`[sync] 已加入群聊 ${target}（邀请码 ${code}）`);
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
  async joinHub(
    address?: string,
    port = this.configuredPort,
    options: { allowWhileHosting?: boolean } = {},
  ): Promise<{ ok: boolean; message: string }> {
    /*
     * 已经在当群主时不再"加入"别人（那会把自己的群关掉），
     * 除非调用方明确要求让位（两台都开群时的收敛）。
     */
    if (this.role === 'hub' && this.inviteCode && !options.allowWhileHosting) {
      return { ok: false, message: '这台正在开群，不需要加入别的群。' };
    }
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

  /**
   * 清掉重启后已经失效的邀请码。
   *
   * 监听器随进程消失，旧的码已经对不上任何人；留着只会让界面显示
   * 「群聊 XXXXXX · 等加入」，而对方连过来必然失败。
   */
  async clearStaleInvite(): Promise<void> {
    if (!this.inviteCode || this.role === 'hub') return;
    this.bridge.log(`[sync] 旧的邀请码 ${this.inviteCode} 已随重启失效，清除`);
    this.inviteCode = '';
    this.joinedCode = '';
    this.lastRole = 'hub';
    this.lastHub = '';
    await this.persist();
    this.bridge.onState?.();
  }

  /**
   * 开机自愈：上次是群主就重新当群主。
   *
   * 用户手上的邀请串可能在剪贴板/聊天记录里放了一整天。VS Code 一重启监听器就没了，
   * 另一台拿着那个码只会得到 ECONNREFUSED。所以只要还记得邀请码，就把监听重新支起来。
   */
  async resumeHosting(): Promise<boolean> {
    if (!this.inviteCode || this.role === 'hub') return false;
    const started = await this.startHub(this.lastPort || this.configuredPort);
    if (started.ok) {
      this.bridge.log(`[sync] 已恢复群主监听，邀请码 ${this.inviteCode} 仍然有效`);
      this.bridge.onState?.();
      return true;
    }
    this.bridge.log(`[sync] 恢复群主监听失败：${started.message}`, 'warn');
    return false;
  }

  stop(): void {
    this.stopDiscovery();
    this.stopPeerHeartbeat();
    this.role = 'off';
    this.hubAddress = '';
    /*
     * 主动断开就作废邀请码。
     *
     * 否则界面还挂着「群聊 XXXXXX · 等加入」，而监听早就关了 ——
     * 另一台按这个码连过来只会得到 ECONNREFUSED。
     */
    this.inviteCode = '';
    void this.persist();
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
        /*
         * 回复「我在这儿」时**必须带上邀请码**。
         *
         * 加入方是按码找群的（`discover(code)` 会丢掉码不对的回应），
         * 这里漏了码，等于唯一的回应被自己过滤掉 —— 成员永远找不到群，
         * 界面表现就是「填了码没反应」。
         */
        const reply = JSON.stringify({
          magic: HUB_MAGIC,
          peer: selfId,
          code: this.inviteCode,
          port: this.port,
          addresses: lanAddresses(),
        });
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
    // 3 秒一轮：比加入方的等待时间短，保证它总能在超时前听到一次。
    this.announceTimer = setInterval(announce, 3_000);
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
        ? this.joinGroup(otherCode, this.configuredPort, target, { allowWhileHosting: true })
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

  /** 最近一次找群时听到的广播（用来区分「没有群」和「有群但码不对」）。 */
  private lastHeard: Array<{ code: string; peer: string }> = [];

  /**
   * 找主机。
   *
   * 传了邀请码就只认**码对得上**的群聊 —— 这是「填码进群」能成立的关键：
   * 用户不需要知道对方 IP，广播里带着码自己就对上了。
   * 不传码时保持旧行为（自动找任意一台主机），供「高级 → 手动连接」使用。
   */
  private async discover(expectedCode?: string): Promise<string> {
    this.lastHeard = [];
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
      // 按码找可以多等一会儿：用户抄码、主机广播、网络往返都要时间。
      timers.push(setTimeout(() => finish(''), expectedCode ? 6_000 : 2_000));
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
          /*
           * 记下听到过哪些群。
           *
           * 找不到时靠它区分两种情况：「这台电脑压根没听到任何群」和
           * 「听到了群但码不对」—— 用户要做的事完全不同（查 WiFi / 重新抄码）。
           */
          if (typeof parsed.peer === 'string' && parsed.peer !== this.bridge.peer().id) {
            this.lastHeard.push({ code: typeof parsed.code === 'string' ? parsed.code : '', peer: parsed.peer });
          }
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

  /**
   * 从一个请求体里取出「发送方设备 id」。
   *
   * 用来判断是不是已允许过的设备 —— 这类设备不该因为邀请码变了就被拒绝。
   */
  private senderIdOf(parsed: Record<string, unknown>): string {
    const fromMessage = (): string => {
      const message = parseSyncMessage(parsed.message);
      return message?.from.id ?? '';
    };
    const candidates = [
      (parsed.peer as { id?: unknown } | undefined)?.id,
      (parsed.from as string | undefined),
      fromMessage(),
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value) return value;
    }
    return '';
  }

  /**
   * 记住发来消息的设备地址。
   *
   * 两台各自重启后可能都是群主、都没有对方的地址，于是各自发的消息无处可去。
   * 只要有一方先发过来（比如 Windows 还留着 mac 的地址），另一方就能在这里
   * 学到对方的来源 IP，链路立刻双向打通 —— 不需要重新走一遍配对。
   */
  private async rememberSender(
    peer: SyncPeer,
    remoteAddress: string | undefined,
    declaredPort: unknown,
  ): Promise<void> {
    const selfId = this.bridge.peer().id;
    if (peer.id === selfId) return;
    const ip = (remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!ip) return;
    /*
     * **必须用对方自报的端口**。
     *
     * 以前没有时回落成 `this.port`（本机端口）—— 于是把对方记成了
     * `http://<对方IP>:<本机端口>`，消息全发回自己身上，谁也收不到。
     * 拿不到端口就只更新身份信息，不动地址。
     */
    const hasPort = typeof declaredPort === 'number' && declaredPort > 0 && declaredPort < 65_536;
    const existing = this.peers.get(peer.id);
    const address = hasPort ? `http://${ip}:${declaredPort}` : (existing?.address ?? '');
    const isNew = !existing;
    this.peers.set(peer.id, { peer: withHost(peer, ip), address });
    // 只学过地址就够放行了；第一次见面仍然要走 /pair 或用户点「允许」。
    if (!this.approved.has(peer.id)) this.approved.add(peer.id);
    await this.persist();
    if (hasPort || isNew) {
      this.bridge.log(
        `[sync] ${isNew ? '自动记下对方地址' : '更新对方地址'}：${peer.name} → ${address || '（端口未知）'}`,
      );
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
  remotePeers(): Array<{ id: string; name: string; platform: string; address: string; version: string; projects: string[]; projectRepos: string[] }> {
    return this.peerList().map((entry) => ({
      id: entry.peer.id,
      name: entry.peer.name,
      platform: entry.peer.platform,
      address: entry.address,
      version: entry.peer.version ?? '',
      projects: entry.peer.projects ? [...entry.peer.projects] : [],
      projectRepos: entry.peer.projectRepos ? [...entry.peer.projectRepos] : [],
    }));
  }

  /** 某台对端设备的完整信息（项目名 / 仓库 / 账号）。 */
  peerDetail(name: string): SyncPeer | undefined {
    return this.peerList().find((entry) => entry.peer.name === name)?.peer;
  }

  /** 群内所有设备分别在做什么项目（用于「项目对不上」的提示）。 */
  peerProjects(): Array<{ name: string; project: string; repo: string }> {
    return this.peerList().map((entry) => ({
      name: entry.peer.name,
      project: entry.peer.project,
      repo: entry.peer.repo ?? '',
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
        json(200, { ok: true, protocol: SYNC_PROTOCOL_VERSION, peer: this.localPeer(), role: this.role });
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
      /*
       * 通行证：**邀请码 / 旧配对码 / 已允许过的设备**，任一成立即可。
       *
       * 前两条是「第一次见面」的凭据。第三条是**关键**：
       * 两台机器各自重启后可能各自都成了群主、各自生成了不同的邀请码，
       * 于是互相 403 —— 表现就是「各看各的群、谁也收不到谁的消息」。
       * 已经互相允许过的设备不该因为换了码就被挡在外面。
       */
      const suppliedCode = normalizeInviteCode(typeof parsed.code === 'string' ? parsed.code : '');
      const codeAccepted = this.inviteCode
        ? suppliedCode === normalizeInviteCode(this.inviteCode)
        : pairingMatches(parsed.code, this.code);
      const senderId = this.senderIdOf(parsed);
      const trusted = Boolean(senderId) && this.approved.has(senderId);
      if (route !== '/hwchat-sync/v1/pair' && !codeAccepted && !trusted) {
        this.bridge.log(`[sync] 拒绝 ${route}：通行证不对（来源 ${senderId || '未知'}）`, 'warn');
        json(403, { ok: false, error: 'group code mismatch' });
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
          this.peers.set(message.from.id, { peer: withHost(message.from, ipOf(address)), address });
          if (alreadyIn) this.bridge.log(`[sync] ${message.from.name} 已在群里，重复加入不重复计数`);
          else this.bridge.log(`[sync] 设备加入：${message.from.name}（${message.from.project}）${address ? ` → ${address}` : ''}`);
          /*
           * 立刻刷新界面。
           *
           * 以前这里只改了内存里的 peers，没通知任何人 —— 于是**主机端**一直显示
           * 「等对方加入」，直到对方先往群里说一句话才刷新。
           * 加入方那边早就显示「2 台设备」，两台看起来完全不一致。
           */
          this.bridge.onState?.();
        }
        json(200, {
          ok: true,
          already,
          peers: this.peerList(),
          hub: { peer: this.localPeer(), address: this.selfAddress(request.socket.remoteAddress) },
        });
        return;
      }
      if (route === '/hwchat-sync/v1/message' || route === '/hwchat-sync/v1/deliver') {
        const message = parseSyncMessage(parsed.message);
        if (!message) {
          json(400, { ok: false, error: 'invalid message' });
          return;
        }
        /*
         * 收到可信设备的消息时，把它的地址记下来。
         *
         * 两台各自重启后都可能成了群主，谁也没有对方的地址 ——
         * 于是各自发的消息都"无处可去"，互相永远收不到。
         * 只要有一方先发过来，另一方就记住了地址，链路立刻双向打通。
         */
        await this.rememberSender(message.from, request.socket.remoteAddress, parsed.port);
        if (route === '/hwchat-sync/v1/message') {
          // 主机先落账，再转发给其它设备（不回给发送方，避免回声）。
          await this.applyMessage(message, { relay: true, from: message.from.id });
        } else {
          await this.applyMessage(message, { relay: false, from: message.from.id });
        }
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

    if (route !== `${MOBILE_PATH}/send` && route !== `${MOBILE_PATH}/approve` && route !== `${MOBILE_PATH}/stop`) {
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
    /*
     * 「停止执行」：和桌面群窗口那颗按钮**走同一条路**（`broadcastStop`），
     * 这样手机点一下，群里所有设备都会停，而不是只停这一台。
     * 放在解析 body 之前：停止不需要参数。
     */
    if (route === `${MOBILE_PATH}/stop`) {
      const result = await this.broadcastStop();
      send(result.ok ? 200 : 409, result);
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
      const assignee = typeof parsed.assignee === 'string' ? parsed.assignee.trim().slice(0, 64) : '';
      /*
       * **立刻回话，后台再跑**。
       *
       * 用户实况（2026-11-26）：「手机上发送消息也有延迟，或者有时候发送不出去」。
       * 以前这里 `await` 整个 `sendGroupMessage()` —— 那里面可能要打断正在跑的一轮、
       * 等它收尾、广播、再起新一轮，几秒到几十秒都有；手机的 HTTP 请求就干等着，
       * 界面一直停在「发送中…」，看起来就像发不出去。
       *
       * 现在：请求立即返回 202（手机那条气泡已经先画出来了），真正的发送在后台进行；
       * 失败会作为一条群消息写回群里，手机照样能看到原因，不会静默丢。
       */
      send(202, { ok: true, accepted: true, message: '已发出' });
      void this.bridge.onMobileMessage(text.slice(0, 4_000), assignee || undefined)
        .then((result) => {
          if (!result.ok) this.bridge.log(`[mobile] 发送失败：${result.message}`, 'warn');
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          this.bridge.log(`[mobile] 发送失败：${detail}`, 'warn');
          void this.postGroup({
            author: 'agent',
            phase: 'progress',
            body: `手机那条没能执行：${detail}`,
          }).catch(() => undefined);
        });
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
      /*
       * 先推进逻辑时钟：之后本机发的消息一定比这条更新。
       * 多台设备、多位用户在同一项目下并发发言时，靠它排出全序。
       */
      this.observeClock(message.createdAt);
      const exists = this.requirements.some((item) => item.id === message.id);
      if (!exists) {
        this.requirements = [...this.requirements, message].slice(-STATE_LIMIT);
        await this.persist();
        this.bridge.log(`[sync] 收到需求 ${message.id}：${message.title}（来自 ${message.from.name}）`);
        // 本机执行（除发起方自己）。
        if (message.from.id !== this.bridge.peer().id) {
          /*
           * 指派检查必须在项目门禁之前。
           *
           * 甲方在群里说「让 macos 那边 agent 做」，这条需求就只该那台执行。
           * 以前这里没有这个判断，于是两台都跑同一份活 ——
           * 用户的实况：「我让 macos 执行任务，Windows 这边也跑起来了」。
           */
          if (message.assignee && message.assignee !== this.localPeer().id) {
            this.bridge.log(
              `[sync] 需求 ${message.id} 指派给 ${message.assignee}，本机只记录不执行`,
            );
            /*
             * 说清是 @ 了谁。
             *
             * 「由另一台执行」不点名，甲方看到一台干活、另一台说风凉话，会误以为两台模式不同。
             * 需求也可能只以**群消息**的形式到达（没有独立的执行触发），所以这条说明
             * 由 `announceAssignmentElsewhere()` 统一发，且按需求号去重，两条路径不会发两遍。
             */
            await this.announceAssignmentElsewhere(message.id, message.assignee);
            /*
             * 需求本身也要进本机对话：本机不执行它，就没有别的地方会把它写进来 ——
             * 甲方在对话里回看时，只会看到「这条 @ 了 X」，看不到到底要做什么。
             */
            await this.bridge.onPeerLine?.({
              id: message.id,
              speaker: deviceLabel(message.from, this.peerList().map((entry) => entry.peer)),
              phase: 'requirement',
              body: message.detail || message.title,
              at: message.createdAt,
              reason: 'assigned-elsewhere',
              requirementId: message.id,
              assigneeLabel: this.labelForPeerId(message.assignee),
            }).catch(() => undefined);
            return;
          }
          /*
           * 项目门禁：**按仓库地址判断**，文件夹名不算数。
           *
           * 用户要求：项目唯一 ID 就是 GitHub 仓库地址。同一个仓库在不同设备上
           * 可以叫不同文件夹名 —— 那是同一个项目，不该拦；
           * 仓库不同才是真的不同，要先追问、确认后才调整。
           *
           * 具体判定见 `projectGate`：**本机认不出自己的仓库时不算「不同」** ——
           * 没有依据就降成只读，会让 agent 误以为自己没有写文件能力（用户实况 2026-11-25）。
           */
          const theirRepo = normalizeRepoUrl(message.repo ?? message.from.repo ?? '');
          const myRepo = this.currentRepo();
          const required = theirRepo || message.project || message.from.project || '';
          const local = this.activeProjectName();
          const gate = projectGate({
            theirRepo,
            myRepo,
            theirName: message.project || message.from.project || '',
            myName: local,
            hasProject: (value) => this.hasProject(value),
          });
          const mismatch = gate.mismatch;
          if (mismatch) {
            /*
             * 项目不一致**不再拒绝**，改成只读执行。
             *
             * 用户的要求：「不管是不是在一个项目，要都能回复」。以前这里直接 return，
             * 群里只剩一句「项目不一致，所以我没有执行」—— 连「报数」这种不用改代码的
             * 话也被挡住了。现在照常跑一轮，但收窄成只读：能读、能答、能查，不能写。
             */
            const mine = this.bridge.localLogin?.() ?? '';
            const theirs = message.from.login ?? '';
            this.bridge.log(`[sync] 项目不一致（对方 ${theirRepo || required}，依据 ${gate.reason}），本轮按只读执行 ${message.id}`, 'warn');
            void this.postGroup({
              author: 'agent',
              phase: 'progress',
              body: `两台做的不是同一个项目（对方 ${theirRepo || required}，本机 ${myRepo || local}），这台会照常回答，但这一轮只读、不改文件。`,
              requirementId: message.id,
            }).catch(() => undefined);
            this.bridge.onProjectMismatch?.({
              required: theirRepo || required,
              local: myRepo || local,
              from: message.from.name,
              sameAccount: Boolean(mine) && mine === theirs,
              hasLocalCandidate: false,
            });
            const readonlyOutcome = await this.runNewest(message, async (item) => this.bridge
              .runRequirement(item, { readOnly: true })
              .catch((error: unknown) => {
                this.bridge.log(`[sync] 只读执行失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
                return false;
              }));
            if (readonlyOutcome === 'busy') this.bridge.log('[sync] 面板正忙，需求已记录，稍后可手动继续', 'warn');
            return;
          }
          const outcome = await this.runNewest(message, async (item) => this.bridge.runRequirement(item)
            .catch((error: unknown) => {
              this.bridge.log(`[sync] 本机执行需求失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
              return false;
            }));
          if (outcome === 'busy') this.bridge.log('[sync] 面板正忙，需求已记录，稍后可手动继续', 'warn');
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
          /*
           * 到达即盖章：`receivedAt` 是本机单调的时间线依据（见 `messageOrderKey`）。
           * 对端时钟可能比本机慢，只按 `at` 排会把它的回复排到我们提问之前。
           */
          const arrived = { ...message, receivedAt: message.receivedAt ?? Date.now() };
          this.group = [...this.group, arrived].slice(-MAX_GROUP_MESSAGES);
          /*
           * **阶段随消息一起过网**（2026-11-26 复查发现的缺口）。
           *
           * 甲方在哪一台点「确认」，另一台也必须放开写操作 —— 否则确认了只有一半的机器会动手，
           * 看起来就像「确认没用」。所以确认 / 要求改的发言带 `meta.planPhase`，到此即落定。
           */
          const broadcastPhase = message.meta?.planPhase;
          if (broadcastPhase && message.requirementId) {
            this.setPhase(message.requirementId, broadcastPhase);
            this.trace(`阶段同步：${message.requirementId.slice(0, 12)} → ${teamPhaseLabel(broadcastPhase)}`);
          }
          if (message.from.id !== this.bridge.peer().id) {
            this.trace(
              `收到 ${message.from.name}：${message.author === 'user' ? '甲方' : '乙方'}·${message.phase}「${message.body.slice(0, 24)}」`,
            );
          }
          await this.persist();
          this.bridge.log(`[sync] 群消息：${renderGroupLine(message)}`);
          /*
           * **先回执，再干活。**
           *
           * 用户 2026-11-25：「经常遇到一个 agent 在执行任务，没回复，没参与，
           * 团队任务对话框也没显示相关消息，导致我不知道这个 agent 是没收到消息，
           * 还是收到了但正在执行」。回执是确定的、几乎零成本，必须在开跑之前发出去 ——
           * 否则正忙时甲方只能干等。
           *
           * 只对甲方的发言回执（agent 自己的话不需要），并且只回「说给本机的」。
           */
          /*
           * 回执对**所有人的发言**都发，不只对甲方的。
           *
           * 用户 2026-11-26：「不管是 agent 还是用户的消息气泡下面都要显示已读状态，
           * 哪些 agent 已读了」。所以队友 agent 说的话也要有回执，界面上才会出现
           * 「已读：Windows（本机）」这种事实。
           */
          if (this.addressedToLocal(message)) {
            void this.ackGroup([message.id]);
          }
          /*
           * **对端的每一条发言都要进本机对话**（用户 2026-11-26 的要求：
           * 「让 agent 的消息也像用户消息一样，能被相互看见，唯一约束是 @」）。
           *
           * 以前只有 `send|ask`（note）会进对话，而 `team_sync action=progress|result|question`
           * 只画在团队群窗口 —— 于是「谁用了哪种动作」决定了对面能不能看见，
           * 跟操作系统一点关系都没有。这里统一补上：只追加显示，不触发运行。
           */
          const peerReason = peerGroupLineReason(message, this.bridge.peer().id);
          if (peerReason) {
            /*
             * 指派给别人的需求：本机不执行，但群里要有一条**点名**的说明，
             * 甲方才知道「不是这台不做，是这条 @ 了那台」。
             */
            if (peerReason === 'assigned-elsewhere' && message.assignee) {
              void this.announceAssignmentElsewhere(message.requirementId, message.assignee);
            }
            await this.bridge.onPeerLine?.({
              id: message.id,
              speaker: deviceLabel(message.from, [this.bridge.peer(), ...this.peerList().map((entry) => entry.peer)]),
              phase: message.phase,
              body: message.body,
              at: message.at,
              reason: peerReason,
              ...(message.requirementId ? { requirementId: message.requirementId } : {}),
              ...(message.assignee ? { assigneeLabel: this.labelForPeerId(message.assignee) } : {}),
            }).catch(() => undefined);
          }
          await this.bridge.onGroupMessage?.(arrived).catch(() => undefined);
          await this.refreshTranscript();
          /*
           * 甲方回答了乙方的追问 → 本机这一侧也要接着做。
           *
           * 这是「追问直到达成一致」能闭环的地方：不重新开一轮，甲方的话会被
           * 记录却没人接，两个 agent 就永远停在「等你回答」。
           */
          if (message.author === 'user' && message.phase === 'answer' && message.from.id !== this.bridge.peer().id) {
            const requirement = this.requirementById(message.requirementId);
            /*
             * 回答只回给**问话的那一台**（用户 2026-11-25：
             * 「我回复的时候，agent 需要知道我在回复谁，只参考，不执行和自己无关的回复」）。
             *
             * 判据三层：消息自己的 `to` / 需求上的 `assignee` / 提问者的 id。
             * 都不是本机 → 这一条对本机只是**参考**，记下来但不开跑。
             */
            const question = [...this.group].reverse()
              .find((item) => item.requirementId === message.requirementId && item.phase === 'question');
            const target = message.to || message.assignee || question?.from.id || requirement?.assignee || '';
            if (target && target !== this.bridge.peer().id) {
              this.trace(`甲方回答的是 ${target} 的追问，这台只参考不执行`);
            } else if (requirement && this.role !== 'off') {
              await this.bridge.runRequirement(requirement).catch(() => false);
            }
          }
          /*
           * 甲方在群里问的一句（不是派活）：**两台 agent 都要答**。
           *
           * 以前只有发消息那台在答，另一台收到就只记下来 ——
           * 用户看到的是「mac 说报数，Windows 的 agent 一声不响」，
           * 像是对方根本没进群。报数这种事本来就该各报各的。
           *
           * 用发送方的判定结果（phase=analysis）当信号，接收方不用再问一次模型。
           */
          if (
            message.author === 'user'
            && message.phase === 'analysis'
            && message.from.id !== this.bridge.peer().id
          ) {
            const chatHook = this.bridge.onRemoteGroupChat;
            if (chatHook) {
              /*
               * **不等它答完**：答话要走一次模型，几秒到几十秒。
               * 让 HTTP 响应干等着，对方那台发消息的人就会被自己的请求拖住。
               */
              void Promise.resolve(chatHook(message))
                .then(() => this.trace(`已应答 ${message.from.name} 的提问`))
                .catch((error: unknown) => {
                  this.trace(`应答失败：${error instanceof Error ? error.message : String(error)}`);
                });
            } else {
              this.trace('这台版本没有「对端提问也作答」的能力，只记录不回答');
            }
          }
        }
      } else if (message.kind === 'asset') {
        // 附件分片：只落盘，不进群记录、不触发任何执行。
        await this.ingestAsset(message);
      } else if (message.kind === 'receipt') {
        /*
         * 已读回执：只记状态、不产生气泡、不触发任何执行。
         *
         * 单独一种 kind 的原因也在这里 —— 混进群消息会把别人的「已读」
         * 当成一条发言，对话立刻被淹没，还会被当成「回答」去开跑。
         */
        if (message.from.id !== this.bridge.peer().id) {
          this.markRead(message.ids, message.from.id);
          await this.persist();
          await this.bridge.onGroupRead?.().catch(() => undefined);
          this.bridge.onState?.();
        }
      } else if (message.kind === 'note') {
        /*
         * 协作消息：先记账，再交给本机 agent。
         *
         * 幂等按 id 去重 —— 同一台设备既是发起方又收到转发时会重复到达一次。
         */
        if (!this.notes.some((item) => item.id === message.id)) {
          // 到达即盖章：时间线以本机到达顺序为准（对端时钟可能比本机慢）。
          const arrived: SyncNote = { ...message, receivedAt: message.receivedAt ?? Date.now() };
          this.notes = [...this.notes, arrived].slice(-MAX_NOTES);
          await this.persist();
          this.bridge.log(`[sync] 队友消息（${message.from.name}）：${message.body.slice(0, 80)}`);
          /*
           * 轮次上限：两个 agent 会互相答，不加闸就会一直接龙（额度烧光、任务不前进）。
           * 到上限就不再自动应答，把话抛回群里等甲方 —— 对话必须有终止条件。
           */
          const rounds = this.dialogueRounds(message.topic || '');
          /*
           * 这条是不是**我问出去的那个问题的回答**？
           *
           * 是的话必须叫醒本机 agent 去合并结论 —— 以前只按「对方在提问」叫醒，
           * 于是回答悄悄落库、提问的那台却已经收工发过「结果」了：
           * 用户看到的就是「单方面发出结果，实际对方还没说完」。
           */
          const answersMyAsk = this.settleAskFor(message);
          if (this.role !== 'off' && message.from.id !== this.bridge.peer().id && rounds > MAX_DIALOGUE_NOTES) {
            this.trace(`agent 之间已来回 ${rounds} 轮，暂停自动应答`);
            void this.postGroup({
              author: 'agent',
              phase: 'question',
              body: `我和「${deviceLabel(message.from, this.peerList().map((entry) => entry.peer))}」已经来回 ${rounds} 条还没定下来，需要你定一句再继续。`,
              options: ['继续让两台讨论', '只让一台做', '先停下'],
            }).catch(() => undefined);
          /*
           * **只有 `@` 能挡**（用户 2026-11-26 的原话）：
           * 「让 agent 的消息也像用户消息一样，能被相互看见，唯一约束看不看得见的是
           * @某个 agent 的行为」。
           *
           * 以前这里还多一道「正文像不像在提问」的判断（`shouldAutoRespond`）——
           * 于是队友一条**陈述性**的回复（「我这边已经改好了，结论如下」）只会落库、
           * 不叫醒本机，用户看到的就是「对方回了，我这台毫无反应」。
           * 现在：说给本机的就交付，由 agent 自己判断要不要动手（提示词里写得很清楚）。
           * 防接龙靠的是上面的 `MAX_DIALOGUE_NOTES` 轮次上限，不是靠猜语气。
           *
           * 唯一例外是 `answersMyAsk === 'waiter'`：那一轮正挂起等这条回话，
           * 它已经通过 `waitForReply` 拿到手了，再叫醒一轮只会让两个线程抢同一件事。
           */
          } else if (
            message.from.id !== this.bridge.peer().id
            && noteAddressedTo(message, this.bridge.peer().id)
            && answersMyAsk !== 'waiter'
          ) {
            /*
             * 甲方刚按过「停止执行」：**不交付**，只记录。
             *
             * 这是「点了停止，agent 还在动」的第二个原因：停止让那一轮结束，而这一轮
             * 结束时 `flushPendingNotes()` 会把排队的消息交回 agent —— 立刻又开一轮。
             * 现在甲方重新在群里说话（或发新需求）之前，队友消息一律只记录不动手。
             */
            if (this.notesHeld) {
              this.bridge.log('[sync] 已按过「停止执行」：队友消息只记录，等甲方重新发话', 'warn');
            } else {
              const accepted = await this.bridge.runNote?.(arrived).catch((error: unknown) => {
                this.bridge.log(`[sync] 交付队友消息失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
                return false;
              });
              /*
               * 交付不了（本机正在跑）就**排队**，不能丢。
               *
               * 2026-11-26 的现场：14 条队友消息全部止步于「面板正忙」，之后没有任何重试 ——
               * 用户看到的就是「对方秒回了，我这台毫无反应」。
               */
              if (accepted === false) {
                this.enqueuePendingNote(arrived);
                this.bridge.log('[sync] 面板正忙，队友消息已排队（这一轮结束后立刻交付）', 'warn');
              }
            }
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
      const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.credential(), port: this.port, message });
      const targets = this.peerList().filter((entry) => entry.address && entry.peer.id !== options.from);
      await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
    }
    await this.refreshLedger();
    this.bridge.onState?.();
  }

  /**
   * 把一条暂时交付不了的协作消息排进队列，并起一个重投定时器。
   *
   * 重投间隔刻意短（4 秒）：一轮跑完通常只是收尾落盘，几秒内就会空出来；
   * 队列本身有上限，不会因为长时间忙而无限堆积。
   */
  private enqueuePendingNote(note: SyncNote): void {
    if (this.pendingNotes.some((item) => item.id === note.id)) return;
    this.pendingNotes = [...this.pendingNotes, note].slice(-MAX_PENDING_NOTES);
    if (this.noteRetryTimer) return;
    this.noteRetryTimer = setInterval(() => {
      void this.flushPendingNotes();
    }, NOTE_RETRY_MS);
    this.noteRetryTimer.unref?.();
  }

  /**
   * 尝试把排队中的协作消息交给本机 agent；交付成功才出队。
   *
   * 两个触发点：重投定时器（本机忙完之后自动生效）与**每一轮结束时**的主动 flush
   * （面板知道那一轮结束了，比等定时器更及时）。
   */
  async flushPendingNotes(): Promise<number> {
    /*
     * 甲方按过「停止执行」：**一条都不交付**。
     *
     * 否则「停止 → 这一轮结束 → 立刻 flush → 又开一轮」，用户看到的就是「停了还在动」。
     */
    if (this.notesHeld) return 0;
    if (this.disposed || !this.pendingNotes.length) {
      if (this.noteRetryTimer) {
        clearInterval(this.noteRetryTimer);
        this.noteRetryTimer = undefined;
      }
      return 0;
    }
    let delivered = 0;
    for (const note of [...this.pendingNotes]) {
      const accepted = await this.bridge.runNote?.(note).catch(() => false);
      if (accepted === false) break;
      this.pendingNotes = this.pendingNotes.filter((item) => item.id !== note.id);
      delivered += 1;
      this.bridge.log(`[sync] 排队的队友消息已交付（还剩 ${this.pendingNotes.length} 条）`);
    }
    if (!this.pendingNotes.length && this.noteRetryTimer) {
      clearInterval(this.noteRetryTimer);
      this.noteRetryTimer = undefined;
    }
    return delivered;
  }

  /** 还有几条队友消息在排队（状态栏 / 测试用）。 */
  pendingNoteCount(): number {
    return this.pendingNotes.length;
  }

  /**
   * 甲方按了「停止执行」：清空排队中的队友消息，并**暂停交付**。
   *
   * 为什么必须这样做（用户 2026-11-26：「点击后群里的 agent 并没有停止」）：
   * 停止只是 abort 当前这一轮；这一轮结束时 `flushPendingNotes()` 会把排队的队友消息
   * 交给 agent，于是**立刻又开一轮**，看起来就是「停了还在动」。
   * 所以停止要同时：清队列 + 关闭交付闸门，直到甲方重新在群里发话。
   */
  holdNoteDelivery(reason: string): number {
    const dropped = this.pendingNotes.length;
    this.pendingNotes = [];
    if (this.noteRetryTimer) {
      clearInterval(this.noteRetryTimer);
      this.noteRetryTimer = undefined;
    }
    this.notesHeld = true;
    this.bridge.log(`[sync] 队友消息交付已暂停（${reason}）：清掉 ${dropped} 条排队，等甲方重新发话`);
    return dropped;
  }

  /** 甲方重新发话：恢复队友消息的交付。 */
  resumeNoteDelivery(): void {
    if (!this.notesHeld) return;
    this.notesHeld = false;
    this.bridge.log('[sync] 甲方重新发话：恢复队友消息交付');
  }

  /** 队友消息是否处于「暂停交付」状态（界面 / 测试用）。 */
  notesHeldForStop(): boolean {
    return this.notesHeld;
  }

  /** 已经通知过的「这条 @ 给了别人」（按需求号去重：需求触发与群消息两条路径不会各发一遍）。 */
  private readonly assigneeNotices = new Set<string>();

  /**
   * 群里说一句「这条 @ 了 X，我只记录、不动手」。
   *
   * 不点名的话，甲方看到一台干活、另一台说风凉话，会以为两台的模式不一样（2026-11-26 现场）。
   */
  private async announceAssignmentElsewhere(requirementId: string, assigneeId: string): Promise<void> {
    const key = requirementId || '';
    if (!key || this.assigneeNotices.has(key)) return;
    this.assigneeNotices.add(key);
    if (this.assigneeNotices.size > 200) this.assigneeNotices.clear();
    await this.postGroup({
      author: 'agent',
      phase: 'progress',
      body: assignmentNotice({
        targetLabel: this.labelForPeerId(assigneeId),
        selfIsTarget: assigneeId === this.localPeer().id,
      }),
      requirementId: key,
    }).catch(() => undefined);
  }

  /**
   * 这条需求现在处于哪个阶段（谈 / 等确认 / 执行）。
   *
   * 没有记录就是「谈」——新需求**默认只读**，这是用户定的规矩：
   * 「我希望他们先沟通，只读取各自设备上的文件，不修改…用户确认了再动手修改文件」。
   */
  phaseOf(requirementId: string): TeamPhase {
    if (!requirementId) return initialTeamPhase();
    const known = this.phases.get(requirementId);
    if (known) return known;
    return initialTeamPhase();
  }

  /** 改阶段（面板在「方案谈完」「甲方确认」两个时刻调用）。 */
  setPhase(requirementId: string, phase: TeamPhase): void {
    if (!requirementId) return;
    if (this.phases.get(requirementId) === phase) return;
    this.phases.set(requirementId, phase);
    this.bridge.log(`[sync] 需求 ${requirementId.slice(0, 12)} 进入阶段：${teamPhaseLabel(phase)}`);
    /*
     * **必须落盘**。
     *
     * 阶段原本只在内存里：重载窗口 / 重启 VS Code 就退回「谈」，甲方确认过的需求
     * 又变成「不许动手」—— 用户看到的是「确认了怎么还不动」，等于这条功能没做。
     */
    void this.persist().catch(() => undefined);
    this.bridge.onState?.();
  }

  /** 阶段说法 + 自主迭代标记（群窗口 / 手机顶部共用）。 */
  phaseLabelWithMode(phase: TeamPhase): string {
    return this.autonomous() ? `${teamPhaseLabel(phase)} · 自主迭代` : teamPhaseLabel(phase);
  }

  /** 自主迭代模式是否开启（谈定就开工，不等甲方确认）。 */
  autonomous(): boolean {
    try {
      return this.bridge.autonomousMode?.() === true;
    } catch {
      return false;
    }
  }

  /** 最近一条需求的阶段（群窗口顶部 / 手机用）。 */
  activePhase(): { requirementId: string; phase: TeamPhase } | undefined {
    const last = this.requirements[this.requirements.length - 1];
    if (!last) return undefined;
    return { requirementId: last.id, phase: this.phaseOf(last.id) };
  }

  /**
   * 甲方在群里说的话，是不是在**确认方案**（或要求改方案）。
   *
   * 确认 → 那条需求进入 `implement`（放开写工具）；要求改 → 退回 `negotiate`（只读重谈）。
   * 都不是 → 返回 undefined，交给原来的「新需求 / 回答追问」判断。
   */
  applyPlanDecision(text: string): { requirementId: string; phase: TeamPhase } | undefined {
    const awaiting = [...this.phases.entries()]
      .filter(([, phase]) => phase === 'awaiting-approval')
      .map(([requirementId]) => requirementId);
    /*
     * 没有「等确认」的记录时，允许用**群里的方案**兜底。
     *
     * 为什么要这道兜底：阶段推进依赖上一轮正常收尾；那一轮被新消息顶掉 / 被停止时，
     * 阶段会停在「谈」——甲方明明已经看到方案、回了「确认」，却什么都没发生，
     * 看起来就是「确认没用」。判据必须具体：群里真的有一条写着「方案待甲方确认」的发言。
     */
    const latest = this.requirements[this.requirements.length - 1];
    const planPosted = latest
      ? this.group.some((message) => message.requirementId === latest.id
        && message.author === 'agent'
        && /待甲方确认|请甲方确认|等你确认|请确认方案/.test(message.body))
      : false;
    const target = awaiting[awaiting.length - 1]
      ?? (latest && this.phaseOf(latest.id) !== 'implement'
        && (planPosted || looksLikeExplicitGoAhead(text))
        ? latest.id
        : undefined);
    /* 既没有待确认的方案、群里也没有方案：这句话跟阶段无关，别抢着解释。 */
    if (!target) return undefined;
    const requirementId = target;
    if (looksLikePlanApproval(text)) {
      this.setPhase(requirementId, 'implement');
      return { requirementId, phase: 'implement' };
    }
    if (looksLikePlanRejection(text)) {
      this.setPhase(requirementId, 'negotiate');
      return { requirementId, phase: 'negotiate' };
    }
    return undefined;
  }

  /**
   * 设备 id → 给人看的统一标识（系统 · 设备名）。
   *
   * 手机端拿不到也不需要拿到 id：它只认名字。认不出来的 id（对端已经离开、或旧存档里
   * 留下的）给一个可读的兜底，绝不把一串哈希丢到界面上。
   */
  labelForPeerId(peerId: string): string {
    if (!peerId) return '未知设备';
    if (peerId === this.bridge.peer().id) return `${this.bridge.peer().name}（本机）`;
    const roster = [this.bridge.peer(), ...this.peerList().map((entry) => entry.peer)];
    const peer = roster.find((item) => item.id === peerId);
    return peer ? deviceLabel(peer, roster) : '已离开的设备';
  }

  /** 群里出现过的所有设备 id（本机 + 在线对端 + 已读记录里出现过的）。 */
  private allPeerIds(): string[] {
    const ids = new Set<string>([this.bridge.peer().id, ...this.peerList().map((entry) => entry.peer.id)]);
    for (const peers of this.reads.values()) for (const id of peers) ids.add(id);
    return [...ids];
  }

  /** 把账本写进仓库：这是「对齐」的可见产物，人和模型都能读。 */
  private async refreshLedger(): Promise<void> {
    const rows = buildLedger(this.requirements, this.reports);
    if (!rows.length) return;
    try {
      // 带名册进去，「哪台设备没有报告」才有依据（设备数不固定，不能靠平台枚举猜）
      const roster = [this.localPeer(), ...this.peerList().map((entry) => entry.peer)];
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
  async shareRequirement(
    text: string,
    assignee = '',
    assets?: readonly GroupAssetRef[],
  ): Promise<{ ok: boolean; message: string; requirement?: SyncRequirement }> {
    // 用逻辑时钟而不是本机 Date.now()：多设备并发时才能排出全序。
    const requirement = makeRequirement(this.localPeer(), text, this.nextClock());
    if (!requirement) return { ok: false, message: '需求内容为空。' };
      // 只在指定了某台设备时才带 assignee：留空表示「谁都可以接」。
      if (assignee) requirement.assignee = assignee;
      // 附件元信息：接收方据此等分片到齐，把本机路径交给自己的 agent。
      if (assets?.length) requirement.assets = assets.slice(0, 8);
      // 带上本机选中的项目：对方据此判断「是不是同一个项目」。
      const project = this.activeProjectName();
      if (project) requirement.project = project;
      // 项目唯一 ID：仓库地址（文件夹名不参与判断）。
      const repo = this.currentRepo();
      if (repo) requirement.repo = repo;
    const exists = this.requirements.some((item) => item.id === requirement.id);
    if (!exists) this.requirements = [...this.requirements, requirement].slice(-STATE_LIMIT);
    await this.persist();
    await this.refreshLedger();
    /*
     * 本机用户刚说的话一定是最新的：先把正在跑的旧需求停掉。
     * 这样「多台设备、多位用户、命令冲突」时，永远只执行最后说的那条。
     */
    if (this.runningRequirement && this.runningRequirement.id !== requirement.id) {
      this.bridge.onSuperseded?.({
        stopped: this.runningRequirement.id,
        next: requirement.id,
        from: '本机用户',
      });
      this.runningRequirement = { id: requirement.id, createdAt: requirement.createdAt };
    }
    const relayResult = await this.relayOut(requirement);

    if (this.role !== 'off') {
      const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.credential(), port: this.port, message: requirement });
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
        code: this.credential(),
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
  async shareNote(input: { body: string; topic?: string; replyTo?: string; to?: string }): Promise<{ ok: boolean; message: string; note?: SyncNote; delivered: boolean }> {
    /*
     * 自动成线程：没指定 replyTo 时，接在「最近一条别人发来的消息」之后。
     *
     * 用户要的是「两个 agent 自己沟通」—— 线程靠模型自觉填 replyTo 是靠不住的，
     * 这里按事实（最近一条对端消息）补上，界面才能画出「谁回谁」。
     */
    const lastOther = [...this.notes].reverse().find((item) => item.from.id !== this.localPeer().id);
    const note = makeNote(this.localPeer(), {
      ...input,
      replyTo: input.replyTo || lastOther?.id || '',
    });
    if (!note) return { ok: false, message: '消息内容为空。', delivered: false };
    // 本地产生：到达时刻就是它被造出来的时刻（对端按自己的到达时刻盖章）。
    note.receivedAt = note.at;
    this.notes = [...this.notes, note].slice(-MAX_NOTES);
    await this.persist();
    void this.relayOut(note);
    if (this.role === 'off') {
      this.bridge.onState?.();
      return { ok: true, message: '本机已记录。局域网同步未启用，没有发出。', note, delivered: false };
    }
    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.credential(), port: this.port, message: note });
    if (this.role === 'hub') {
      const targets = this.peerList().filter((entry) => entry.address);
      const results = await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
      const delivered = results.filter((result) => result.status === 'fulfilled').length;
      this.bridge.onState?.();
      return {
        ok: targets.length === 0 || delivered > 0,
        message: targets.length ? `已发给 ${delivered}/${targets.length} 台设备。` : '已记录，当前没有其它设备加入。',
        note,
        delivered: delivered > 0,
      };
    }
    const response = await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', {
      protocol: SYNC_PROTOCOL_VERSION,
      code: this.credential(),
      message: note,
    }).catch(() => undefined);
    this.bridge.onState?.();
    return {
      ok: Boolean(response?.ok),
      message: response?.ok ? '已发给对端。' : '记录成功，但发送失败（主机没响应）。',
      note,
      delivered: Boolean(response?.ok),
    };
  }

  /**
   * 记下「我刚刚问了队友一个问题」，并返回等待句柄。
   *
   * 只在 `action=ask` 时调用 —— 普通 `send` 是同步进展，不算在等回话。
   *
   * **收件人是「群里其它每一台」，不是某一台**：协作群可以有三台以上设备，
   * 只记第一台会让第二台的回答被当成「还没回话」，收尾永远降级成进度。
   */
  noteAskSent(note: SyncNote, requirementId: string, delivered = true, targets?: readonly SyncPeer[]): void {
    /*
     * 没真的发出去（同步没开 / 群里只有本机 / 发送失败）就不算「在等回话」：
     * 没人会回答，记下来只会让这一轮永远交不出结果。
     */
    if (!delivered) return;
    const roster = [...(targets ?? this.peerList().map((entry) => entry.peer))];
    const recipients = roster.map((peer) => ({ id: peer.id, label: deviceLabel(peer, roster) }));
    if (!recipients.length) return;
    this.pendingAsks = [
      ...this.pendingAsks.filter((item) => item.noteId !== note.id),
      {
        noteId: note.id,
        topic: note.topic,
        requirementId,
        at: Date.now(),
        targets: recipients,
        replied: [],
      },
    ].slice(-8);
    this.askReplies.delete(note.id);
    this.bridge.onState?.();
  }

  /**
   * 等这条提问的回答（**所有**收件人都回话才算齐）。
   *
   * 有上限的原因：队友可能正在跑长任务。等一会儿是「真的沟通」，
   * 无限等就是卡死 —— 超时后把已经收到的回答交回去，并如实说还差谁。
   */
  waitForReply(noteId: string, timeoutMs: number): Promise<SyncNote[]> {
    /*
     * 同一段时间里连问好几个问题时，后面的等待要缩短：每个都等 90 秒，
     * 一轮下来能把界面卡住好几分钟 —— 沟通要真等，但不能等到用户以为死机。
     */
    const recent = this.pendingAsks.filter((item) => Date.now() - item.at < 5 * 60_000).length;
    const budget = recent > 1 ? Math.min(timeoutMs, 20_000) : timeoutMs;
    const collected = (): SyncNote[] => this.askReplies.get(noteId) ?? [];
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.askWaiters.delete(noteId);
        resolve(collected());
      };
      // 已经问过的那个问题可能早就被回答完了（同一轮里重复等）。
      if (!this.pendingAsks.some((item) => item.noteId === noteId)) {
        if (collected().length) { resolve(collected()); return; }
      }
      this.askWaiters.set(noteId, finish);
      setTimeout(finish, Math.max(1_000, budget));
    });
  }

  /** 这条提问还在等谁回话（标签）。 */
  pendingAskPeers(noteId: string): string[] {
    const ask = this.pendingAsks.find((item) => item.noteId === noteId);
    if (!ask) return [];
    return ask.targets.filter((target) => !ask.replied.includes(target.id)).map((target) => target.label);
  }

  /** 还在等谁回话（群里收尾据此判断「能不能算结果」）。 */
  pendingAsksFor(requirementId: string): { toId: string; label: string; at: number }[] {
    /*
     * 过期的提问不再挡收尾：队友可能已经离线 / 换群 / 单方面放弃。
     * 用它挡一辈子，任务就永远交不出结果 —— 那比「单方面宣布完成」更糟。
     */
    const present = new Set(this.peerList().map((entry) => entry.peer.id));
    /*
     * 只有**确认过群里有谁**（peerList 非空）时才按「对方已离群」删收件人。
     * peerList 暂时为空（刚重载 / 网络抖动）时不能当成「都走了」—— 那会把
     * 还在等的提问悄悄清掉，于是这一轮被当成跑完。
     */
    const known = present.size > 0;
    const kept = this.pendingAsks
      .filter((item) => Date.now() - item.at < ASK_WAIT_EXPIRY_MS)
      .map((item) => ({
        ...item,
        targets: known ? item.targets.filter((target) => present.has(target.id)) : item.targets,
      }))
      .filter((item) => item.targets.length > 0);
    this.pendingAsks = kept;
    const key = requirementId || '';
    return kept
      .filter((item) => !key || item.requirementId === key || item.requirementId === '')
      .flatMap((item) => item.targets
        .filter((target) => !item.replied.includes(target.id))
        .map((target) => ({ toId: target.id, label: target.label, at: item.at })));
  }

  /** 收到一条协作消息：如果它回答了我问出去的问题，就算「这一台回话了」。 */
  private settleAskFor(note: SyncNote): 'waiter' | 'pending' | false {
    /*
     * 判据：显式回复这条提问（`replyTo` 对得上），或同一主题下队友主动回了话。
     * 只认「我问出去的那个主题」，不把无关进展当成回答 —— 否则一次闲聊就会
     * 让「还在等」变假。
     */
    const matched = this.pendingAsks.filter((item) => item.targets.some((target) => target.id === note.from.id))
      .filter((item) => note.replyTo === item.noteId || (note.topic && item.topic === note.topic));
    if (!matched.length) return false;
    let resolvedWaiter = false;
    let fullySettled = false;
    for (const ask of matched) {
      if (!ask.replied.includes(note.from.id)) {
        ask.replied = [...ask.replied, note.from.id];
        this.askReplies.set(ask.noteId, [...(this.askReplies.get(ask.noteId) ?? []), note]);
      }
      // 还有收件人没回话：这条提问继续挂着，但不需要把本机再叫醒一轮。
      if (ask.targets.every((target) => ask.replied.includes(target.id))) {
        this.pendingAsks = this.pendingAsks.filter((item) => item.noteId !== ask.noteId);
        const waiter = this.askWaiters.get(ask.noteId);
        if (waiter) {
          resolvedWaiter = true;
          waiter();
        } else {
          fullySettled = true;
        }
      }
    }
    this.bridge.onState?.();
    /*
     * 没人等在等（那一轮已经收工）时才需要新起一轮合并结论 ——
     * 只有「所有收件人都回完」才算「新起一轮去合并」的时机。
     */
    if (resolvedWaiter) return 'waiter';
    return fullySettled ? 'pending' : false;
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
    replyTo?: string;
    to?: string;
    options?: readonly string[];
    meta?: import('./lanProtocol').GroupMessageMeta;
    /** 这条发言自带的附件（字节已经通过 `shareAsset` 发出去）。 */
    assets?: GroupAssetRef[];
    /**
     * 不挂在任何需求上（报数这类群口令）。
     *
     * 否则会自动关联「最近一条需求」，把那条需求的状态又拉回「待解析」。
     */
    detached?: boolean;
  }): Promise<{ ok: boolean; message: string; group?: SyncGroupMessage }> {
    /*
     * 关联需求：没指定就用最近的一条。
     *
     * 模型经常只写 `action=analysis` 而忘了带需求号 —— 让它自己再猜一次毫无价值，
     * 而「最近一条需求」在真实使用里几乎总是对的。
     */
    const { detached, ...message } = input;
    const requirementId = detached
      ? ''
      : input.requirementId || this.requirements[this.requirements.length - 1]?.id || '';
    const group = makeGroupMessage(this.localPeer(), { ...message, requirementId });
    if (!group) return { ok: false, message: '群消息内容为空。' };
    /*
     * **过程纪律闸门**（用户 2026-11-26：「agent 相互乱说、这里改一下那里改一下，项目却
     * 没有丝毫推进」）。
     *
     * 只拦两类**确定没信息量**的发言（判据见 `sync/processDiscipline.ts`）：
     *  1. 和本机最近说过的几乎一样 → 复述不推进项目；
     *  2. 非要当「结果」发却没有任何可核对的东西 → 按 Definition of Done 只能算进展。
     * 拦下来把「该怎么做」直接回给模型（`ok: false` 会让 `team_sync` 把这句话交给它）。
     */
    if (input.author === 'agent') {
      const check = checkTeamPost({
        body: input.body,
        phase: input.phase,
        recent: this.group
          .filter((item) => item.author === 'agent' && item.from.id === this.bridge.peer().id)
          .slice(-RECENT_POST_WINDOW)
          .map((item) => item.body),
      });
      if (check.action === 'reject') {
        this.bridge.log(`[sync] 拦下一条没信息量的发言：${input.body.slice(0, 40)}`);
        return { ok: false, message: check.guidance ?? '这条发言没有新信息，换一个做法。' };
      }
    }
    /*
     * 「没有推进」的计数：甲方发话、阶段推进、收到报告都算推进，把计数清零；
     * agent 每发一条就 +1，到阈值就停线（先提醒，再不推进就关掉自动应答）。
     */
    if (input.author === 'agent') {
      this.stalePosts += 1;
      const verdict = staleWatchVerdict(this.stalePosts);
      if (verdict !== 'ok' && this.staleNudgedAt !== requirementId) {
        this.staleNudgedAt = requirementId;
        this.bridge.log(`[sync] 连续 ${this.stalePosts} 条发言没有推进：停线提醒`);
        void this.postGroup({
          author: 'agent',
          phase: 'question',
          body: staleNudgeBody(this.stalePosts),
          ...(requirementId ? { requirementId } : {}),
          options: ['只推进一件事，我来定', '先停下，我要改方向'],
        }).catch(() => undefined);
        if (verdict === 'hold') {
          /*
           * 停线到硬阈值：再发一条**明确的**停线消息，但**不静默关掉协作**。
           *
           * 之前这里直接 `notesHeld = true`：那是「对方说话这台不再听」，属于静默副作用 ——
           * 一旦误判，用户看到的就是「怎么叫都不动」，比绕圈更糟。
           * 关协作只留给人一个动作：他在群里说一句，或按「停止执行」。
           */
          this.bridge.log('[sync] 停线已达硬阈值：只提示甲方，不静默关闭协作');
        }
      }
    } else {
      this.stalePosts = 0;
      this.staleNudgedAt = '';
    }
    // 本机发出的消息：到达时刻就是它被造出来的时刻（对端则以到达它的时刻为准）。
    const local: typeof group = { ...group, receivedAt: group.at };
    this.group = [...this.group, local].slice(-MAX_GROUP_MESSAGES);
    this.trace(`本机发出：${input.author === 'user' ? '甲方' : '乙方'}·${input.phase}「${input.body.slice(0, 24)}」`);
    // 正式那条已经进群了，临时回显就地消失（不额外刷一次界面）。
    this.clearPendingGroup();
    /*
     * 先让界面动起来，再落盘。
     *
     * 以前是先 `await persist()`、再把整份群记录写一遍 markdown，最后才通知面板 ——
     * 群消息越多写盘越久，Windows 上还要过一遍杀毒扫描，用户看到的就是「发完半天才出现」。
     * 内存里已经 push 过了，界面读的就是这份数据；落盘紧跟其后，语义不变。
     */
    await this.bridge.onGroupMessage?.(local).catch(() => undefined);
    /*
     * 本机也要算「已读」——甲方的、乙方的都一样。
     *
     * 用户实况（2026-11-25）：「我发的消息没有 @ 任何 agent，默认是所有人都收到消息，
     * 但是显示只有『已读：macOS …』」——因为以前只有**收到别人消息**时才回执，
     * 自己发的那条永远没有自己的回执。可本机确实是收到并要处理这条的（它就在本机
     * 的群记录里），所以按同一条规则补上：说给本机的，自己也记一次已读。
     *
     * 2026-11-26 再放宽到所有作者：agent 自己的发言同样要显示「哪些 agent 已读」。
     */
    if (this.addressedToLocal(local)) {
      this.markRead([local.id], this.localPeer().id);
    }
    await this.persist();
    await this.refreshTranscript();
    void this.relayOut(group);
    this.bridge.onState?.();
    if (this.role === 'off') return { ok: true, message: '已记入团队群（未启用局域网同步，没有发给队友）。', group: local };

    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.credential(), port: this.port, message: group });
    if (this.role === 'hub') {
      const targets = this.peerList().filter((entry) => entry.address);
      await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
    } else {
      await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', { code: this.credential(), port: this.port, message: group }).catch(() => undefined);
    }
    return { ok: true, message: '已发到团队群。', group: local };
  }

  /** 群里的最近发言（`team_sync status` 与面板用）。 */
  recentGroup(limit = 12): SyncGroupMessage[] {
    return this.group.slice(-Math.max(1, limit));
  }

  /**
   * 把一条网络消息发给群里其它设备（与 `postGroup` 相同的传输路径）。
   *
   * 回执要快、要轻，但不能走 `/deliver` 之外的另一条路 —— 两台之间的
   * 信任与端口规则只有一套，另开一条迟早会出现「群消息能到、回执到不了」。
   */
  private async sendToPeers(message: SyncMessage): Promise<void> {
    void this.relayOut(message);
    if (this.role === 'off') return;
    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.credential(), port: this.port, message });
    if (this.role === 'hub') {
      const targets = this.peerList().filter((entry) => entry.address);
      await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
      return;
    }
    await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', { code: this.credential(), port: this.port, message })
      .catch(() => undefined);
  }

  /**
   * 告诉群里：这些消息我已经收到了（已读）。
   *
   * 与「答一句」分开：收到是确定的、几乎零成本，而回答要跑一轮模型。
   * 甲方因此能立刻区分「没收到」和「收到了但正忙」。
   */
  async ackGroup(ids: readonly string[]): Promise<void> {
    const receipt = makeReceipt(this.localPeer(), ids);
    if (!receipt) return;
    // 自己也记一份：本机面板靠它显示「哪台已读」。
    this.markRead(receipt.ids, receipt.from.id);
    await this.sendToPeers(receipt);
  }

  /** 记下「这些消息被这台设备读到了」。 */
  private markRead(ids: readonly string[], peerId: string): void {
    if (!peerId) return;
    let changed = false;
    for (const id of ids) {
      const set = this.reads.get(id) ?? new Set<string>();
      if (set.has(peerId)) continue;
      set.add(peerId);
      this.reads.set(id, set);
      changed = true;
    }
    if (!changed) return;
    // 只留还在群里的消息，避免无限增长。
    const alive = new Set(this.group.map((item) => item.id));
    for (const id of [...this.reads.keys()]) {
      if (!alive.has(id)) this.reads.delete(id);
    }
  }

  /** 某条群消息已被哪些设备读到了（设备 id）。 */
  readsOf(messageId: string): string[] {
    return [...(this.reads.get(messageId) ?? [])];
  }

  /** 全部已读回执（面板一次取完）。 */
  allReads(): Record<string, string[]> {
    return Object.fromEntries([...this.reads.entries()].map(([id, peers]) => [id, [...peers]]));
  }

  /** 附件落盘目录（与同步状态文件同一层，重载窗口后仍然在）。 */
  private assetsDir(): string {
    return join(dirname(this.storagePath), 'assets');
  }

  /**
   * 把一个附件发给群里其它设备，返回它的元信息。
   *
   * 本机也留一份（写进 `assets/`）：**发消息的那台 agent 同样要能读到**，
   * 而面板渲染图片需要真实文件路径。
   */
  async shareAsset(input: {
    name: string;
    mimeType: string;
    kind: 'image' | 'file';
    dataBase64: string;
  }): Promise<GroupAssetRef | undefined> {
    const dataBase64 = (input.dataBase64 ?? '').replace(/\s+/g, '');
    if (!dataBase64) return undefined;
    if (dataBase64.length > ASSET_CHUNK_CHARS * ASSET_MAX_CHUNKS) {
      this.bridge.log('[sync] 附件过大，没有随群消息转发（本机仍可用）', 'warn');
      return undefined;
    }
    const id = `a${randomBytes(6).toString('hex')}`;
    const safe = input.name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(-60) || 'attachment';
    const path = join(this.assetsDir(), `${id}-${safe}`);
    const bytes = Buffer.from(dataBase64, 'base64');
    try {
      await mkdir(this.assetsDir(), { recursive: true });
      await writeFile(path, bytes);
      this.assetPaths.set(id, path);
    } catch (error) {
      this.bridge.log(`[sync] 附件落盘失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
    const ref: GroupAssetRef = {
      id,
      name: input.name,
      mimeType: input.mimeType,
      kind: input.kind,
      bytes: bytes.byteLength,
    };
    if (this.role === 'off') return ref;
    const total = Math.ceil(dataBase64.length / ASSET_CHUNK_CHARS);
    const message = (index: number): SyncAssetChunk => ({
      kind: 'asset',
      id,
      from: this.localPeer(),
      index,
      total,
      name: ref.name,
      mimeType: ref.mimeType,
      assetKind: ref.kind,
      dataBase64: dataBase64.slice(index * ASSET_CHUNK_CHARS, (index + 1) * ASSET_CHUNK_CHARS),
      at: Date.now(),
    });
    /*
     * 分片**顺序发**：并发几十个 HTTP 会互相抢带宽，局域网里也更容易出现
     * 「前一片到了、后一片超时」，看起来就是「图片一直收不全」。
     */
    void (async () => {
      for (let index = 0; index < total; index += 1) {
        await this.sendToPeers(message(index)).catch(() => undefined);
      }
    })();
    return ref;
  }

  /**
   * 上报本机 agent 的状态（指示灯），并广播给群里的其它设备。
   *
   * 只在**真的变化**时才广播：状态是低频事件，但一次任务里收尾/重试会连着触发几次，
   * 每次都发等于把群当成心跳通道。
   */
  reportAgentState(state: AgentActivity): void {
    const me = this.bridge.peer().id;
    const previous = this.activities.get(me)?.state;
    if (previous === state) return;
    this.activities.set(me, { state, at: Date.now() });
    void this.broadcastAgentState(state);
    this.bridge.onState?.();
  }

  private async broadcastAgentState(state: AgentActivity): Promise<void> {
    const control: SyncControlMessage = {
      kind: 'control',
      id: `ctl-agent-${this.bridge.peer().id.slice(0, 8)}-${Date.now().toString(36)}`,
      from: this.localPeer(),
      action: 'agentState',
      agentState: state,
      running: state === 'running',
      at: Date.now(),
    };
    void this.relayOut(control);
    await this.sendToPeers(control).catch(() => undefined);
  }

  /** 每台设备当前状态（面板据此画指示灯）。 */
  agentStates(): Record<string, AgentActivity> {
    return Object.fromEntries([...this.activities.entries()].map(([id, value]) => [id, value.state]));
  }

  /** 附件落盘目录（群消息里的图片就在这儿；面板要把 `webviewSrc` 建在这个根下）。 */
  assetDirectory(): string {
    return this.assetsDir();
  }

  /** 附件在本机的路径（还没收齐 / 没这个 id 时返回空串）。 */
  assetPath(id: string): string {
    /*
     * 先查内存表，再按文件名前缀在磁盘上找一遍。
     *
     * 用户实况（2026-11-25）：「贴进团队群对话框和团队任务对话框里面的图片，只显示占位图」——
     * 图片其实已经落盘（`assets/<id>-<name>`），但 `assetPaths` 只在内存里，
     * 重载窗口 / 换进程之后 id → 路径就查不到了，界面只能画占位。
     */
    const known = this.assetPaths.get(id);
    if (known ? existsSync(known) : false) return known!;
    if (!id) return '';
    try {
      const dir = this.assetsDir();
      if (!existsSync(dir)) return '';
      const hit = readdirSync(dir).find((name) => name.startsWith(`${id}-`));
      if (!hit) return '';
      const path = join(dir, hit);
      this.assetPaths.set(id, path);
      return path;
    } catch {
      return '';
    }
  }

  /**
   * 等这些附件落到本机（最多 `timeoutMs`），返回 资产 id → 本机路径。
   *
   * 甲方的消息先到、分片后到，所以跑 agent 之前要**等一下**：
   * 直接开跑会得到「看不到图片」的回答，而这正是用户报的问题。
   */
  async waitForAssets(ids: readonly string[], timeoutMs = 4_000): Promise<Record<string, string>> {
    const wanted = ids.filter(Boolean);
    if (!wanted.length) return {};
    const done = (): Record<string, string> => Object.fromEntries(
      wanted.filter((id) => this.assetPaths.has(id)).map((id) => [id, this.assetPaths.get(id)!]),
    );
    let result = done();
    for (let waited = 0; waited < timeoutMs && Object.keys(result).length < wanted.length; waited += 100) {
      if (this.role === 'off') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = done();
    }
    return result;
  }

  /** 收一片附件；到齐了就落盘并通知面板。 */
  private async ingestAsset(chunk: SyncAssetChunk): Promise<void> {
    if (chunk.from.id === this.bridge.peer().id) return;
    if (this.assetPaths.has(chunk.id)) return;
    const box = this.assetInbox.get(chunk.id) ?? {
      name: chunk.name,
      mimeType: chunk.mimeType,
      kind: chunk.assetKind,
      total: chunk.total,
      /*
       * 必须 `fill(undefined)`：`new Array(n)` 是**稀疏数组**，`some()` 会跳过空槽，
       * 于是「只到了第一片」也会被判成「到齐了」，落盘成一张半截图。
       * 这个坑是用真实分片传输的端到端测试抓出来的。
       */
      parts: new Array<string | undefined>(chunk.total).fill(undefined),
    };
    if (box.total !== chunk.total) return;
    box.parts[chunk.index] = chunk.dataBase64;
    this.assetInbox.set(chunk.id, box);
    if (box.parts.filter((part) => part !== undefined).length < box.total) return;
    this.assetInbox.delete(chunk.id);
    const safe = box.name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(-60) || 'attachment';
    const path = join(this.assetsDir(), `${chunk.id}-${safe}`);
    try {
      await mkdir(this.assetsDir(), { recursive: true });
      await writeFile(path, Buffer.from(box.parts.join(''), 'base64'));
      this.assetPaths.set(chunk.id, path);
      this.trace(`收到附件「${box.name}」：${path}`);
      await this.bridge.onAssetReady?.(chunk.id, path);
      this.bridge.onState?.();
    } catch (error) {
      this.bridge.log(`[sync] 保存收到的附件失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  /**
   * 这条群消息是不是说给本机的。
   *
   * 判据与接收端处理一致：`to` 空 = 所有人、`assignee` 空 = 谁都能接。
   * 派给别人的消息不该回「已读」—— 否则甲方会以为那台也要做。
   */
  private addressedToLocal(message: SyncGroupMessage): boolean {
    const me = this.bridge.peer().id;
    return (!message.to || message.to === me) && (!message.assignee || message.assignee === me);
  }

  /**
   * 两个 agent 之间已经来回几轮（同一个主题、同一条需求）。
   *
   * 为什么要数：agent 之间能自由对话后，很容易「收到 → 回一句 → 对方再回」地接龙，
   * 把额度烧光却没人推进任务。这里给出可数的轮次，超过上限就不再自动应答，
   * 改成在群里把问题抛给甲方（有终止条件的对话才叫对话）。
   */
  dialogueRounds(topic = '', withinMs = 10 * 60_000): number {
    const since = Date.now() - withinMs;
    return this.notes.filter((note) => note.at >= since && (!topic || note.topic === topic)).length;
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
    /**
     * 两个 agent 之间的往来（`team_sync action=send/ask`）。
     *
     * 用户 2026-11-24：「没有实现两个 agent 在团队群自己沟通任务的功能，还是各干各的」。
     * 这些消息以前只写进账本 / 日志，界面上看不到。现在一起交给面板，
     * 按时间合进同一条时间线，并标出「回复的是哪一条」。
     */
    dialogue: { id: string; who: string; body: string; at: number; receivedAt?: number; replyTo: string; to?: string; toLabel?: string }[];
    pending?: { body: string; time: string };
    /** 当前阶段（谈 / 等确认 / 执行）。群窗口顶部要显示，甲方才知道现在能不能动手。 */
    phase?: TeamPhase;
    phaseLabel?: string;
    phaseRequirementId?: string;
    /** 自主迭代模式：谈定就开工，不会停下来等甲方确认。 */
    autonomous?: boolean;
    /**
     * 「乙方在等你回答」那条追问：**必须带上是哪台在问**。
     *
     * 用户 2026-11-24：「这种等我回答的弹出提示，没写是哪个设备等我回答，
     * 我直接回答会导致所有 agent 都收到消息」——所以这里带上问话设备的
     * id 与统一标识，回答时按它定向回给那一台。
     */
    openQuestion?: {
      requirementId: string;
      body: string;
      askerId: string;
      askerLabel: string;
      options: string[];
    };
  } {
    const questionId = this.openQuestionRequirement();
    const question = questionId
      ? [...this.group].reverse().find((message) => message.requirementId === questionId && message.phase === 'question')
      : undefined;
    const roster = [this.localPeer(), ...this.peerList().map((entry) => entry.peer)];
    const active = this.activePhase();
    return {
      role: this.role,
      /*
       * 当前阶段（谈 / 等确认 / 执行）：群窗口和手机都要能一眼看出
       * 「现在是还在谈、还是已经开干」——否则甲方会以为 agent 又擅自动手了。
       */
      ...(active ? { phase: active.phase, phaseLabel: this.phaseLabelWithMode(active.phase), phaseRequirementId: active.requirementId } : {}),
      /** 自主迭代模式（群窗口顶部显示一个标记，甲方才知道不会来问自己）。 */
      autonomous: this.autonomous(),
      peers: [this.localPeer(), ...this.peerList().map((entry) => entry.peer)],
      messages: this.group,
      dialogue: this.notes.slice(-40).map((note) => ({
        id: note.id,
        who: deviceLabel(note.from, roster),
        body: note.body,
        at: note.at,
        ...(note.receivedAt !== undefined ? { receivedAt: note.receivedAt } : {}),
        replyTo: note.replyTo ?? '',
        ...(note.to ? { to: note.to } : {}),
        ...(note.to ? { toLabel: deviceLabel(roster.find((peer) => peer.id === note.to) ?? { id: note.to }, roster) } : {}),
      })),
      ...(this.pendingGroup
        ? { pending: { body: this.pendingGroup.body, time: new Date(this.pendingGroup.at).toTimeString().slice(0, 5) } }
        : {}),
      ...(question && questionId
        ? {
          openQuestion: {
            requirementId: questionId,
            body: question.body,
            askerId: question.from.id,
            askerLabel: deviceLabel(question.from, roster),
            // 结构化选项优先；老消息没有这个字段时才从正文里抽。
            options: question.options?.length ? [...question.options] : questionOptions(question.body),
          },
        }
        : {}),
    };
  }

  /**
   * 当前追问是哪台设备问的（回答要定向回给它）。
   *
   * 以前甲方一回答就广播给群里所有 agent，两台都接着跑一遍 ——
   * 而问题其实只是一台问的。
   */
  openQuestionTarget(): { requirementId: string; askerId: string; askerLabel: string } | undefined {
    const questionId = this.openQuestionRequirement();
    if (!questionId) return undefined;
    const question = [...this.group].reverse()
      .find((message) => message.requirementId === questionId && message.phase === 'question');
    if (!question) return undefined;
    /*
     * **没有真实提问方就不算追问。**
     *
     * `from.id` 为空的消息（老版本对端 / 中继页补的消息）如果被当成追问，
     * 之后的回答只会发出一条没有 `to`、没有 `assignee` 的群消息：
     * 群里看起来「没 @ 任何人」，所有设备都当它是说给所有人的，而提问方反而收不到。
     * 宁可退化成普通需求（会正常广播 + 指派），也不要发一条谁也接不住的消息。
     */
    const askerId = (question.from?.id ?? '').trim();
    if (!askerId) return undefined;
    const roster = [this.localPeer(), ...this.peerList().map((entry) => entry.peer)];
    return { requirementId: questionId, askerId, askerLabel: deviceLabel(question.from, roster) };
  }

  /**
   * 当前有没有「乙方问了、甲方还没回答」的需求，返回它的需求号。
   *
   * 面板用它决定：甲方下一条消息是**回答追问**（并入同一条需求），
   * 还是一条**新需求**（新开一条、再广播给对端）。判错会让追问永远收不了尾。
   */
  openQuestionRequirement(): string | undefined {
    /*
     * 从最新一条往前找：**甲方只要再说过话，之前的追问就不再「在等」**。
     *
     * 用户实况（2026-11-25）：「我没 @ 谁，直接发的消息却显示 @windows」——
     * 以前按需求逐个查 `awaiting-user`，于是旧需求上那条追问永远算「在等」，
     * 甲方之后每一句话都被它劫走（只发给提问的那台）。
     */
    for (let index = this.group.length - 1; index >= 0; index -= 1) {
      const message = this.group[index]!;
      if (message.author === 'user') return undefined;
      if (message.phase === 'question') return message.requirementId;
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
    const report = makeReport(this.localPeer(), input);
    const key = `${report.requirementId}\u0000${report.from.platform}\u0000${report.from.id}`;
    const index = this.reports.findIndex((item) => `${item.requirementId}\u0000${item.from.platform}\u0000${item.from.id}` === key);
    if (index >= 0) this.reports[index] = report;
    else this.reports = [...this.reports, report].slice(-STATE_LIMIT * 3);
    await this.persist();
    await this.refreshLedger();
    void this.relayOut(report);
    if (this.role === 'off') return;
    const payload = JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, code: this.credential(), port: this.port, message: report });
    if (this.role === 'hub') {
      const targets = this.peerList().filter((entry) => entry.address);
      await Promise.allSettled(targets.map((entry) => postRaw(entry.address, '/hwchat-sync/v1/deliver', payload)));
    } else {
      await this.postJson(this.hubAddress, '/hwchat-sync/v1/message', { code: this.credential(), port: this.port, message: report }).catch(() => undefined);
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

  /**
   * peer 心跳：定期确认主机还在。
   *
   * 没有它就会出现用户遇到的那种假状态 —— 主机重启、改 IP、或断开了，
   * 而界面一直显示「已连接」，群记录也是旧的那一份，两台看到的群完全不一样。
   */
  private startPeerHeartbeat(): void {
    this.stopPeerHeartbeat();
    this.heartbeatTimer = setInterval(() => { void this.checkHost(); }, 8_000);
    this.heartbeatTimer.unref?.();
  }

  private stopPeerHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  /** 连一次主机；连上就算活着。 */
  private pingHost(address: string): Promise<boolean> {
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL('/hwchat-sync/v1/ping', address);
      } catch {
        resolve(false);
        return;
      }
      const request = httpRequest({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'GET',
        timeout: 3_000,
      }, (response) => {
        response.resume();
        resolve((response.statusCode ?? 500) < 500);
      });
      request.on('timeout', () => { request.destroy(); resolve(false); });
      request.on('error', () => resolve(false));
      request.end();
    });
  }

  /** 立刻做一次主机存活检查（心跳定时器内部用，也给诊断/测试用）。 */
  async checkHostOnce(): Promise<void> {
    await this.checkHost();
  }

  private async checkHost(): Promise<void> {
    if (this.role !== 'peer' || !this.hubAddress) {
      this.stopPeerHeartbeat();
      return;
    }
    const alive = await this.pingHost(this.hubAddress);
    if (alive) {
      this.hostMisses = 0;
      return;
    }
    this.hostMisses += 1;
    // 容忍一次抖动：网络短时波动不该直接踢人。
    if (this.hostMisses < 2) return;
    const lost = this.hubAddress;
    this.stopPeerHeartbeat();
    this.role = 'off';
    this.hubAddress = '';
    this.hostMisses = 0;
    this.bridge.log(`[sync] 主机 ${lost} 连续无响应，已断开（界面不再显示「已连接」）`, 'warn');
    this.bridge.onState?.();
    this.bridge.onHostLost?.(lost);
  }

  /**
   * 下一个逻辑时间戳。
   *
   * 取「本机时钟」和「见过的时间 +1」的较大值：本机用户刚打的字一定比之前
   * 任何一条更新；收到别人的消息则把时钟推上去，后续本机消息不会反被判断成旧的。
   */
  private nextClock(): number {
    this.lastClock = Math.max(Date.now(), this.lastClock + 1);
    return this.lastClock;
  }

  /** 收到别人的需求时把时钟推上去（Lamport 规则）。 */
  private observeClock(value: number): void {
    if (Number.isFinite(value) && value > this.lastClock) this.lastClock = value;
  }

  /**
   * 两条需求谁更新。**纯函数式比较**，所有设备算出来一样。
   *
   * 先比逻辑时间，再比 id（时间相同时的确定性 tie-break）。
   */
  private isNewer(
    candidate: { id: string; createdAt: number },
    current: { id: string; createdAt: number } | undefined,
  ): boolean {
    if (!current) return true;
    if (candidate.createdAt !== current.createdAt) return candidate.createdAt > current.createdAt;
    return candidate.id > current.id;
  }

  /**
   * 执行一条需求，并保证「只有最新的那条在跑」。
   *
   * 用户明确要求：两台（或更多）设备的用户发的消息冲突时，按时间先后执行，
   * **执行最新的那条**。所以新需求到达时要把正在跑的旧需求停下来 —
   * 否则两个 agent 各做一半，改动还会互相覆盖。
   */
  private async runNewest(
    requirement: SyncRequirement,
    runner: (requirement: SyncRequirement) => Promise<boolean>,
  ): Promise<'ran' | 'superseded' | 'busy'> {
    if (!this.isNewer(requirement, this.runningRequirement)) {
      this.bridge.log(
        `[sync] 需求 ${requirement.id} 比正在执行的 ${this.runningRequirement?.id ?? ''} 旧，跳过（执行最新的）`,
      );
      return 'superseded';
    }
    if (this.runningRequirement && this.runningRequirement.id !== requirement.id) {
      this.bridge.log(
        `[sync] 有新消息 ${requirement.id}，停掉正在执行的 ${this.runningRequirement.id}（执行最新的）`,
      );
      this.bridge.onSuperseded?.({
        stopped: this.runningRequirement.id,
        next: requirement.id,
        from: requirement.from.name,
      });
    }
    this.runningRequirement = { id: requirement.id, createdAt: requirement.createdAt };
    try {
      const accepted = await runner(requirement);
      return accepted ? 'ran' : 'busy';
    } finally {
      // 只有自己还是"当前那条"时才清空，避免把后来的需求状态抹掉。
      if (this.runningRequirement?.id === requirement.id) this.runningRequirement = undefined;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.noteRetryTimer) {
      clearInterval(this.noteRetryTimer);
      this.noteRetryTimer = undefined;
    }
    this.stopPeerHeartbeat();
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

/**
 * 一台设备的实时探测结果。
 *
 * `version` 是关键：两台跑不同版本时，行为会不一样（新版有的钩子旧版没有），
 * 以前只能靠猜「是不是没更新」，现在是直接问出来。
 */
export interface PeerProbe {
  name: string;
  address: string;
  ok: boolean;
  ms: number;
  version: string;
  protocol: number;
  error?: string;
}

function getRaw(address: string, path: string, timeoutMs: number): Promise<string> {
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
      method: 'GET',
      timeout: timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 500) >= 400) reject(new Error(`HTTP ${response.statusCode}`));
        else resolve(text);
      });
    });
    request.on('timeout', () => request.destroy(new Error('超时')));
    request.on('error', reject);
    request.end();
  });
}

/** 从 `http://ip:port` 取 IP。 */
function ipOf(address: string | undefined): string {
  const match = /^https?:\/\/([^/:]+)/i.exec(address ?? '');
  return match?.[1] ?? '';
}

/**
 * 把 IP 记进设备身份。
 *
 * 只在**同名设备分不清**时显示（`deviceLabel` 判定重名才拼上去），
 * 所以平时界面不会多出 IP，两台都叫 DESKTOP 时才会出现。
 */
function withHost(peer: SyncPeer, host: string): SyncPeer {
  const clean = (host ?? '').trim();
  return clean && clean !== peer.host ? { ...peer, host: clean } : peer;
}

/** 设备名：系统里用户看到的名字（`MagicBookV14`），显示时再拼系统类型。 */
export function defaultDeviceName(): string {
  return readDeviceName();
}

/**
 * 身份 id 的种子：**必须和升级前完全一致**。
 *
 * 升级前 `name` 是「主机名 · 平台」，id 由它散列而来；如果现在改用新的显示名，
 * 两台设备的 id 会一起变，互相的信任名单（approved）立刻对不上 ——
 * 表现就是「明明配过对，却进不了群」。所以 id 用这个固定的旧格式，显示用新名字。
 */
export function defaultDeviceSeed(): string {
  const raw = hostname().replace(/\.local$/i, '');
  return `${raw} · ${defaultPlatform()}`;
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
