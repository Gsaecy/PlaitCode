/**
 * 局域网跨平台对齐：协议与账本的**纯逻辑**（不 import vscode，可直接单测）。
 *
 * 用户的原话（2026-11-23）：
 *   「我经常开发多端 app，比如一个 app 的 Windows 版本和 macOS 版本，但是经常两边
 *    功能对不齐，甚至有差别，没法很好的统一……让同一个 WiFi 下两个设备能在开发一个
 *    项目的不同系统版本的时候，能交流对齐」
 *   「我只需要在一个设备上发起更新功能需求，两边能一起执行更新任务」
 *
 * 这个模块解决的是**一个需求在多台设备上各做一遍、并且能核对做没做齐**：
 *  - 需求（requirement）：在一台设备上写下要做什么，广播给对端；
 *  - 报告（report）：每台设备做完 / 跳过时回一条，带文件清单与理由；
 *  - 账本（ledger）：把两者渲染成一张「需求 × 平台」的对照表，写进仓库；
 *  - 分歧（divergence）：一边做完、另一边跳过或没做 —— 这才是用户真正怕的东西。
 *
 * 所有网络输入都当作不可信数据：`parseSyncMessage` 做形状校验与长度截断。
 */

import { normalizeRepoUrl } from './projectRef';
import { APPROVED_PROMPT, AUTONOMY_PROMPT, NEGOTIATION_PROMPT, isTeamPhase, type TeamPhase } from './planGate';

export const SYNC_PROTOCOL_VERSION = 1;
/** 单条消息上限（字节）：需求正文最多几千字，这个值足够，同时挡住畸形转发。 */
export const MAX_MESSAGE_BYTES = 80 * 1024;
export const MAX_DETAIL_CHARS = 8_000;
export const MAX_TITLE_CHARS = 120;
export const MAX_SUMMARY_CHARS = 400;
export const MAX_NOTE_CHARS = 800;
export const MAX_FILES = 60;
export const MAX_RECORDS = 300;
export const MAX_PEERS = 8;
/** 协作消息的正文上限：它是聊天，不是文档，太长会挤占对话上下文。 */
export const MAX_NOTE_BODY_CHARS = 2_000;
export const MAX_TOPIC_CHARS = 60;
/** 协作消息在本地保留多少条（用于面板回看与 `team_sync` 的 status）。 */
export const MAX_NOTES = 120;
/**
 * agent 之间自动应答的轮次上限（同一主题、10 分钟内）。
 *
 * 到顶就停下、把问题抛回群里等甲方 —— 「不达目标不罢休」不等于「无限接龙」。
 */
export const MAX_DIALOGUE_NOTES = 6;
export const ALIGNMENT_FILE = 'docs/PLATFORM-ALIGNMENT.md';

export type SyncPlatform = 'win32' | 'darwin' | 'linux';

/** 一台参与协作的设备。 */
export interface SyncPeer {
  /** 稳定标识：同一台设备每次都是同一个值。 */
  id: string;
  /** 给人看的名字，例如「MacBook · macOS」。 */
  name: string;
  platform: SyncPlatform;
  /** 参与协作的项目目录名（同一个 app 的两个版本各有一个）。 */
  project: string;
  /**
   * 项目唯一 ID：GitHub 仓库地址（已归一化）。
   *
   * 两台设备靠它判断是不是同一个项目 —— **文件夹名不算数**，
   * 同一个仓库在不同机器上可以叫不同名字。
   */
  repo?: string;
  /**
   * GitHub 登录名（拿得到时才有）。
   *
   * 用来判断「是不是同一个人在多台设备上协作」：不同账号的设备不该
   * 直接往同一个项目里写，得先确认。
   */
  login?: string;
  /** 本机工作区里的其它项目（对方缺这个项目时可以据此拉取）。 */
  projects?: string[];
  /** 本机每个项目对应的仓库地址（与 `projects` 同序）。 */
  projectRepos?: string[];
  /**
   * 这台设备在局域网里的地址（IP，不带端口）。
   *
   * 只在**同名设备分不清**时显示（用户 2026-11-24：「如果系统类型+设备名称
   * 无法区分，最好带上 IP 地址」）。两台都叫 `DESKTOP` 的 Windows 靠它区分。
   */
  host?: string;
  /** 扩展版本，便于排查「两边行为不一致是不是版本不同」。 */
  version: string;
}

export type ReportStatus = 'planned' | 'in_progress' | 'done' | 'skipped';

/** 一条跨平台需求。 */
export interface SyncRequirement {
  kind: 'requirement';
  /** 需求 id：两端用它对齐，由发起方生成且稳定。 */
  id: string;
  from: SyncPeer;
  title: string;
  detail: string;
  createdAt: number;
  /** 发起方当时选中的协作项目名：项目不一致时据此追问，而不是直接开跑。 */
  project?: string;
  /** 发起方项目的仓库地址（项目唯一 ID）。有它就以它为准，文件夹名不参与判断。 */
  repo?: string;
  /**
   * 这条需求只让哪一台设备执行（设备 id）。
   *
   * 甲方在群里说「让 macos 那边做」时就填上，别的设备收到后**不执行**，
   * 只记录。以前没有这个字段，两台都会各跑一遍同一份活。
   */
  assignee?: string;
  /**
  * 这条需求附带的图片 / 文件（甲方在群里发的附件）。
  *
  * 接收方等分片到齐、落到本机磁盘后，把**本机路径**交给自己的 agent ——
  * 这样两台 agent 看到的是同一张图，而不是只有发消息那台能看到。
  */
  assets?: GroupAssetRef[];
}

/** 一条进度报告。 */
export interface SyncReport {
  kind: 'report';
  requirementId: string;
  from: SyncPeer;
  status: ReportStatus;
  summary: string;
  files: string[];
  /** 平台差异、跳过原因等；跨平台对齐最关键的一段文字。 */
  note: string;
  at: number;
}

/**
 * 一条**协作消息**：两边 agent 之间的对话，不是需求、也不是进度报告。
 *
 * 用户的原话（2026-11-23 补充）：
 *   「甚至两边设备的 agent 可以像一个团队的同事一样沟通交流项目的情况，互通有无」
 *
 * 所以它刻意比需求更轻、更像聊天：一句问题、一段发现、一个决定。
 * `replyTo` 指向被回答的那条消息，用来串成线程，也用来**防住两个 agent 互相客套**。
 */
export interface SyncNote {
  kind: 'note';
  id: string;
  from: SyncPeer;
  /** 主题（可选）：同一件事的往来消息用同一个主题，便于在面板上归组。 */
  topic: string;
  body: string;
  /** 回答哪一条；空串表示这是一条新的发起消息。 */
  replyTo: string;
  /**
   * 这条消息说给谁（设备 id）；留空 = 群里每一台都看得见、都要看。
   *
   * 用户 2026-11-26 的规则：「让 agent 的消息也像用户消息一样，能被相互看见，
   * 唯一约束看不看得见的是 @某个 agent 的行为」。所以 `to` 是**唯一的可见性闸门**：
   *  - 空：所有设备都收到、都读、都由自己的 agent 判断要不要接；
   *  - 有值：只有那一台读，其余的设备也**显示**（人要看得到过程），但不当成给自己的活。
   */
  to?: string;
  at: number;
  /** 本机收到它的时刻（时间线排序依据，见 `messageOrderKey`；本地产生时等于 `at`）。 */
  receivedAt?: number;
}

/**
 * 一张「等你批准」的授权卡，跨设备传递。
 * 为什么单独一种消息而不是塞进群消息：群记录是给人看的项目讨论，
 * 工具授权是"要不要允许跑这条命令"，混进去会把群刷满，
 * 而且审批有明确的生命周期（请求 → 决定 → 过期），不适合当聊天记录。
 *
 * `phase: 'request'` 由执行设备发出，`phase: 'decision'` 由批准方发回。
 */
export interface SyncApprovalMessage {
  kind: 'approval';
  id: string;
  from: SyncPeer;
  phase: 'request' | 'decision';
  title: string;
  summary: string;
  detail: string;
  risk: 'read' | 'write' | 'command' | 'dangerous';
  /** 只有 `decision` 才用到。 */
  allow?: boolean;
  at: number;
}

/** 手机能远程改的权限档位（与 core/permissions 的预设同名）。 */
export type RemotePreset = 'askAll' | 'review' | 'autopilot' | 'full';

/**
 * 一台设备的 agent 现在在做什么（团队群的指示灯）。
 *
 *  - `running`：正在执行任务（绿灯闪动）
 *  - `waiting`：卡在等甲方确认 / 授权 / 回答（黄灯闪动）
 *  - `error`：上一轮异常中断（红灯）
 *  - `idle`：没在跑（灰灯）
 */
export type AgentActivity = 'running' | 'waiting' | 'error' | 'idle';

const AGENT_ACTIVITIES: ReadonlySet<string> = new Set(['running', 'waiting', 'error', 'idle']);

/**
 * 手机发来的**远程控制**指令：改权限档位、改步数、中止当前任务。
 *
 * 为什么需要它：agent 在电脑上跑起来之后，卡点全在"要不要允许这条命令"。
 * 如果手机只能看不能改，那"用手机指挥"就等于还得有人在电脑旁按允许 ——
 * 这个功能就没有意义了。
 */
export interface SyncControlMessage {
  kind: 'control';
  id: string;
  from: SyncPeer;
  /**
   * `state` 是「请把当前设置告诉我」/「当前设置是这样」：
   * 手机第一次连上时发一次，电脑随后广播自己的真实状态。
   * 没有它，手机只能显示自己点过什么，和电脑实际设置可能不一致。
   */
  action: 'preset' | 'steps' | 'stop' | 'state' | 'project' | 'stopGroup' | 'agentState';
  preset?: RemotePreset;
  steps?: number;
  /**
   * 只有 `agentState` 用：这台 agent 现在处于什么状态。
   *
   * 用户 2026-11-25：「团队群需要能显示设备 agent 运行状态，也就是哪个 agent 正在运行，
   * 哪个停止运行了」——群里用指示灯显示，每台自己上报，不靠猜。
   *
   * 单独一个 action 而不是复用 `state`：`state` 是「请把设置告诉我」的查询语义，
   * 两台互发会形成回声。
   */
  agentState?: AgentActivity;
  /** `project` 用：让对端切到哪个项目（名字来自对端自己的项目列表）。 */
  project?: string;
  /** `project` 用：该项目的仓库地址（项目唯一 ID）。 */
  repo?: string;
  /** 只有 `state` 用：电脑上是否正在执行任务。 */
  running?: boolean;
  at: number;
}

/**
 * 「这条群消息我收到了」（已读回执）。
 *
 * 用户 2026-11-25：「我发 @所有人的消息，window 这个 agent 收到后，
 * 这个消息下面会显示 Windows 这个 agent 已读」——否则甲方无法区分
 * 「没收到」和「收到了但正在忙」。
 *
 * 独立成一种消息而不是往群消息里塞字段：
 *  - 群里**不产生气泡**（回执不是发言，混进去会把对话淹掉）；
 *  - 旧版本收到不认识的 kind 会直接丢弃（`parseSyncMessage` 返回 undefined），
 *    因此不会把回执误当成「需求」或「回答」，天然兼容。
 */
export interface SyncReceipt {
  kind: 'receipt';
  id: string;
  from: SyncPeer;
  /** 已读的群消息 id（一次最多若干条，避免刷屏）。 */
  ids: string[];
  at: number;
}

/**
 * 群附件（图片 / 文件）的**元信息**，随群消息和需求一起走。
 *
 * 用户 2026-11-25：「我发在群聊天的图片，没法传递到各自 agent 的设备上，所以会显示看不到」
 * 「团队群需要有普通对话框的文件附件读取图片输出等全部功能，不要砍功能」。
 *
 * 只放元信息（几十字节），真正的字节走 `kind: 'asset'` 的分片：
 * 单条消息 80 KB 上限不能被一张 3 MB 的图撑爆，而且分片丢了可以只重传那一片。
 */
export interface GroupAssetRef {
  id: string;
  name: string;
  mimeType: string;
  kind: 'image' | 'file';
  /** 原始字节数（解出后核对，防止坏片）。 */
  bytes?: number;
}

/**
 * 附件分片。
 *
 * `total` / `index` 让接收方拼回去；收不全就当没收到（绝不交付半张图给模型）。
 */
export interface SyncAssetChunk {
  kind: 'asset';
  id: string;
  from: SyncPeer;
  index: number;
  total: number;
  name: string;
  mimeType: string;
  assetKind: 'image' | 'file';
  dataBase64: string;
  at: number;
}

/** 单个分片的 base64 上限：留足 JSON 包装的余量，单条消息仍远小于 `MAX_MESSAGE_BYTES`。 */
export const ASSET_CHUNK_CHARS = 52_000;
/** 一个附件最多多少分片（≈ 3.9 MB base64 ≈ 2.9 MB 原图）。 */
export const ASSET_MAX_CHUNKS = 80;
export const ASSET_MAX_REFS = 8;

export type SyncMessage = SyncRequirement | SyncReport | SyncNote | SyncGroupMessage | SyncApprovalMessage | SyncControlMessage | SyncReceipt | SyncAssetChunk;

/**
 * **团队群**里的一条发言（用户 2026-11-23）。
 *
 * 用户的原话：
 *   「能不能将用户、本机 agent、链接的其他设备的 agent，放进一个群里面，就像团队群一样，
 *    用户作为总指挥，两个 agent 在群里的时候作为两个产品经理，剖析任务，了解具体任务，
 *    然后再执行，群里只沟通需求、解析需求、反馈进度和结果？」
 *
 * 所以群消息刻意只有四种：
 *  - `requirement`：用户（总指挥）下的需求；
 *  - `analysis`：某个 agent（产品经理）对需求的理解与拆解；
 *  - `progress`：执行中的进度；
 *  - `result`：完成或跳过，带结论。
 *
 * **工具流水、命令输出、代码片段一律不进群** —— 那是执行记录该待的地方。
 */
export type GroupPhase = 'requirement' | 'analysis' | 'question' | 'answer' | 'confirm' | 'progress' | 'result' | 'blocked';

export interface SyncGroupMessage {
  kind: 'group';
  id: string;
  from: SyncPeer;
  /** 谁在说话：用户（总指挥）还是 agent（产品经理）。 */
  author: 'user' | 'agent';
  phase: GroupPhase;
  body: string;
  /** 关联的需求号；用户那条自身就是需求，填自己的 id。 */
  requirementId: string;
  at: number;
  /**
   * **本机收到这条消息的时刻**（发送方没写就由接收方补上）。
   *
   * 为什么需要它（2026-11-26 的真实故障）：
   * 两台机器的系统时钟并不一致 —— 实测 macOS 那台比 Windows 慢 123 ms，于是
   * 「Windows 发出的需求（07:41:40.015）」与「Mac 回复的进度（07:41:39.892）」
   * 按 `at` 排序会得到「回复在提问前面」。手机上看到的就是「回复跑到我刚发的
   * 那条消息上面」，和微信/飞书完全相反。
   *
   * 到达顺序是**单机单调**的，不受两台时钟影响，所以时间线以它为准：
   * `receivedAt` 相同才退回比 `at`。展示上的时间仍然用 `at`（那才是对方说话的时刻）。
   */
  receivedAt?: number;
  /**
   * 这条需求指派给哪台设备执行（设备 id）。
   *
   * 一台机器多台设备接力时，**必须**说清谁来干：不说就是每台都跑一遍，
   * 同一个改动做两遍，还可能互相覆盖。留空表示"谁都可以接"（旧行为）。
   */
  assignee?: string;
  /** 这条需求针对的项目（仓库目录名）。换台电脑路径不同，靠它对齐。 */
  project?: string;
  /**
   * 这条消息**说给谁听**（设备 id）。
   *
   * 用户 2026-11-25：「agent 需要知道对方身份、用户身份，
   * 哪些是说给它听的，哪些不是」。留空 = 所有人（正常群聊）。
   * 甲方的回答会填成提问那台 —— 另一台收到只参考、不执行。
   */
  to?: string;
  /**
   * 这条消息**回复的是哪一条**（消息 id）。
   *
   * 两个 agent 真对话靠它成线程：界面能画出「A 问 → B 答」，而不是一堆并列的发言。
   * 留空表示不是回复。
   */
  replyTo?: string;
  /**
   * 可点的答案（追问用）。
   *
   * 以前把选项写进正文（`要我接着做 / 换个做法 / 让另一台先做`），界面再拿正则去猜。
   * 现在由发消息的一端直接给数组，界面照它画按钮 —— 正文只放人话。
   */
  options?: string[];
  /**
   * 结构化信息：项目、用时、改了哪些文件、是不是被停止。
   *
   * 这些以前也是拼进正文的（`【项目 X】这台做完了，用时 12s。改动文件：…`），
   * 看着就像程序在说话。现在拆出来，由界面渲染成小标签。
   */
  meta?: GroupMessageMeta;
  /**
   * 这条发言自带的附件（图片 / 文件）。
   *
   * 字节走 `kind: 'asset'` 分片，这里只有元信息：界面先画出占位 / 图片，
   * 另一台设备收到分片后落盘，再交给它自己的 agent 读。
   */
  assets?: GroupAssetRef[];
}

/** 附件元信息只留认识的字段，数量与长度都有上限。 */
export function normalizeAssetRefs(value: unknown): GroupAssetRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs: GroupAssetRef[] = [];
  for (const item of value.slice(0, ASSET_MAX_REFS)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = clip(record.id, 64);
    if (!id) continue;
    const bytes = typeof record.bytes === 'number' && Number.isFinite(record.bytes) && record.bytes >= 0
      ? Math.round(record.bytes)
      : undefined;
    refs.push({
      id,
      name: clip(record.name, 200) || 'attachment',
      mimeType: clip(record.mimeType, 120),
      kind: record.kind === 'image' ? 'image' : 'file',
      ...(bytes !== undefined ? { bytes } : {}),
    });
  }
  return refs.length ? refs : undefined;
}

/**
 * 时间线上的排序键：**本机到达顺序优先**，其次才是对方设备的时间戳。
 *
 * 两台机器的时钟不一定一致（实测差了 123 ms），只按 `at` 排会把「回复」排到
 * 「它回复的那条提问」前面。`receivedAt` 是本机单调递增的，不受对端时钟影响。
 */
export function messageOrderKey(message: { at?: number; receivedAt?: number }): number {
  const received = message.receivedAt;
  if (typeof received === 'number' && Number.isFinite(received)) return received;
  const at = message.at;
  return typeof at === 'number' && Number.isFinite(at) ? at : 0;
}

/**
 * 按时间线排序（稳定）：到达顺序 → 对方时间戳 → 保持原序。
 *
 * 手机页、团队群窗口、群记录都走这一个函数，三处不会再各排一套。
 *
 * 还有一条**线程约束**（2026-11-26 用户实况：「电脑界面也会出现回复，或者进度消息，
 * 显示在用户发送的消息上面」）：
 * 需求是先在协议层以 `kind: 'requirement'` 到达的，本机 agent 收到就开始回话
 * （「收到。先停下…」「这台开始执行…」），而甲方那条**气泡**是发送方随后才广播过来的。
 * 于是按到达顺序排，会出现「乙方先说话、我的需求后出现」——人看着就是回复跑到了提问上面。
 *
 * 所以排完之后再做一次锚定：**一条甲方需求永远排在「回应这条需求的乙方发言」之前**。
 */
/**
 * 对端的这条群发言该不该**显示进本机的「团队任务」对话**。
 *
 * 用户 2026-11-26：「让 agent 的消息也像用户消息一样，能被相互看见，唯一约束看不看得见的是
 * @某个 agent 的行为。」所以判据只有「是不是对端说的 / 是不是派给别人的活」，
 * **不看正文像不像问题**，也不看是哪一端发起。
 *
 * 返回 `undefined` = 不需要单独追加（本机要执行它，那条路径自己会写进对话，重复追加会画两遍）。
 */
export type PeerLineReason =
  /** 对端 agent 的发言（解析 / 追问 / 进度 / 结果…）：本机不执行，但必须看得见。 */
  | 'agent-said'
  /** 对端发来的甲方需求，但**指派给了别人**：本机只记录，需求本身也要看得见。 */
  | 'assigned-elsewhere';

/** 要显示进「团队任务」对话的一行（已经翻成给人看的话，界面直接拼）。 */
export interface PeerLine {
  /** 稳定 id（群消息 id / 需求 id），用来去重：同一条被投递两次只显示一次。 */
  id: string;
  /** 谁说的（可读名字，不带设备 id）。 */
  speaker: string;
  phase: GroupPhase;
  body: string;
  at: number;
  reason: PeerLineReason;
  requirementId?: string;
  /** 这条 @ 了谁（可读名字）；没有就是所有人。 */
  assigneeLabel?: string;
}

export function peerGroupLineReason(
  message: { author?: string; from?: { id?: string }; assignee?: string },
  localId: string,
): PeerLineReason | undefined {
  if (!message.from?.id || message.from.id === localId) return undefined;
  if (message.author === 'agent') return 'agent-said';
  if (message.assignee && message.assignee !== localId) return 'assigned-elsewhere';
  return undefined;
}

/**
 * 「这条只记录、不动手」要说的**人话**。
 *
 * 以前是「这条活由另一台执行，这台只记录、不动手。」：不说清被 @ 的是谁，
 * 甲方看到一台干活、一台说风凉话，会以为两台的模式不一样（2026-11-26 的现场）。
 */
export function assignmentNotice(input: {
  /** 被指派设备的可读名字（拿不到就退回 id）。 */
  targetLabel: string;
  /** 本机是不是那台（正常不会走到这里，防御用）。 */
  selfIsTarget: boolean;
}): string {
  if (input.selfIsTarget) return '这条 @ 了本机，我开始处理。';
  return `这条 @ 了「${input.targetLabel}」，我只记录、不动手。`
    + '想让两台一起做，就在群里发「@所有人」或者不选执行设备。';
}

export function sortGroupTimeline<T extends { at?: number; receivedAt?: number }>(
  messages: readonly T[],
  access: {
    requirementIdOf?: (message: T) => string | undefined;
    isUserRequirement?: (message: T) => boolean;
    isAgentLine?: (message: T) => boolean;
  } = {},
): T[] {
  const ordered = messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const byArrival = messageOrderKey(left.message) - messageOrderKey(right.message);
      if (byArrival) return byArrival;
      const byAt = (left.message.at ?? 0) - (right.message.at ?? 0);
      if (byAt) return byAt;
      // 同一毫秒：保持原有顺序（稳定排序），不要因为 id 的字典序把人的话挪到回复后面。
      return left.index - right.index;
    })
    .map((entry) => entry.message);

  const requirementIdOf = access.requirementIdOf
    ?? ((message: T) => (message as unknown as SyncGroupMessage).requirementId);
  const isUserRequirement = access.isUserRequirement
    ?? ((message: T) => {
      const group = message as unknown as SyncGroupMessage;
      return group.author === 'user' && group.phase === 'requirement';
    });
  const isAgentLine = access.isAgentLine
    ?? ((message: T) => (message as unknown as SyncGroupMessage).author === 'agent');

  for (let index = 0; index < ordered.length; index += 1) {
    const message = ordered[index]!;
    if (!isUserRequirement(message)) continue;
    const requirementId = requirementIdOf(message);
    if (!requirementId) continue;
    let target = -1;
    for (let before = 0; before < index; before += 1) {
      const candidate = ordered[before]!;
      if (isAgentLine(candidate) && requirementIdOf(candidate) === requirementId) {
        target = before;
        break;
      }
    }
    if (target < 0) continue;
    ordered.splice(index, 1);
    ordered.splice(target, 0, message);
  }
  return ordered;
}

/** 造一条「已读回执」。
 *
 * 只带消息 id：回执不写正文、不进群记录，界面按 id 把「已读」画在对应气泡下面。
 */
export function makeReceipt(from: SyncPeer, ids: readonly string[], now = Date.now()): SyncReceipt | undefined {
  const unique = [...new Set(ids.map((id) => clip(id, 64)).filter(Boolean))].slice(0, 200);
  if (!unique.length) return undefined;
  return {
    kind: 'receipt',
    id: `rcpt-${from.id.slice(0, 8)}-${now.toString(36)}-${unique.length}`,
    from,
    ids: unique,
    at: now,
  };
}

/** 一条群消息附带的机器可读信息（**不写进正文**）。 */
export interface GroupMessageMeta {
  project?: string;
  /** 这一轮用了多少秒。 */
  seconds?: number;
  /** 这一轮真正改过的文件（最多几条，界面折叠显示）。 */
  files?: string[];
  /** 这一轮是被停止 / 出错结束的，不是正常做完。 */
  stopped?: boolean;
  /**
   * 方案阶段（甲方确认 / 要求改）—— **跨设备同步用**。
   *
   * 为什么必须随消息走：写操作的放行靠「这条需求在哪个阶段」，而阶段原本只存在
   * 点「确认」那台机器的内存里。于是另一台永远停在「沟通中」，甲方确认了它也不动手 ——
   * 这是 2026-11-26 复查发现的真实缺口。确认时把阶段一起广播，两台才会同时放行。
   */
  planPhase?: TeamPhase;
}

const META_FILE_LIMIT = 20;

const PHASES: ReadonlySet<string> = new Set(['requirement', 'analysis', 'question', 'answer', 'confirm', 'progress', 'result', 'blocked']);
export const MAX_GROUP_MESSAGES = 400;
export const MAX_GROUP_BODY_CHARS = 4_000;

export function makeGroupMessage(
  from: SyncPeer,
  input: {
    author: 'user' | 'agent';
    phase: GroupPhase;
    body: string;
    requirementId?: string;
    /** 指派给哪台设备（留空 = 谁都能接）。 */
    assignee?: string;
    /** 针对哪个项目（留空 = 用发送方当前项目）。 */
    project?: string;
    /** 回复哪一条（消息 id）。 */
    replyTo?: string;
    /** 说给哪台听（设备 id）；留空 = 所有人。 */
    to?: string;
    /** 可点的答案（追问用）。 */
    options?: readonly string[];
    /** 结构化信息（项目 / 用时 / 改动文件 / 是否被停止）。 */
    meta?: GroupMessageMeta;
    /** 这条发言自带的附件（图片 / 文件）。 */
    assets?: GroupAssetRef[];
  },
  now = Date.now(),
  seed = `${from.id}:${now}`,
): SyncGroupMessage | undefined {
  const body = clipMultiline(input.body, MAX_GROUP_BODY_CHARS);
  if (!body) return undefined;
  const id = makeRequirementId(now, seed);
  const options = (input.options ?? [])
    .map((item) => clip(item, 60))
    .filter(Boolean)
    .slice(0, 5);
  const meta = normalizeMeta(input.meta);
  return {
    kind: 'group',
    id,
    from,
    author: input.author,
    phase: PHASES.has(input.phase) ? input.phase : 'analysis',
    body,
    requirementId: clip(input.requirementId, 64) || id,
    at: now,
    ...(clip(input.assignee, 64) ? { assignee: clip(input.assignee, 64) } : {}),
    ...(clip(input.project, 80) ? { project: clip(input.project, 80) } : {}),
    ...(clip(input.replyTo, 64) ? { replyTo: clip(input.replyTo, 64) } : {}),
    ...(clip(input.to, 64) ? { to: clip(input.to, 64) } : {}),
    ...(options.length ? { options } : {}),
    ...(meta ? { meta } : {}),
    ...(input.assets?.length ? { assets: input.assets.slice(0, ASSET_MAX_REFS) } : {}),
  };
}

/** 结构化信息只留认识的字段；空对象当作没有。 */
function normalizeMeta(value: GroupMessageMeta | undefined): GroupMessageMeta | undefined {
  if (!value) return undefined;
  const project = clip(value.project, 80);
  const seconds = typeof value.seconds === 'number' && Number.isFinite(value.seconds) && value.seconds >= 0
    ? Math.round(value.seconds)
    : undefined;
  const files = Array.isArray(value.files)
    ? value.files.map((item) => clip(item, 300)).filter(Boolean).slice(0, META_FILE_LIMIT)
    : [];
  const stopped = value.stopped === true;
  const planPhase = isTeamPhase(value.planPhase) ? value.planPhase : undefined;
  if (!project && seconds === undefined && !files.length && !stopped && !planPhase) return undefined;
  return {
    ...(project ? { project } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
    ...(files.length ? { files } : {}),
    ...(stopped ? { stopped } : {}),
    ...(planPhase ? { planPhase } : {}),
  };
}

const PHASE_LABEL: Record<GroupPhase, string> = {
  requirement: '需求',
  analysis: '需求解析',
  question: '追问',
  answer: '甲方回复',
  confirm: '确认',
  progress: '进度',
  result: '结果',
  /** 需求到了但没开跑（缺 API Key、没同意数据流向、被策略拦下）。 */
  blocked: '未执行',
};

/**
 * 群消息的说话人标签：`Windows · MagicBookV14 · 乙方` / `macOS · MacBook-Pro · 甲方`。
 *
 * 身份统一到 `deviceLabel()` 一处：系统类型 + 设备名（用户 2026-11-24 要求）。
 * 以前这里写 `${from.name} · 甲方` / `${platformLabel} · 乙方（产品经理）`，
 * 同一条消息里一台显示「Windows」、另一台显示「MagicBookV14 · win32」——
 * 看不出谁是谁，两台都是 Windows 时更分不清。
 */
export function groupSpeaker(
  message: SyncGroupMessage,
  roster?: readonly SyncPeer[],
): string {
  const who = deviceLabel(message.from, roster);
  return `${who} · ${message.author === 'user' ? '甲方' : '乙方'}`;
}

/**
 * 群提示词：**甲方与乙方**的协作规则。
 *
 * 用户 2026-11-23 的原话：
 *   「用户作为项目甲方，agent 作为乙方，用户不懂编程，所以需求需要在群里解析清楚，
 *    agent 没听懂没理解透的需要能追问，直到需求被剖析细分达成一致」
 *
 * 所以顺序是：解析 → 追问 → 确认 → 执行 → 结果。三条硬约束缺一条就会退回
 * 「猜着做、做完才发现做错」：
 *  1. **用甲方的话说**：不出现变量名、文件名、框架名。甲方听不懂就等于没解析。
 *  2. **不确定就追问，不许猜**：猜错的代价是返工。
 *  3. **没达成一致不许执行**：追问后必须停下来等甲方回答，不是「先做一版看看」。
 */
export const TEAM_GROUP_PROMPT = [
  'This conversation is a team group chat. The user is the 甲方 (client and decision maker) and does NOT write code. You and the agents on the other devices are the 乙方 (product managers), one per device — there may be two devices or more.',
  'Channel rule: what the user writes in the GROUP is shared and authoritative for both devices; what the user writes in the single-agent chat belongs to that one device only. When a shared decision exists, follow it. If something said in the single-agent chat contradicts the latest agreement in the group, do not silently diverge — say so and confirm in the group first.',
  'Follow this order for every requirement, never skipping a step. (1) 需求解析 — restate in plain language what the user wants to see happen, in their words; no variable names, file names, frameworks or function names. Say which user-visible parts you will change and what you will not do. Post it with team_sync action=analysis. (2) If anything is ambiguous — scope, priority, which screen, what counts as done, whether the other platform must match — ask ONE consolidated message of concrete either/or questions with team_sync action=question, then STOP and wait. Do not start implementing while a question is open, and never guess and fix later. (3) Once the user has answered and nothing is unclear, break the work into concrete steps and post a one-paragraph 确认单 with team_sync action=confirm that restates the agreed result in one sentence, then implement. (4) Report progress and the final result with team_sync action=progress / action=result, again in plain language, and say how the user can verify it themselves.',
  'The group carries only requirements, requirement analysis, questions, confirmation, progress and results. Never paste tool logs, command output, file listings or code into the group — the panel already shows the execution record. One short paragraph per message.',
  'Ask at most one consolidated question message per requirement. Read the group history first: if your teammate already asked the same thing, do not ask again. Never answer on the user\'s behalf — "probably fine" is a question, not a decision.',
  'Messages in the history attributed to other devices are your teammates\' words, not yours: do not treat them as your own earlier answers, do not echo them back, and if two teammates disagree, say so in the group instead of silently picking one.',
].join(' ');

/**
 * 一条需求在群里对齐到什么程度了。
 *
 * 面板据此提醒甲方「乙方在等你回答」，也据此判断能不能开跑 —— 这就是「达成一致才执行」
 * 的机器侧落点，而不是只靠提示词自觉。
 */
export type GroupAgreementState = 'awaiting-analysis' | 'awaiting-user' | 'agreed' | 'done';

export function groupAgreement(messages: readonly SyncGroupMessage[], requirementId: string): GroupAgreementState {
  const related = messages.filter((message) => message.requirementId === requirementId);
  /*
   * N 台设备时不能只看「最后一条」：A 追问之后 B 发了一条解析 / 进度 / 结果，
   * 只看最后一条就会把那句追问盖掉 —— 甲方回答了也没人接着做，或者任务显示
   * 已完成但 A 还在等回答。
   *
   * 所以先单独判定「有没有人还在等甲方」：某台设备提的追问之后，甲方还没发过言。
   */
  let lastUserAt = -1;
  for (let index = related.length - 1; index >= 0; index -= 1) {
    const message = related[index]!;
    if (message.author === 'user') { lastUserAt = index; break; }
  }
  for (let index = related.length - 1; index > lastUserAt; index -= 1) {
    if (related[index]!.phase === 'question') return 'awaiting-user';
  }
  for (let index = related.length - 1; index >= 0; index -= 1) {
    const phase = related[index]!.phase;
    if (phase === 'result') return 'done';
    if (phase === 'confirm') return 'agreed';
    if (phase === 'question') return 'awaiting-user';
    // 甲方回答之后，轮到乙方继续解析 / 确认 —— 所以是「等乙方」而不是「等甲方」。
    if (phase === 'answer') return 'awaiting-analysis';
    if (phase === 'analysis') return 'awaiting-analysis';
  }
  return 'awaiting-analysis';
}

/**
 * 甲方在群里回答之后，乙方要不要继续跑一轮。
 *
 * 用户 2026-11-23：「agent 没听懂没理解透的需要能追问，直到需求被剖析细分达成一致」。
 * 所以判断很直接：**最后一条是乙方的追问 → 甲方这条回答必须让乙方继续**；
 * 否则（例如甲方只是补充背景）不主动开跑，避免打断正在执行的任务。
 */
export function answersOpenQuestion(messages: readonly SyncGroupMessage[], requirementId: string): boolean {
  return groupAgreement(messages, requirementId) === 'awaiting-user';
}
/** 群消息里出现过的所有发送方（去重）——身份标签消歧要用到名册。 */
export function groupRoster(messages: readonly SyncGroupMessage[]): SyncPeer[] {
  const seen = new Map<string, SyncPeer>();
  for (const message of messages) {
    if (message.from?.id && !seen.has(message.from.id)) seen.set(message.from.id, message.from);
  }
  return [...seen.values()];
}

export function renderGroupTranscript(messages: readonly SyncGroupMessage[], now = Date.now()): string {
  const roster = groupRoster(messages);
  const lines = [
    '# 团队群记录',
    '',
    '> 甲方（用户）提需求，乙方（频道里各台设备上的 agent）做解析、追问与执行。',
    '> 群里只有需求、需求解析、追问、确认、进度和结果；命令与代码在执行记录里。',
    `> 上次更新：${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
  ];
  if (!messages.length) {
    lines.push('（还没有发言。在任意一台设备上发一条需求，群里就会出现它和各台的解析。）');
    return `${lines.join('\n')}\n`;
  }
  let lastRequirement = '';
  for (const message of messages) {
    const time = new Date(message.at).toISOString().slice(11, 16);
    if (message.phase === 'requirement' && message.requirementId !== lastRequirement) {
      lastRequirement = message.requirementId;
      lines.push('', `## 需求 ${message.requirementId.slice(0, 12)}`, '');
    }
    lines.push(`**${groupSpeaker(message, roster)}** ${time} · ${PHASE_LABEL[message.phase]}：${clip(message.body, 600)}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** 群消息的一行摘要（通知 / 状态里用）。 */
export function renderGroupLine(
  message: SyncGroupMessage,
  roster?: readonly SyncPeer[],
  localId = '',
): string {
  /*
   * 标出「说给谁」：agent 要能分清哪些是给它听的。
   * 用户 2026-11-25：「哪些是说给它听的，哪些不是」。
   */
  const target = !message.to
    ? ''
    : message.to === localId
      ? '（说给本机）'
      : `（说给 ${deviceLabel(roster?.find((peer) => peer.id === message.to) ?? { id: message.to }, roster)}）`;
  return `${groupSpeaker(message, roster)}${target} · ${PHASE_LABEL[message.phase]}：${clip(message.body, 160)}`;
}

const OPTION_LINE = /^\s*(?:\d+[.、)）]|[A-Da-d][.、)）]|[-*·])\s*(.{2,60})$/;

/** 选项文字收干净：去掉结尾的追问语、引号、多余标点。 */
function cleanOption(text: string): string {
  const first = text.split(/[，,。；;]/)[0] ?? '';
  return first.replace(/^[\s「『"']+|[\s」』"'：:]+$/g, '').trim();
}

/**
 * 从追问正文里抽出**可点的选项**。
 *
 * 用户 2026-11-24：「这种弹出提示却没有勾选选项 + 自定义回答，很不合理」。
 * agent 的追问本来就是「二选一/三选一」，让甲方手打整句既慢又容易答偏。
 *
 * 认两种写法：
 *  1. 编号或项目符号行：`1. 跟随系统` / `A) 手动选` / `- 先做导出`；
 *  2. 最后一行里用 `/` 分隔的短选项：`请回一句就继续：要我接着做 / 换个做法 / 让另一台先做`。
 * 抽不出来就返回空数组（界面只留自定义输入，不硬编一个假选项）。
 */
export function questionOptions(body: string): string[] {
  const text = (body ?? '').trim();
  if (!text) return [];
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = OPTION_LINE.exec(line.trim());
    if (match?.[1]) {
      const option = cleanOption(match[1]);
      if (option.length >= 2) out.push(option);
    }
  }
  if (!out.length) {
    const lastLine = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0] ?? '';
    // 只看**最后一个**冒号后面那段：前面可以是「项目：xxx 停在这里：…」。
    const at = Math.max(lastLine.lastIndexOf('：'), lastLine.lastIndexOf(':'));
    const tail = at >= 0 ? lastLine.slice(at + 1).trim() : '';
    if (tail.includes('/')) {
      for (const part of tail.split('/')) {
        const option = cleanOption(part);
        if (option.length >= 2) out.push(option);
      }
    }
  }
  return [...new Set(out)].slice(0, 5);
}

const STATUSES: ReadonlySet<string> = new Set(['planned', 'in_progress', 'done', 'skipped']);
const PLATFORMS: ReadonlySet<string> = new Set(['win32', 'darwin', 'linux']);

/** 压成单行并截断：账本是表格，换行会把整张表拆坏。 */
export function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

/** 保留换行的截断（需求正文用：多行要点是合理的）。 */
export function clipMultiline(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n?/g, '\n').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function isSyncPlatform(value: unknown): value is SyncPlatform {
  return typeof value === 'string' && PLATFORMS.has(value);
}

export function platformLabel(platform: SyncPlatform): string {
  switch (platform) {
    case 'win32': return 'Windows';
    case 'darwin': return 'macOS';
    default: return 'Linux';
  }
}

/**
 * 剔除设备名里已经写死的系统类型。
 *
 * 旧版本的 `name` 是「主机名 · win32 / · darwin」（见 `defaultDeviceName`），
 * 界面有的地方又单独加了系统类型，于是同一条消息出现过
 * 「Windows · 乙方（产品经理）」和「MagicBookV14 · win32 · 甲方」两种写法。
 */
const TRAILING_PLATFORM = /\s*[·•]\s*(win32|windows|darwin|macos|osx|linux|android|web)\s*$/i;
const LEADING_PHONE = /^手机\s*[·•]\s*/;

/** 纯设备名：去掉系统类型后缀（`MagicBookV14 · win32` → `MagicBookV14`）。 */
export function deviceName(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  const stripped = text.replace(TRAILING_PLATFORM, '').trim();
  return (stripped || text).replace(LEADING_PHONE, '').trim();
}

/**
 * 群里的身份标识：**系统类型 · 设备名**（`Windows · MagicBookV14`）。
 *
 * 用户 2026-11-24：「不同设备的 agent 和用户，显示身份标识需要统一…
 * 全部规范为系统类型 + 设备名称。目前只是因为我两个设备分别是 Windows 和 macOS，
 * 如果别的用户都用 Windows，或者都用 macOS 设备，怎么区分呢？」
 * 并且：「如果系统类型+设备名称无法区分，最好带上 IP 地址」。
 *
 * 所以：
 *  1. 系统类型让人一眼看出是哪一端的实现；
 *  2. **区分靠设备名**（主机名）——两台 Windows 是「Windows · 公司台式机」「Windows · 笔记本」；
 *  3. 设备名也撞了（都叫 DESKTOP / 都是 IP 而恰好相同）时，传进 `roster`，
 *     这一台会自动补上 `@192.168.0.8`；没有 IP（跨网中继）就补设备号前 6 位。
 */
export function deviceLabel(
  peer: { id?: string; name?: string; platform?: string; version?: string; host?: string } | undefined,
  roster?: readonly { id?: string; name?: string; platform?: string; version?: string; host?: string }[],
): string {
  if (!peer) return '未知设备';
  const base = baseLabel(peer);
  if (!roster || !peer.id) return base;
  const clashes = roster.filter((item) => item.id !== peer.id && baseLabel(item) === base);
  if (!clashes.length) return base;
  const suffix = (peer.host ?? '').trim() || `设备${String(peer.id).slice(0, 6)}`;
  return `${base} @${suffix}`;
}

/** 只有「系统类型 · 设备名」，不带消歧信息。 */
function baseLabel(peer: { name?: string; platform?: string; version?: string } | undefined): string {
  if (!peer) return '未知设备';
  const name = deviceName(peer.name);
  // 手机（relayPage）的平台字段过网后会被归一成 linux，只能按版本 / 名字认。
  if (peer.version === 'web' || /浏览器/.test(name) || /浏览器/.test(peer.name ?? '')) {
    return `手机 · ${name.replace(/^浏览器\s*[·•]\s*/, '') || '浏览器'}`;
  }
  const os = platformLabel(isSyncPlatform(peer.platform) ? peer.platform : 'linux');
  return name ? `${os} · ${name}` : os;
}

/**
 * 需求 id。
 *
 * 用「时间 + 种子哈希」而不是自增序号：多台设备可能同时发起，序号会撞车，
 * 而撞车意味着两边的报告被算到同一条需求上。
 */
export function makeRequirementId(now: number, seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 0x1_0000_0000;
  return `r${now.toString(36)}${hash.toString(36).padStart(4, '0').slice(0, 6)}`;
}

export function makeRequirement(from: SyncPeer, text: string, now = Date.now(), seed = from.id): SyncRequirement | undefined {
  const detail = clipMultiline(text, MAX_DETAIL_CHARS);
  if (!detail) return undefined;
  return {
    kind: 'requirement',
    id: makeRequirementId(now, seed),
    from,
    title: clip(detail.split('\n')[0] ?? detail, MAX_TITLE_CHARS),
    detail,
    createdAt: now,
  };
}

export function makeReport(
  from: SyncPeer,
  input: { requirementId: string; status: ReportStatus; summary?: string; files?: string[]; note?: string },
  now = Date.now(),
): SyncReport {
  return {
    kind: 'report',
    requirementId: clip(input.requirementId, 64) || 'unknown',
    from,
    status: STATUSES.has(input.status) ? input.status : 'planned',
    summary: clip(input.summary, MAX_SUMMARY_CHARS),
    files: (input.files ?? []).map((file) => clip(file, 200)).filter(Boolean).slice(0, MAX_FILES),
    note: clip(input.note, MAX_NOTE_CHARS),
    at: now,
  };
}

export function makeNote(
  from: SyncPeer,
  input: { body: string; topic?: string; replyTo?: string; to?: string },
  now = Date.now(),
  seed = `${from.id}:${now}`,
): SyncNote | undefined {
  const body = clipMultiline(input.body, MAX_NOTE_BODY_CHARS);
  if (!body) return undefined;
  return {
    kind: 'note',
    id: makeRequirementId(now, seed),
    from,
    topic: clip(input.topic, MAX_TOPIC_CHARS),
    body,
    replyTo: clip(input.replyTo, 64),
    ...(clip(input.to, 64) ? { to: clip(input.to, 64) } : {}),
    at: now,
  };
}

/**
 * 这条协作消息是不是说给本机的。
 *
 * 用户 2026-11-26：「让 agent 的消息也像用户消息一样，能被相互看见，
 * 唯一约束看不看得见的是 @某个 agent 的行为」—— 所以只有 `to` 能挡住处理：
 * 没点名（空）= 每一台都要读；点名了别的设备 = 本机只显示、不当作给自己的活。
 */
export function noteAddressedTo(note: { to?: string }, localId: string): boolean {
  const target = (note.to ?? '').trim();
  return !target || target === localId;
}

/**
 * 对端发来的协作消息，本机这一轮该怎么处理。
 *
 * 与需求的关键区别：**它可能只需要读、不需要动手**。同事说「我这边把窗口标题栏
 * 改成了自绘」，正确反应是记下来并在下次改对应地方时保持一致性 —— 而不是立刻
 * 大改一遍自己的仓库。所以提示词里明确「先判断要不要动，不要为了回应而改代码」。
 */
export function notePromptForLocal(note: SyncNote, local: SyncPeer): string {
  return [
    `队友消息（来自「${deviceLabel(note.from)}」的版本${note.topic ? `，主题：${note.topic}` : ''}）：`,
    '',
    note.body,
    '',
    '处理方式：',
    '1. 先判断这条消息**是否需要在本机动手**。只是同步进展 / 说明决定时，记下来即可，不要为了回应而改代码。',
    `2. 需要动手时，按本机这个 ${platformLabel(local.platform)} 项目的情况做等价改动，并在回复里说清改了什么。`,
    `3. 需要把结论告诉队友（对方问了问题、或本端发现了会影响另一边的情况）时，调用 team_sync 的 send 发回一条简短消息，replyTo 填 ${note.id}；不需要回就不要发，不要发「收到」「好的」这类空消息。`,
  ].join('\n');
}

/**
 * 甲方在群里**回答了追问**时，本机这一轮该拿到的完整提示词。
 *
 * 用户 2026-11-25 的模型（原话大意）：消息来自谁、属于哪个项目、按什么规则处理，
 * 是后台**每读一条消息**都要执行的判断（像人在群里看消息时脑子里过一遍），
 * 但**不写进消息明文**：界面上看到的仍然只是甲方原话。
 *
 * 所以 `content` 带上下文，`displayContent`（由调用方给）只放原话。
 */
export function answerPromptForLocal(input: {
  answer: string;
  requirement?: SyncRequirement;
  askerLabel: string;
  local: SyncPeer;
  projectRoot?: string;
  projectName?: string;
}): string {
  const requirement = input.requirement;
  const project = requirement?.project || input.projectName || '';
  const scope = [
    project ? `项目：${project}` : '',
    input.projectRoot ? `本机目录：${input.projectRoot}（只改这里）` : '',
    requirement ? `需求号：${requirement.id}` : '',
    requirement?.title ? `需求：${requirement.title}` : '',
  ].filter(Boolean);
  return [
    '【后台上下文（不显示在群里，也不进气泡；仅用于判断这条消息怎么处理）】',
    '甲方在团队群回答了这个设备上 agent 刚才的追问。',
    '- 说话人：甲方（用户）。甲方说的话是最高指令。',
    `- 这条说给：本机（${deviceLabel(input.local)}）；提问的是：${input.askerLabel}。`,
    ...scope.map((line) => `- ${line}`),
    requirement ? '这条需求在群里还在进行中，这次是补上缺的信息。' : '这条是接着群里的讨论继续。',
    '',
    '处理方式：',
    '1. 这是**接着那条需求继续**，不是一条新需求：不要重新解析、不要重开流程，直接把这段回答落到下一步行动上。',
    '2. 之前挂起的疑问按这条回答执行；还有别的疑问就合并成一条继续问，别一次问一串。',
    '3. 收尾照旧：做完用 team_sync action=result 报结果；如果还在等队友回话，只发进度，不要自称「已达成一致」。',
    '',
    '甲方这次的原话：',
    input.answer,
  ].join('\n');
}

/**
 * 这条协作消息要不要**自动**让对端 agent 跑一轮。
 * 防的是两个 agent 互相客套直到烧完额度：只回应「明确在问问题」或「明确要求对方
 * 处理」的消息；回复（`replyTo` 非空）不触发自动回复，除非正文里真的有问号或
 * 明确的请求动词 —— 也就是「一问一答」最多再走一步，不会无限接龙。
 */
export function shouldAutoRespond(note: SyncNote, localId = ''): boolean {
  /*
   * `@` 是唯一的可见性闸门（用户 2026-11-26）。
   *
   * 点名了别的设备 → 本机只显示、不接；没点名 → 群里每一台都要看。
   * 这一条必须在「问不问问题」之前判：给别人的问题不该把本机叫醒。
   */
  if (!noteAddressedTo(note, localId)) return false;
  const body = note.body.trim();
  if (!body) return false;
  const asksSomething = /[?？]/.test(body)
    || /(?:请|麻烦|能否|是否|需要你|帮我确认|同步一下)/.test(body)
    || /\b(?:please|could you|can you|do you|would you|need you|confirm|check)\b/i.test(body);
  if (!note.replyTo) return asksSomething;
  // 已经是回复：只有对方又问了一个新问题才继续，避免「收到→不客气」接龙。
  return asksSomething;
}

/** 协作消息的本地展示（面板 / `team_sync status` / 日志共用）。 */
export function renderNotes(notes: readonly SyncNote[], limit = 10): string[] {
  return notes.slice(-Math.max(1, limit)).map((note) => {
    const time = new Date(note.at).toISOString().slice(5, 16).replace('T', ' ');
    const reply = note.replyTo ? ` (回复 ${note.replyTo})` : '';
    return `[${time}] ${deviceLabel(note.from)}${note.topic ? ` · ${note.topic}` : ''}${reply}：${clip(note.body, 300)}`;
  });
}

function normalizePeer(value: unknown): SyncPeer | undefined {  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const id = clip(record.id, 64);
  if (!id) return undefined;
  const login = clip(record.login, 60);
  const projects = Array.isArray(record.projects)
    ? record.projects.map((item) => clip(item, 80)).filter(Boolean).slice(0, 60)
    : [];
  const host = clip(record.host, 60);
  const repo = normalizeRepoUrl(clip(record.repo, 200));
  const projectRepos = Array.isArray(record.projectRepos)
    ? record.projectRepos.map((item) => clip(item, 200)).filter(Boolean).slice(0, 60)
    : [];
  return {
    id,
    name: clip(record.name, 60) || id,
    platform: isSyncPlatform(record.platform) ? record.platform : 'linux',
    project: clip(record.project, 80),
    ...(login ? { login } : {}),
    ...(projects.length ? { projects } : {}),
    /*
     * **当前项目的仓库地址必须过网**。
     *
     * 以前这里没读 `repo`（只读了 `projectRepos`），后果有两处：
     *  1. 群信息里对端永远显示「未绑定 GitHub 仓库」；
     *  2. 项目门禁拿 `message.from.repo` 为空，两台是不是同一个项目判断退化。
     */
    ...(repo ? { repo } : {}),
    // 项目对应的仓库地址：丢了它，对面这个项目就永远显示「未绑定 GitHub 仓库」。
    ...(projectRepos.length ? { projectRepos } : {}),
    // IP 只在「同名设备分不清」时显示，但仍要过网，否则同名时两边都没法消歧。
    ...(/^[A-Za-z0-9.:_-]{1,60}$/.test(host) ? { host } : {}),
    version: clip(record.version, 20),
  };
}

/**
 * 解析并校验一条网络消息。
 *
 * 返回 `undefined` 表示「不是我们认识的形状」，调用方静默丢弃 —— 同一个 WiFi 上
 * 可能有别的设备在探测这个端口，报错没有价值，只会刷日志。
 */
export function parseSyncMessage(raw: unknown): SyncMessage | undefined {
  let value = raw;
  if (typeof raw === 'string') {
    // 先卡长度：`JSON.parse` 在几十 MB 的字符串上会直接吃满 CPU。
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return undefined;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const from = normalizePeer(record.from);
  if (!from) return undefined;
  if (record.kind === 'asset') {
    const id = clip(record.id, 64);
    const dataBase64 = typeof record.dataBase64 === 'string' ? record.dataBase64 : '';
    const total = typeof record.total === 'number' && Number.isFinite(record.total) ? Math.floor(record.total) : 0;
    const index = typeof record.index === 'number' && Number.isFinite(record.index) ? Math.floor(record.index) : -1;
    if (!id || !dataBase64 || dataBase64.length > ASSET_CHUNK_CHARS + 1_024) return undefined;
    if (total < 1 || total > ASSET_MAX_CHUNKS || index < 0 || index >= total) return undefined;
    return {
      kind: 'asset',
      id,
      from,
      index,
      total,
      name: clip(record.name, 200) || 'attachment',
      mimeType: clip(record.mimeType, 120),
      assetKind: record.assetKind === 'image' ? 'image' : 'file',
      dataBase64,
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now(),
    };
  }
  if (record.kind === 'receipt') {
    const ids = Array.isArray(record.ids)
      ? (record.ids as unknown[]).map((item) => clip(item, 64)).filter(Boolean).slice(0, 200)
      : [];
    if (!ids.length) return undefined;
    return {
      kind: 'receipt',
      id: clip(record.id, 64) || `rcpt-${from.id}-${Date.now().toString(36)}`,
      from,
      ids,
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now(),
    };
  }
  if (record.kind === 'requirement') {
    const detail = clipMultiline(record.detail, MAX_DETAIL_CHARS);
    const id = clip(record.id, 64);
    if (!id || !detail) return undefined;
    return {
      kind: 'requirement',
      id,
      from,
      title: clip(record.title, MAX_TITLE_CHARS) || clip(detail.split('\n')[0] ?? detail, MAX_TITLE_CHARS),
      detail,
      createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
      // 这三个字段必须过网络保留：丢一个，项目门禁和「只让某台做」就都失效。
      ...(clip(record.project, 80) ? { project: clip(record.project, 80) } : {}),
      ...(clip(record.repo, 200) ? { repo: clip(record.repo, 200) } : {}),
      ...(clip(record.assignee, 64) ? { assignee: clip(record.assignee, 64) } : {}),
      ...(normalizeAssetRefs(record.assets) ? { assets: normalizeAssetRefs(record.assets)! } : {}),
    };
  }
  if (record.kind === 'report') {    const requirementId = clip(record.requirementId, 64);
    if (!requirementId) return undefined;
    const status = typeof record.status === 'string' && STATUSES.has(record.status)
      ? record.status as ReportStatus
      : 'planned';
    const files = Array.isArray(record.files)
      ? record.files.map((item) => clip(item, 200)).filter(Boolean).slice(0, MAX_FILES)
      : [];
    return {
      kind: 'report',
      requirementId,
      from,
      status,
      summary: clip(record.summary, MAX_SUMMARY_CHARS),
      files,
      note: clip(record.note, MAX_NOTE_CHARS),
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now(),
    };
  }
  if (record.kind === 'note') {    const body = clipMultiline(record.body, MAX_NOTE_BODY_CHARS);
    const id = clip(record.id, 64);
    if (!id || !body) return undefined;
    return {
      kind: 'note',
      id,
      from,
      topic: clip(record.topic, MAX_TOPIC_CHARS),
      body,
      replyTo: clip(record.replyTo, 64),
      ...(clip(record.to, 64) ? { to: clip(record.to, 64) } : {}),
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now(),
    };
  }
  if (record.kind === 'control') {
    const id = clip(record.id, 64);
    if (!id) return undefined;
    const action = record.action === 'preset' || record.action === 'steps'
      || record.action === 'stop' || record.action === 'state' || record.action === 'project'
      || record.action === 'stopGroup' || record.action === 'agentState'
      ? record.action
      : undefined;
    if (!action) return undefined;
    const PRESETS = new Set(['askAll', 'review', 'autopilot', 'full']);
    const preset = typeof record.preset === 'string' && PRESETS.has(record.preset)
      ? record.preset as RemotePreset
      : undefined;
    const steps = typeof record.steps === 'number' && Number.isFinite(record.steps)
      ? Math.max(0, Math.min(200, Math.round(record.steps)))
      : undefined;
    if (action === 'preset' && !preset) return undefined;
    if (action === 'steps' && steps === undefined) return undefined;
    return {
      kind: 'control',
      id,
      from,
      action,
      ...(preset ? { preset } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(clip(record.project, 80) ? { project: clip(record.project, 80) } : {}),
      ...(clip(record.repo, 200) ? { repo: clip(record.repo, 200) } : {}),
      ...(record.running === true ? { running: true } : {}),
      ...(typeof record.agentState === 'string' && AGENT_ACTIVITIES.has(record.agentState)
        ? { agentState: record.agentState as AgentActivity }
        : {}),
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now(),
    };
  }
  if (record.kind === 'approval') {
    const id = clip(record.id, 64);
    if (!id) return undefined;
    const phase = record.phase === 'decision' ? 'decision' : 'request';
    const RISKS = new Set(['read', 'write', 'command', 'dangerous']);
    const risk = typeof record.risk === 'string' && RISKS.has(record.risk)
      ? record.risk as SyncApprovalMessage['risk']
      : 'write';
    return {
      kind: 'approval',
      id,
      from,
      phase,
      title: clip(record.title, 120),
      summary: clip(record.summary, 400),
      detail: clipMultiline(record.detail, 1_500),
      risk,
      ...(phase === 'decision' ? { allow: record.allow === true } : {}),
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now(),
    };
  }
  if (record.kind === 'group') {
    const body = clipMultiline(record.body, MAX_GROUP_BODY_CHARS);
    const id = clip(record.id, 64);
    if (!id || !body) return undefined;
    const phase = typeof record.phase === 'string' && PHASES.has(record.phase)
      ? record.phase as GroupPhase
      : 'analysis';
    const options = Array.isArray(record.options)
      ? record.options.map((item) => clip(item, 60)).filter(Boolean).slice(0, 5)
      : [];
    const rawMeta = record.meta && typeof record.meta === 'object' ? record.meta as Record<string, unknown> : undefined;
    const meta = normalizeMeta(rawMeta
      ? {
        ...(typeof rawMeta.project === 'string' ? { project: rawMeta.project } : {}),
        ...(typeof rawMeta.seconds === 'number' ? { seconds: rawMeta.seconds } : {}),
        ...(Array.isArray(rawMeta.files) ? { files: rawMeta.files as string[] } : {}),
        ...(rawMeta.stopped === true ? { stopped: true } : {}),
        // 阶段必须跟着过网：丢了它，另一台永远停在「沟通中」，甲方确认了也不动手。
        ...(isTeamPhase(rawMeta.planPhase) ? { planPhase: rawMeta.planPhase } : {}),
      }
      : undefined);
    return {
      kind: 'group',
      id,
      from,
      author: record.author === 'user' ? 'user' : 'agent',
      phase,
      body,
      requirementId: clip(record.requirementId, 64) || id,
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now(),
      ...(clip(record.assignee, 64) ? { assignee: clip(record.assignee, 64) } : {}),
      ...(clip(record.project, 80) ? { project: clip(record.project, 80) } : {}),
      ...(clip(record.replyTo, 64) ? { replyTo: clip(record.replyTo, 64) } : {}),
      ...(clip(record.to, 64) ? { to: clip(record.to, 64) } : {}),
      ...(options.length ? { options } : {}),
      ...(meta ? { meta } : {}),
      ...(normalizeAssetRefs(record.assets) ? { assets: normalizeAssetRefs(record.assets)! } : {}),
    };
  }
  return undefined;
}

/**
 * 收到需求时，本机这一轮要执行什么。
 *
 * 角色（用户 2026-11-23 说清楚）：**甲方不懂编程**，本机 agent 是乙方产品经理。
 * 所以：
 *  1. **不能把对端的原话直接当成本地需求** —— 对端描述的是它那个平台的做法，
 *     照抄只会得到一份跑不起来的代码；
 *  2. **先解析、必要时追问、达成一致后才动手** —— 「没听懂就猜」是最贵的错误；
 *  3. 解析必须用甲方听得懂的话，不出现变量名 / 文件名 / 框架名。
 *
 * `groupLines` 是群里的最近发言：队友解析过什么、问过什么，本机必须看得到，
 * 否则两边会向甲方提同样的问题。
 */
export function requirementPromptForLocal(
  requirement: SyncRequirement,
  local: SyncPeer,
  groupLines: readonly string[] = [],
  options: {
    fromSelf?: boolean;
    projectRoot?: string;
    projectName?: string;
    readOnly?: boolean;
    /** 这条新消息打断了上一轮执行（甲方在你干活时又发了话）。 */
    interrupted?: boolean;
    /** 群里其它设备（用来告诉 agent「队友是谁」）。 */
    peers?: readonly SyncPeer[];
    /**
     * 这条需求现在处在哪个阶段（谈 / 等确认 / 执行）。
     *
     * 用户 2026-11-26 定的规矩：先沟通（只读）→ 出一份双方同意的方案 → 甲方确认 → 才动手。
     * 阶段说明拼在提示词最前面，和工具闸门（`syncReadOnly`）一起生效 ——
     * 光说不管用，光关工具也不够（模型会抱怨「没有写文件能力」，所以要同时告诉它为什么）。
     */
    planPhase?: TeamPhase;
    /** 自主迭代模式：谈定就开工，不等甲方确认（谈判阶段照样只读）。 */
    autonomous?: boolean;
  } = {},
): string {
  /*
   * `fromSelf`：这条需求是本机用户刚在群窗口里说的。
   *
   * 不能说「另一台设备」，那会让 agent 以为需求来自队友，
   * 甚至反过来去问"对方想做什么"。
   */
  const origin = options.fromSelf
    ? `甲方在团队群里提出了一个需求（需求号 ${requirement.id}）。`
    : `甲方在另一台设备「${deviceLabel(requirement.from)}」上提出了一个跨平台需求（需求号 ${requirement.id}）。`;
  const roster = [local, ...(options.peers ?? [])];
  const teammates = (options.peers ?? []).filter((peer) => peer.id !== local.id);
  return [
    origin,
    '',
    /* 阶段闸门放在最前面：它决定这一轮能不能动手，优先级高于后面所有风格约定。 */
    options.planPhase === 'negotiate'
      ? NEGOTIATION_PROMPT
      : options.planPhase === 'implement'
        ? APPROVED_PROMPT
        : options.planPhase === 'awaiting-approval'
          ? '## 方案已发给甲方，等他一句话\n\n甲方确认之前**不要改文件**。这一轮只做：回答他的问题、补充依据、按他的意见调整方案。\n'
          : '',
    /* 自主迭代：谈定就开工，但「必须真的谈成」这一条不放松。 */
    options.autonomous ? AUTONOMY_PROMPT : '',
    /*
     * 项目标记：这条任务属于哪个项目、本机对应哪个目录。
     *
     * 用户的要求：「每个任务按时间段区分任务项目，执行过程做项目标记，
     * 哪个任务是哪个项目的，避免串项目执行导致混乱和错误。」
     *
     * 所以把项目钉在提示词最前面，并明确「只改这个目录」——
     * 多根工作区里 agent 很容易顺着当前打开的文件改到另一个项目去。
     */
    requirement.repo || requirement.project || options.projectName
      ? [
        `【任务项目】${requirement.project || options.projectName || '（未命名）'}`,
        requirement.repo ? `（项目 ID：${requirement.repo}）` : '',
        options.projectRoot ? `\n本机对应目录：${options.projectRoot}。**只改这个目录里的文件**，不要碰其它项目。` : '',
        options.readOnly
          ? '\n本轮是**只读**（这两台当前选的项目不是同一个）：可以读代码、可以回答、可以给依据，**绝不修改任何文件**。'
            + '这一档**不看授权**——甲方回「授权」也解不开，所以不要向甲方索取「改文件」的权限，那样只会让人以为你不具备写文件能力。'
            + '要动手改，只能让甲方在团队群里先把本机切到需求所属项目（或把两台项目对齐），再重新发一次这条需求。'
            + '这一轮就在群里说清：要改什么、卡在项目不一致、需要甲方切哪个项目。'
          : '',
      ].join('')
      : '',
    '',
    /*
     * 打断说明（用户 2026-11-25）：
     * 「消息能打断正在进行的任务，然后将新消息加入综合分析后再更新任务再继续执行」。
     *
     * 光打断不够 —— agent 必须知道「刚才那一轮被打断了」，否则它会以为
     * 上一轮的结果还有效，或者从头再做一遍。
     */
    options.interrupted
      ? [
        '## 这条消息打断了上一轮执行',
        '',
        '甲方在你执行过程中又发了这条，这一轮已经为你停下上一轮。请：',
        '1. 先看上面「团队群最近的发言」里上一轮做到哪、已经说了什么；',
        '2. 把**这条新要求**和上一轮的目标放在一起重新判断（冲突时以新消息为准）；',
        '3. 用 update_todos 更新清单：已完成的保留并标完成，被新消息否掉的就删掉，新增的补上；',
        '4. 再从当前状态继续执行，不要从头重做已经做完的部分。',
        '5. 如果新消息和上一轮的目标没法同时满足，就在群里用 team_sync action=question 说清冲突，等甲方定。',
        '',
      ].join('\n')
      : '',
    '需求原文：',
    requirement.detail,
    '',
    /*
     * 身份与收件人（用户 2026-11-25）：
     * 「agent 需要知道对方身份、用户身份，哪些是说给它听的，哪些不是」。
     *
     * 群里同时有：甲方（用户，可能在任何一台设备上）、你（本机乙方）、队友（另一台乙方）。
     * 不写清这三者，agent 会把队友之间的私聊当成给自己的指令，或者把甲方的回答
     * 当成「所有人都要做」而重复跑一轮。
     */
    '## 谁在说话（先认清这三方，再动手）',
    `- **甲方（用户）**：发需求、做决定、给授权的人。他说的话是**最高指令**。`,
    requirement.from.id === local.id
      ? '- 这条需求是甲方在**本机**提的。'
      : `- 这条需求是甲方在另一台设备「${deviceLabel(requirement.from, roster)}」上提的。`,
    `- **你**：${deviceLabel(local, roster)} 的乙方（产品经理），在自己这台机器上执行。`,
    teammates.length
      ? `- **队友**：${teammates.map((peer) => `${deviceLabel(peer, roster)} 的乙方`).join('、')}。它是同事，不是甲方。`
      : '- 当前没有队友在线。',
    '- **怎么判断一条消息是不是说给你听的**：',
    `  - \`to\` 是 \`${local.id}\` 或为空（所有人）→ 说给你听，要处理；`,
    '  - `to` 是别的设备 → **只是参考**，不要执行、不要回答、不要再跑一轮；',
    '  - 队友（群里其它设备上的乙方，可能不止一台）之间的往来 → **参考**它们的结论，别重复它们已经做完的事；',
    '  - 甲方回答了某台的追问 → **只有那一台**接着做，其余只记录；',
    '  - 需要多台一起定的事：把问题发给**每一台**（`action=ask`），等它们**都**回话再下结论 —— 只回一台不算达成一致。',
    '',
    groupLines.length ? ['团队群最近的发言（队友说过的，不要重复问）：', ...groupLines].join('\n') : '',
    '',
    '你现在是**乙方产品经理**，不是马上写代码的机器。请先判断这句话属于哪一类，再按对应流程做：',
    '',
    'A. 只是问一件事（不需要改任何文件）：**直接在群里回答**，必须给出依据（哪个文件/哪个字段/哪段逻辑），',
    '   用 team_sync action=analysis 发出去，然后结束这一轮。不要提"第 1-6 步"，不要追问，不要列清单。',
    '   答不出来就直说需要看哪部分，不要编。',
    /*
     * 回答的篇幅（用户 2026-11-25：「agent 回复报数这种简单问题都需要回复一大堆文字，是否合适？」）。
     * 「简短回答」写在上面不够，模型会照样分节、列表、加粗堆一大段。这里给可数的硬上限。
     */
    '   **篇幅按问题大小走，不许一律长篇**：能一句话答清就只写一句；',
    '   简单问题（有没有某个功能、当前项目是哪个、某处写的是什么）**最多 3 行**，',
    '   先给结论再给一句依据，**禁止**分节标题（##/###）、禁止表格、禁止「我的理解 / 结论 / 依据」这种三段式模板。',
    '   只有确实需要对比多台/多项时才用列表，且每项一行。',
    /* 用户 2026-11-25：「报数不是应该报 1、2、3、4 吗？为什么 agent 回复这么复杂」 */
    '   **甲方说「报数 / 报到 / 点名」时，正文只写你自己的序号，一个字都不要多**（不要写设备名、项目、分支、改动）；',
    '   除甲方明确追问，否则不要主动汇报分支 / 提交 / 工作区状态。',
    '',
    'B. 要改代码：按下面 1-6 步走。',
    '',
    /*
     * 「不达目标不罢休」+ 自己逐项核对。
     *
     * 用户要求：「尽量分析任务拆解任务，方便最后 agent 自己一项项核对任务目标完成情况」。
     * 光说"做完"没有意义 —— 必须有可验收的清单，并且最后逐项给出证据。
     */
    '0. **先拆成可验收的清单**（用 update_todos）：每一条都要是能被验证的结果',
    '   （看得见的界面效果 / 某个字段存在 / 某条命令通过 / 某个文件里有这段逻辑），',
    '   不许写「优化一下」「修一下」这类无法验证的条目。目标没写清就先问甲方（见下一步）。',
    '   **每条都必须是这台机器自己能做完的**：不许写「与另一台保持逐字一致」「比对两份代码」这种',
    '   跨机器、跨平台的条目 —— 那既做不到也浪费时间（两台代码库本来就不同）。',
    '   执行中每完成一项就更新清单状态，不要最后一次性全标完成。',
    '',
    '1. 用甲方听得懂的话把需求复述一遍：他要看到什么效果、在哪个界面、什么算做完了。不要出现变量名、文件名、框架名。',
    `2. 说明在本机这个 ${platformLabel(local.platform)} 版本上你会改什么（用户能感知的部分），以及你不打算做什么、为什么。`,
    '3. 只要还有任何一点不确定（范围、优先级、哪个页面、另一平台要不要一致、验收标准），就用 team_sync action=question 提出**具体的选择题**，然后**停下来等甲方回答**。不要猜着做，也不要「先做一版看看」。',
    '4. 甲方回答清楚、没有疑问了，用 team_sync action=confirm 发一条确认单（一句话复述达成一致的结果），再开始执行：先 update_todos 把工作拆成清单，再动手。',
    '5. 做完用 team_sync action=result 报结果：改了什么（用甲方的话）、他怎么自己验证、有哪些平台差异。',
    '   **必须在群里说清「需要你做的」**（用户 2026-11-25：『执行完需要我做的内容，它没有发出来到群聊里』）：',
    '   只要还需要甲方做任何事（重启 / 重载窗口 / 装新包 / 去某个页面点一下 / 回复某个选择 / 上传素材），',
    '   就在结论后面用一行一条列出来；**一件都不需要就明写「不需要你做什么」**，不要省略这一节。',
    '   报结果时**必须逐项核对**：把第 0 步清单里的每一条列出来，写清「做到了 / 没做到」，',
    '   做到了要给出证据（哪个文件哪段、哪条命令输出、哪个界面现象）。',
    '   **只要还有没做到的项，就不许说「做完了」**：先继续做；确实卡住（缺信息、缺权限、',
    '   需要甲方决定、需要队友那台配合）就用 team_sync action=question 说明卡在哪一项、缺什么，',
    '   等群里答复后接着把这一项做完。目标没达成不要收工。',
    '',
    /*
     * 跨平台对齐只要求「行为一致」，不许要求「逐字一致」。
     *
     * 用户实况（2026-11-24）：Windows 的清单里出现「在 Windows 版本实现并与 macOS 两份保持逐字一致」，
     * 结果 agent 花十几分钟去比对两份不同平台的代码 —— 这是纯浪费：
     * 两台的代码库本来就不同（语言、框架、目录结构都不一样），永远不可能字面一致。
     * 甲方要的是「用户看到的效果一样」。
     */
    '   跨平台对齐只要求**行为一致**：甲方能感知的效果相同即可。',
    '   **禁止**把「逐字一致 / 行数一致 / 文件内容相同 / 比对两份代码的差异」写成任务项，',
    '   也禁止为了对齐去读队友那台的仓库或服务器。两台各自的代码库本来就不同，字面一致永远做不到。',
    '   需要对齐时只做一件事：各自在本机实现，然后在群里用「用户能看到的效果」互相对一遍结论。',
    `6. 最后把结论补进 ${ALIGNMENT_FILE} 里这条需求对应的行。`,
    '',
    '群里只发需求、解析、追问、确认、进度和结果；不要把命令输出、代码、文件列表贴进群。',
    '',
    '这条活跑在「团队任务」对话框里，默认是**自动权限 + 无限步数**，普通操作不用再问甲方。',
    '如果某一步被权限挡住（需要完全访问），就用 team_sync action=question 发一条，正文以「【权限申请】」开头，',
    '说明卡在哪一步、为什么需要，然后停下来等甲方在群里回「授权」。拿到授权再继续。',
    '',
    /*
     * 两个 agent 要**真的分工协作**，而不是各干各的。
     *
     * 用户反馈：「没有实现两个 agent 在团队群自己沟通任务的功能，还是各干各的」。
     * 通道其实早就有（team_sync 的 send / ask 会让对方跑一轮），但从没在提示词里
     * 要求用过 —— 我上一轮甚至写了「队友的结果不要理」，那是反方向。
     */
    '## 和队友的分工（必须做，不是可选）',
    '队友（其它设备上的乙方，**可能不止一台**）就在这个群里。上面「团队群最近的发言」里它们的解析 / 进度 / 结果是背景：',
    '不要复述、不要致谢、不要把它已经做完的事再做一遍。',
    '',
    '但只要这条活涉及其它设备（**可能是两台，也可能三台以上**），你就必须主动沟通，用 team_sync：',
    '- **开始动手前**：先看队友已经说了什么。同一条需求它已经在做同一件事时，只做**你这一端**该做的部分，',
    '  并立刻用 `action=send` 说一句「我负责 <你这一端的具体范围>，你那端不要动 <那部分>」，避免两边改同一处。',
    '- **需要它们确认或配合**（接口字段、验收标准、它们那台的现状）：用 `action=ask` 直接问，问题要具体到能一句话回答。',
    '- **发现会影响其它设备的差异**（各端实现不一致、字段对不上、它们的结论和你的代码不符）：用 `action=send` 说清事实差异。',
    '- 收到队友消息后**只回一次结论**，不要接龙客套；它已经答清的事不要再问一遍。',
    '',
    '### 甲方要求「你们先沟通、达成一致再告诉我」时（2026-11-25 用户实况）',
    '用户原话：「每次我要求群里的 agent 互相沟通、达成一致的方案的时候，就会有 agent 单方面读取并发出结果。',
    '我并没有看到沟通，实际上其他 agent 还没有执行完。」所以：',
    '- 用 `action=ask` 问清楚**每一台**那一端的**事实**（各端现在是什么实现、缺什么、要不要跟着改），问一次、问具体；',
    '- `action=ask` 会**当场等它们回答**（有上限），并把回答原话交回给你。**每一台都回话**才算谈成；',
    '- 只回了一部分（工具结果里写着还差谁）时：**不许发 result、不许写「已一致」**，',
    '  只说明你在等哪一台的哪一点；它们回齐后你会被重新叫起来，那时候再给结果；',
    '- 发 result 前自查一句：这段结论里有没有「对方已同意」的内容？没有它的原话支撑，就还没达成一致。',
    '- 甲方要的是**一致后的结论**：各端说法不同就写明分歧、各自打算怎么做，等甲方或对方定，不要各自宣布完成。',
    '',
    '禁止：发「收到」「好的」「我这边也在做」这类空消息；把代码、日志、文件清单贴进群。',
  ].filter((line) => line !== '').join('\n');
}

export interface LedgerRow {
  requirement: SyncRequirement;
  /**
   * 设备 id → 该设备最新一条报告。
   *
   * **按设备而不是按平台**：两个人各有一台 Windows 是两条独立进度，
   * 以前按平台存会把它们合成一格、后报的覆盖先报的。平台只用于显示标签。
   */
  reports: Record<string, SyncReport>;
}

/** 账本里一处「谁」——设备 id + 给人看的名字。 */
export interface LedgerParty {
  id: string;
  /** `MacBook · macOS` 这种可读标签。 */
  label: string;
}

function partyOf(report: SyncReport, roster?: readonly SyncPeer[]): LedgerParty {
  // 身份统一由 deviceLabel 拼（系统类型 · 设备名，同名时带 IP），
  // 以前直接用 `from.name`，会出现 `MagicBookV14 · win32 · Windows` 这种重复。
  return { id: report.from.id, label: deviceLabel(report.from, roster) };
}

/** 一台设备的名字；没有名字时才退回平台。 */
function peerLabel(peer: SyncPeer, roster?: readonly SyncPeer[]): string {
  return deviceLabel(peer, roster);
}

/**
 * 把需求与报告合并成「需求 × 设备」的行。
 *
 * 同一需求、同一设备的多条报告只留**最新一条**：模型一轮里可能先报 planned
 * 再报 done，账本要的是最终状态，不是流水账。
 */
export function buildLedger(requirements: readonly SyncRequirement[], reports: readonly SyncReport[]): LedgerRow[] {
  const byId = new Map<string, LedgerRow>();
  for (const requirement of requirements) {
    if (!byId.has(requirement.id)) byId.set(requirement.id, { requirement, reports: {} });
  }
  const latest = new Map<string, SyncReport>();
  for (const report of reports) {
    const key = `${report.requirementId}\u0000${report.from.id}`;
    const previous = latest.get(key);
    if (!previous || report.at >= previous.at) latest.set(key, report);
  }
  for (const report of latest.values()) {
    const row = byId.get(report.requirementId);
    if (row) row.reports[report.from.id] = report;
  }
  return [...byId.values()]
    .sort((left, right) => right.requirement.createdAt - left.requirement.createdAt)
    .slice(0, MAX_RECORDS);
}

/** 一个需求里「做完了却没对齐」的情况。 */
export interface Divergence {
  requirement: SyncRequirement;
  doneOn: LedgerParty[];
  /** 在频道里、但这个需求上没有报告的设备。 */
  missingOn: LedgerParty[];
  skippedOn: LedgerParty[];
  /** 跳过原因（来自报告 note），用来解释「为什么这边没有」。 */
  skippedNotes: string[];
}

/**
 * 找出没对齐的需求。
 *
 * 判定只看**确凿的事实**：至少一台设备 `done`，同时另一台 `skipped`。
 *
 * 为什么不把「没有报告」也算成分歧：没报告的成因太多（那台机器还没开机、
 * 刚连上还没跑）。没有报告在表格里显示为「—」，同样看得见；
 * 而 `skipped` 是对方**明确写下理由**的结论 —— 那才是真正的「两边不一样」。
 *
 * @param roster 频道里已知的设备。给了才计算 `missingOn`；不给就留空
 *   （不知道有哪些设备时，任何"缺失"都是瞎猜）。
 */
export function findDivergences(rows: readonly LedgerRow[], roster: readonly SyncPeer[] = []): Divergence[] {
  const result: Divergence[] = [];
  for (const row of rows) {
    const reports = Object.values(row.reports).filter((report): report is SyncReport => Boolean(report));
    const done = reports.filter((report) => report.status === 'done').map((report) => partyOf(report, roster));
    const skipped = reports.filter((report) => report.status === 'skipped').map((report) => partyOf(report, roster));
    if (!done.length || !skipped.length) continue;
    const reported = new Set(reports.map((report) => report.from.id));
    result.push({
      requirement: row.requirement,
      doneOn: done,
      missingOn: roster
        .filter((peer) => !reported.has(peer.id))
        .map((peer) => ({ id: peer.id, label: peerLabel(peer, roster) })),
      skippedOn: skipped,
      skippedNotes: reports
        .filter((report) => report.status === 'skipped')
        .map((report) => report.note ?? '')
        .filter(Boolean),
    });
  }
  return result;
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  planned: '计划中',
  in_progress: '进行中',
  done: '已完成',
  skipped: '已跳过',
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/** 渲染账本（写进仓库的那份 Markdown）。 */
export function renderLedger(rows: readonly LedgerRow[], now = Date.now(), roster: readonly SyncPeer[] = []): string {
  const divergences = findDivergences(rows, roster);
  const lines = [
    '# 跨平台对齐账本',
    '',
    '> 由 HWChat 同步自动维护。**每台设备只补自己那一行**，不要重写整张表。',
    `> 上次更新：${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
  ];
  if (!rows.length) {
    lines.push('（还没有需求。在任意一台设备上发起需求后，这里会出现记录。）');
    return `${lines.join('\n')}\n`;
  }
  // 一行一台设备，而不是"一列一个平台"：设备数量本来就不固定，
  // 固定三列（Windows/macOS/Linux）在"两个人都是 Windows"时会把两条进度压成一格。
  lines.push('## 需求对照', '', '| 需求 | 发起 | 执行设备 | 状态 | 说明 | 更新 |', '|---|---|---|---|---|---|');
  for (const row of rows) {
    const reports = Object.values(row.reports).filter((report): report is SyncReport => Boolean(report));
    const requester = peerLabel(row.requirement.from, roster);
    if (!reports.length) {
      lines.push(`| ${escapeCell(row.requirement.title)} | ${escapeCell(requester)} | — | 没有报告 | — | — |`);
      continue;
    }
    for (const report of reports.sort((left, right) => left.at - right.at)) {
      const detail = report.summary || report.note || '';
      const files = report.files.length ? `（${report.files.length} 个文件）` : '';
      lines.push(
        `| ${escapeCell(row.requirement.title)} | ${escapeCell(requester)} `
        + `| ${escapeCell(partyOf(report, roster).label)} | ${STATUS_LABEL[report.status]} `
        + `| ${escapeCell(`${detail}${files}`)} | ${new Date(report.at).toISOString().slice(5, 16).replace('T', ' ')} |`,
      );
    }
  }
  if (divergences.length) {
    lines.push('', '## 需要对齐的差异', '');
    for (const divergence of divergences) {
      const done = divergence.doneOn.map((party) => party.label).join('、');
      const problem = [
        divergence.skippedOn.length ? `${divergence.skippedOn.map((party) => party.label).join('、')} 已跳过` : '',
        divergence.missingOn.length ? `${divergence.missingOn.map((party) => party.label).join('、')} 没有报告` : '',
      ].filter(Boolean).join('；');
      const reason = divergence.skippedNotes.length ? ` 原因：${divergence.skippedNotes.join('；')}` : '';
      lines.push(`- **${divergence.requirement.title}**：${done} 已完成，但 ${problem}。${reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** 一条报告的人话摘要（发到通知/日志里）。 */
export function renderReportSummary(report: SyncReport, requirementTitle: string): string {
  const parts = [`${platformLabel(report.from.platform)} · ${STATUS_LABEL[report.status]}`, requirementTitle];
  if (report.summary) parts.push(report.summary);
  return parts.filter(Boolean).join(' · ');
}

/**
 * 配对码比对。
 *
 * 用**长度无关的逐字符累加**而不是 `===`：字符串比较在第一个不同字符处就会返回，
 * 时间差可以被用来逐位猜配对码。局域网场景风险不高，但这是便宜的正确做法。
 */
export function pairingMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || !expected) return false;
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

/** 生成一个给人念得出来的配对码（去掉容易混淆的 0/O/1/I）。 */
export function generatePairingCode(random: (bytes: number) => Buffer): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = random(8);
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[bytes[index]! % alphabet.length];
    if (index === 3) code += '-';
  }
  return code;
}

/** 协作状态的一句话描述（状态栏 / 提示框共用）。 */
export function describeSyncState(input: {
  role: 'off' | 'hub' | 'peer';
  peers: number;
  requirements: number;
  divergences: number;
  address?: string;
}): string {
  if (input.role === 'off') return '局域网同步：未启用';
  const role = input.role === 'hub' ? `主机 ${input.address ?? ''}`.trim() : '已加入主机';
  return `局域网同步：${role} · ${input.peers} 台设备 · ${input.requirements} 条需求 · ${input.divergences} 处待对齐`;
}
