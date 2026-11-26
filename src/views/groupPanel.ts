/**
 * 团队群窗口：**独立**的群聊面板，不往主对话里堆消息。
 *
 * 为什么不塞进主对话（用户 2026-11-23）：
 *   「群的对话窗口你准备放在哪里？……那就需要将显示的输出简化缩小，避免信息繁杂」
 *
 * 主对话是「你和一个 agent 干活」的地方，塞进其他设备的发言、追问、确认，
 * 一条长任务下来几十条消息，真正的工作过程就被淹了。
 *
 * 所以分工是：
 *  - **主对话**：你本机 agent 的执行过程（现有界面，一个字都不改）；
 *  - **团队群窗口**：只放需求 / 解析 / 追问 / 确认 / 进度 / 结果，一行一条、可展开；
 *  - **两个 Markdown**：`docs/TEAM-CHAT.md`（过程）与 `docs/PLATFORM-ALIGNMENT.md`（状态）。
 *
 * 群窗口刻意做到极简：三条信息一眼可见 —— 有几个人、谁在等你回答、最近发生了什么。
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { LanSyncService } from '../sync/lanSync';
import { deviceLabel, groupSpeaker, platformLabel, sortGroupTimeline, type SyncGroupMessage, type SyncPeer } from '../sync/lanProtocol';
import { projectMismatchText } from '../sync/projectRef';
import { TASK_STATUS_LABEL, buildTaskBoard, groupTasksByStatus } from '../sync/tasks';
import { mediaUri } from './webview';

const PHASE_LABEL: Record<string, string> = {
  requirement: '需求',
  analysis: '解析',
  question: '追问',
  answer: '甲方回复',
  confirm: '确认',
  progress: '进度',
  result: '结果',
};

/** 附件扩展名 → MIME（复制进剪贴板时要标对类型）。 */
function mimeOfPath(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const table: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
    txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
    pdf: 'application/pdf', zip: 'application/zip', log: 'text/plain',
  };
  return table[extension] ?? 'application/octet-stream';
}

/** 群里一条消息的时间：当天只显示时分，跨天带日期。 */
function timeLabel(atMs: number, now = Date.now()): string {
  const at = new Date(atMs);
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return new Date(now).toDateString() === at.toDateString() ? clock : `${at.getMonth() + 1}/${at.getDate()} ${clock}`;
}

/** 群窗口里一条发言的紧凑描述（测试直接钉这段）。 */
export function compactGroupLine(message: SyncGroupMessage, now = Date.now(), roster?: readonly SyncPeer[]): {
  who: string;
  phase: string;
  body: string;
  time: string;
  /** 排序用的原始时间戳。 */
  at: number;
  /** 本机收到它的时刻（排序的第一依据：两台机器的时钟不一定一致）。 */
  receivedAt?: number;
  /** 甲方在自己这边（右侧气泡），乙方在左侧。 */
  side: 'user' | 'agent';
  phaseKey: string;
} {
  return {
    who: groupSpeaker(message, roster),
    phase: PHASE_LABEL[message.phase] ?? message.phase,
    body: message.body.replace(/\s+/g, ' ').trim(),
    time: timeLabel(message.at, now),
    at: message.at,
    ...(message.receivedAt !== undefined ? { receivedAt: message.receivedAt } : {}),
    side: message.author === 'user' ? 'user' : 'agent',
    phaseKey: message.phase,
  };
}

export interface GroupTimelineLine {
  kind: 'group' | 'note';
  id: string;
  who: string;
  phase: string;
  phaseKey: string;
  body: string;
  full: string;
  time: string;
  /** 排序用的原始时间戳。 */
  at: number;
  /** 本机收到它的时刻（排序的第一依据，见 `messageOrderKey`）。 */
  receivedAt?: number;
  side: 'user' | 'agent';
  replyTo: string;
  requirementId?: string;
  options?: readonly string[];
  meta?: import('../sync/lanProtocol').GroupMessageMeta | null;
  device: { id: string; name: string; isLocal: boolean };
  /** 这条消息指派给哪台（显示成 `@设备`，让甲方一眼确认发对了没有）。 */
  assigneeLabel?: string;
  /** 已读这条的设备标识（甲方自己的发言才有意义）。 */
  readBy?: string[];
  /** 还没收到任何回执（界面上提示「等待对方确认收到」）。 */
  ackPending?: boolean;
  /** 说给谁：这条消息的收件设备（`@所有人` 就是群里每一台，含本机）。 */
  addressed?: string[];
  /** 点名了但**还没回执**的设备（界面上显示「未读：…」）。 */
  unreadBy?: string[];
  /** 这条消息自带的附件（图片有 `src` 时直接画出来）。 */
  assets?: { id: string; name: string; kind: 'image' | 'file'; src?: string; path?: string; ready: boolean }[];
}

/** 「等待对方确认收到」只提示最近这几分钟，旧消息不再挂着。 */
const ACK_PENDING_WINDOW_MS = 5 * 60_000;

/**
 * 群发言 + 「队友之间的往来」合成**一条时间线**。
 *
 * 用户 2026-11-25：「队友之间的往来的对话消息将对话框下半部分占据了。
 * 消息没有按照时间顺序在对话框里显示」——以前往来自成一块追加在最后，
 * 不管时间多早都压在所有群消息下面。现在按 `at` 排序，和群消息交错出现。
 */
export function buildGroupTimeline(
  messages: readonly SyncGroupMessage[],
  notes: readonly { id: string; who: string; body: string; at: number; replyTo: string }[],
  options: {
    now?: number;
    roster?: readonly SyncPeer[];
    labelOf: (peer: SyncPeer | undefined) => string;
    localId: string;
    /** 设备 id → 统一标识（没有就退回 id）。 */
    labelForId?: (id: string) => string;
    /** 已读回执：群消息 id → 已读的设备 id。 */
    reads?: Record<string, readonly string[]>;
    /** 群里除本机之外还有几台（决定「等待对方确认收到」是否有意义）。 */
    otherDeviceCount?: number;
    /** 附件是否已经落到本机、对应的本地图片地址（没到齐就没有 src）。 */
    assetView?: (id: string) => { src?: string; path?: string; ready: boolean };
  },
): GroupTimelineLine[] {
  const now = options.now ?? Date.now();
  const hasOthers = (options.otherDeviceCount ?? Math.max(0, (options.roster?.length ?? 1) - 1)) > 0;
  /**
   * 设备 id → 界面上显示的名字。
   *
   * 本机额外标「（本机）」：回执列表里出现两台同名设备时，用户得能看出哪一行是自己。
   */
  const labelFor = (id: string): string => {
    const label = options.labelForId?.(id) || id;
    return id && id === options.localId ? `${label}（本机）` : label;
  };
  const lines: GroupTimelineLine[] = messages.map((message) => {
    const mine = message.from?.id === options.localId;
    /*
     * 收件人：明确说了给某台就是那一台；否则（`@所有人` / 没点名）= 群里每一台，**含本机**。
     *
     * 用户实况（2026-11-25）：「我发的消息没有 @ 任何 agent，默认是所有人都收到消息，
     * 但是显示只有『已读：macOS …』，别的 agent 没有显示已读未读状态」——
     * 以前只画「已读」，没人回执的那台就从列表里**消失**，看起来像不存在。
     */
    const addressedIds = message.to
      ? [message.to]
      : message.assignee
        ? [message.assignee]
        : (options.roster ?? []).map((peer) => peer.id);
    /*
     * 自己发的、又说给本机的消息：本机**一定**有这条（它就在本机的群记录里）。
     *
     * 用户实况（2026-11-25，0.10.17 之后仍然复现）：「Windows（输入对话的设备）团队任务
     * 对话框显示收到了消息，但团队群只显示 macmini 已读」。回执按「已收到」记，
     * 那就不该等服务端那条自回执 —— 事实本身就说明本机读到了。
     */
    const readIds = [...new Set([
      ...(options.reads?.[message.id] ?? []),
      ...(mine && message.author === 'user' && addressedIds.includes(options.localId) ? [options.localId] : []),
    ])];
    const unreadIds = addressedIds
      .filter((id) => id && !readIds.includes(id))
      .map((id) => labelFor(id));
    const reads = readIds.map((id) => labelFor(id));
    return {
      ...compactGroupLine(message, now, options.roster),
      kind: 'group',
      id: message.id,
      requirementId: message.requirementId,
      replyTo: message.replyTo ?? '',
      options: message.options ?? [],
      meta: message.meta ?? null,
      device: {
        id: message.from?.id ?? '',
        name: options.labelOf(message.from),
        isLocal: mine,
      },
      ...(message.assignee ? { assigneeLabel: options.labelForId?.(message.assignee) || message.assignee } : {}),
      /*
       * 已读状态对**每一条气泡**都给（用户 2026-11-26：「不管是 agent 还是用户的消息
       * 气泡下面都要显示已读状态，哪些 agent 已读了」）。
       *
       * 以前只给「我自己说的甲方需求」算，于是 agent 的进度 / 结果下面永远空白 ——
       * 甲方根本看不出队友到底收到没有。
       */
      readBy: reads,
      addressed: addressedIds.map((id) => labelFor(id)),
      // 未读不设时间窗：只要那台还在群里、还没回执，就如实列出来（离线时一直未读才是真相）。
      ...(unreadIds.length ? { unreadBy: unreadIds } : {}),
      ackPending: hasOthers && !reads.length && now - message.at < ACK_PENDING_WINDOW_MS,
      ...(message.assets?.length
        ? {
          assets: message.assets.slice(0, 8).map((asset) => {
            const view = options.assetView?.(asset.id);
            return {
              id: asset.id,
              name: asset.name,
              kind: asset.kind,
              ...(view?.src ? { src: view.src } : {}),
              ...(view?.path ? { path: view.path } : {}),
              ready: view?.ready ?? false,
            };
          }),
        }
        : {}),
      // 群消息正文上限是 4 000 字（协议层）。复制要拿到**完整的**正文，别再截一刀。
      full: message.body.slice(0, 4_000),
    };
  });
  for (const note of notes) {
    lines.push({
      kind: 'note',
      id: note.id,
      who: note.who,
      phase: note.replyTo ? '回复队友' : '队友对话',
      phaseKey: 'note',
      body: note.body,
      full: note.body,
      time: timeLabel(note.at, now),
      at: note.at,
      side: 'agent',
      replyTo: note.replyTo,
      device: { id: note.id, name: note.who, isLocal: false },
    });
  }
  /*
   * 按**到达顺序**排，不是按两台设备各自的时间戳。
   *
   * 真实故障（2026-11-26）：macOS 那台的时钟比 Windows 慢 123 ms，于是
   * 「Windows 发出的需求 07:41:40.015」排在了「Mac 回复的进度 07:41:39.892」之后 ——
   * 回复跑到提问上面。`sortGroupTimeline` 用本机到达时刻兜底（见 `messageOrderKey`），
   * 手机页与群记录也走同一个函数，三处不会再各排一套。
   *
   * 同时锚定「甲方需求排在回应它的乙方发言之前」：需求先在协议层到达、agent 立刻回话，
   * 而需求气泡是发送方随后才广播过来的 —— 只按到达顺序会看到「乙方先说话」。
   */
  return sortGroupTimeline(lines, {
    requirementIdOf: (line) => (line.kind === 'note' ? undefined : line.requirementId),
    isUserRequirement: (line) => line.kind === 'group' && line.side === 'user' && line.phaseKey === 'requirement',
    isAgentLine: (line) => line.kind === 'note' || line.side === 'agent',
  });
}

export interface GroupHeaderInput {
  role: string;
  relay?: { connected: boolean; peers: number; url: string };
  /** 除本机以外的设备数：从机要确认「主机真的在」才敢说已连接。 */
  peerCount?: number;
  /**
   * 当前阶段（谈 / 等确认 / 执行）与自主迭代标记。
   *
   * 用户 2026-11-26 定的流程：先只读谈判 → 出一份双方同意的方案 → 甲方确认 → 才动手；
   * 开了自主迭代则谈成即开工。这两个状态必须**顶部可见**，否则甲方不知道现在该不该说话。
   */
  phaseLabel?: string;
  autonomous?: boolean;
}

/**
 * 群窗口顶部那行状态。
 *
 * 跨网时局域网是断的（`role === 'off'`）但中继通着 —— 只看局域网会把
 * 「已连 2 台」显示成「未连接」，用户以为没连上。
 *
 * @returns `tone`：`on` 表示连上了（状态点亮）
 */
export function groupHeader(state: GroupHeaderInput): {
  status: string;
  sub: string;
  on: boolean;
} {
  const relay = state.relay;
  const lanOn = state.role !== 'off';
  const relayOn = !!(relay && relay.connected);
  const members = typeof state.peerCount === 'number' ? state.peerCount : undefined;
  /*
   * 对用户只说「群聊」和「几台设备」。
   *
   * 主机/从机是实现细节：群是**用户的**，两台电脑上的 agent 都只是成员。
   * 把「主机（等待队友）」这类字眼露出来，会让人以为某台电脑是"上级"。
   */
  if (lanOn) {
    /*
     * 阶段优先：谈的时候要让人知道「现在还不能动手」，等确认时要让人知道「该我说话了」。
     * 自主迭代额外标一句 —— 否则甲方会一直等一个永远不会来的「请确认」。
     */
    const phase = state.phaseLabel
      ? `${state.phaseLabel}${state.autonomous ? '（自主迭代：谈成就开工）' : ''}`
      : '';
    if (members !== undefined && members < 1) {
      return {
        status: '群聊已开 · 等对方加入',
        sub: '把邀请码复制给对方，让对方点「加入群聊」粘贴进来。两台加入后，在这个窗口说的话两边 agent 会一起做。',
        on: false,
      };
    }
    return {
      status: members === undefined ? '群聊中' : `群聊中 · ${members + 1} 台设备`,
      sub: phase || '每台设备上有一位甲方（你）和一个乙方（agent）。你在哪天说需求都行，群里的乙方先解析、必要时追问，达成一致后才动手。',
      on: true,
    };
  }
  if (relayOn) {
    return {
      status: `中继已连接 · ${relay.peers + 1} 台`,
      sub: `经中继跨网协作（${relay.url}）。甲方提需求，指定设备的 agent 先解析、必要时追问，达成一致后才动手。`,
      on: true,
    };
  }
  return {
    status: '未连接',
    sub: '还没有进群。点状态栏的「启动群聊」生成邀请码，或在另一台点「加入群聊」填对方的邀请码。',
    on: false,
  };
}

export class GroupPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: LanSyncService,
    private readonly callbacks: {
      /** 在群里发一句话（需求或回答）—— 由面板决定走哪条路径。 */
      send: (text: string, assignee?: { id: string; name: string }, attachmentIds?: string[]) => Promise<void>;
      /**
       * 群窗口里的附件：交给主面板按统一规则解析。
       *
       * 用户 2026-11-25：「团队群需要有普通对话框的文件附件读取图片输出等全部功能，不要砍功能」。
       * 所以群窗口不再自己把文件写到临时目录再把路径拼进正文 —— 那等于告诉模型
       * 「有这么个文件」，图片它根本看不到。这里返回 id，发消息时随正文一起交给 agent。
       */
      attach?: (file: { name: string; mimeType: string; dataBase64: string }) => Promise<{
        ok: boolean;
        id?: string;
        name?: string;
        kind?: string;
        reason?: string;
      }>;
      /** 远程控制：目前只用到「停止当前执行」。 */
      control?: (action: 'stop') => Promise<{ ok: boolean; message: string }>;
      /**
       * 语音输入：交给主面板开「真实浏览器」的一次性语音页。
       *
       * 群窗口的 webview 同样没有麦克风权限，原来那句「这个环境不支持语音输入」
       * 就是点了没反应的根源（用户 2026-11-25）。
       */
      voice?: () => void | Promise<void>;
      log: (line: string) => void;
      /**
       * 中继状态。跨网协作时局域网根本没连上（`role === 'off'`），
       * 但中继是通的 —— 只看局域网会把「已连 2 台」显示成「未连接」。
       */
      relay?: () => {
        connected: boolean;
        peers: number;
        url: string;
        devices?: Array<{ id: string; name: string; platform: string; project: string }>;
      } | undefined;
    },
  ) {}

  /** 打开（或聚焦）群窗口。 */
  async open(): Promise<void> {
    /*
     * 开窗口先自检主机在不在。
     *
     * 否则用户会看到一个「已连接」的旧状态：主机早就重启/改 IP 了，
     * 而界面还挂着上一份群记录 —— 两台看到的群完全不一样。
     */
    if (this.service.state().role === 'peer') void this.service.checkHostOnce();
    if (this.panel) {
      this.panel.reveal(undefined, true);
      await this.refresh();
      return;
    }
    /*
     * 附件目录必须进 `localResourceRoots`，否则 `asWebviewUri` 生成的地址会被
     * 资源服务拒绝，`<img>` 只剩 alt 文字（用户 2026-11-25：图片只显示占位）。
     * 附件不在扩展目录里（globalStorage/assets），所以只能显式加进去。
     */
    const assetRoot = (() => {
      try {
        return vscode.Uri.file(this.service.assetDirectory());
      } catch {
        return undefined;
      }
    })();
    const panel = vscode.window.createWebviewPanel(
      'hwchat.teamGroup',
      '团队群',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri, ...(assetRoot ? [assetRoot] : [])],
      },
    );
    this.panel = panel;
    panel.webview.html = this.html(panel.webview);
    this.disposables.push(panel.webview.onDidReceiveMessage(async (message: unknown) => {
      const record = (message ?? {}) as {
        type?: unknown;
        text?: unknown;
        command?: unknown;
        assignee?: unknown;
        url?: unknown;
        name?: unknown;
        dataBase64?: unknown;
        mimeType?: unknown;
        attachments?: unknown;
        id?: unknown;
        requestId?: unknown;
      };
      if (record.type === 'ready') await this.refresh();
      /*
       * 附件：交给主面板按**和普通对话框完全相同的规则**处理（图片 → 视觉内容，
       * 文本 → 正文内容，大小 / 敏感文件策略一致），只带回一个 id。
       *
       * 以前是写进临时目录、把路径拼进正文：模型只看到一行路径，图片根本读不到；
       * 另一台更是完全看不到。
       */
      if (record.type === 'attach' && typeof record.name === 'string' && typeof record.dataBase64 === 'string') {
        try {
          const staged = await this.callbacks.attach?.({
            name: record.name,
            mimeType: typeof record.mimeType === 'string' ? record.mimeType : '',
            dataBase64: record.dataBase64,
          });
          if (!staged || !staged.ok || !staged.id) {
            await panel.webview.postMessage({ type: 'attachFailed', reason: staged?.reason ?? '这个附件没法添加' });
            return;
          }
          await panel.webview.postMessage({
            type: 'attached',
            item: { id: staged.id, name: staged.name ?? record.name, kind: staged.kind ?? 'file' },
          });
          this.callbacks.log(`[group] 已添加附件：${staged.name ?? record.name}`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await panel.webview.postMessage({ type: 'attachFailed', reason });
        }
        return;
      }
      if (record.type === 'toast' && typeof record.text === 'string') {
        vscode.window.setStatusBarMessage(record.text, 4_000);
        return;
      }
      if (record.type === 'send' && typeof record.text === 'string') {
        const text = record.text.trim();
        if (!text) return;
        // 指派：面板只传 id/名字，语义由 chatPanel 决定（指派给别人时本机不跑）
        const assignee = typeof record.assignee === 'object' && record.assignee
          ? (() => {
            const value = record.assignee as { id?: unknown; name?: unknown };
            return typeof value.id === 'string' && value.id
              ? { id: value.id, name: typeof value.name === 'string' ? value.name : value.id }
              : undefined;
          })()
          : undefined;
        /*
         * 附件只传 id：正文不再拼路径。真正的内容（图片字节 / 文件正文）由主面板
         * 按普通对话框的规则交给 agent，并**分片传给另一台**，两边的 agent 都能读到。
         */
        const attachmentIds = Array.isArray(record.attachments)
          ? record.attachments.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 20)
          : [];
        await this.callbacks.send(text, assignee, attachmentIds);
        await this.refresh();
      }
      /*
       * 复制：富格式（文字 + 全部图片）由面板自己写；宿主只负责两件它做不到的事 ——
       * 读附件字节、以及在富格式不可用时写纯文本。
       */
      if (record.type === 'copyText' && typeof record.text === 'string') {
        await vscode.env.clipboard.writeText(record.text);
        this.callbacks.log('[group] 已复制消息（纯文本 + 附件清单）');
        return;
      }
      if (record.type === 'voice') {
        await this.callbacks.voice?.();
        return;
      }
      if (record.type === 'requestAssetData' && typeof record.id === 'string' && typeof record.requestId === 'string') {
        const path = this.service.assetPath(record.id);
        try {
          if (!path || !existsSync(path)) throw new Error('附件还没收齐');
          const bytes = await readFile(path);
          await panel.webview.postMessage({
            type: 'assetData',
            requestId: record.requestId,
            ok: true,
            dataBase64: bytes.toString('base64'),
            mimeType: mimeOfPath(path),
          });
        } catch (error) {
          await panel.webview.postMessage({
            type: 'assetData',
            requestId: record.requestId,
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (record.type === 'openAsset' && typeof record.id === 'string') {
        const path = this.service.assetPath(record.id);
        if (path && existsSync(path)) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path));
        return;
      }
      if (record.type === 'copyInvite') {
        const text = typeof record.text === 'string' && record.text ? record.text : this.service.currentInviteText();
        if (text) {
          await vscode.env.clipboard.writeText(text);
          this.callbacks.log(`[group] 已复制邀请码 ${text}`);
        }
        await this.refresh();
        return;
      }
      if (record.type === 'control' && record.command === 'stop') {
        const result = await this.callbacks.control?.('stop');
        if (result) this.callbacks.log(`[group] 停止执行：${result.message}`);
        await this.refresh();
      }
      /* 富文本里的代码块「复制」。 */
      if (record.type === 'copyText' && typeof record.text === 'string' && record.text) {
        await vscode.env.clipboard.writeText(record.text);
        return;
      }
      /* 富文本里的链接：只放行 http/https/mailto，其余一律不打开。 */
      if (record.type === 'openLink' && typeof record.url === 'string') {
        const url = record.url.trim();
        if (/^(https?:\/\/|mailto:)/i.test(url)) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        } else {
          this.callbacks.log(`[group] 拒绝打开非常规链接：${url.slice(0, 60)}`);
        }
        return;
      }
      // 工具栏按钮：直接转发给命令，面板不重复实现打开账本 / 状态那套逻辑。
      if (record.type === 'command' && typeof record.command === 'string' && record.command.startsWith('hwchat.')) {
        await vscode.commands.executeCommand(record.command);
        await this.refresh();
      }
    }));
    panel.onDidDispose(() => {
      this.panel = undefined;
    }, null, this.disposables);
    await this.refresh();
  }

  /** 有新发言 / 状态变化时刷新。窗口没开着就什么也不做（零开销）。 */
  /**
   * 把语音识别结果放进群输入框（由主面板的语音页 / VS Code 内听写回传）。
   *
   * `live: true` 表示还在说：**替换**上一次插入的那段，而不是再追加一遍
   * （听写是实时整段重发，直接 append 会把一句话重复十几遍）。
   */
  async insertVoiceText(text: string, live = false): Promise<void> {
    const clean = String(text || '').trim();
    if (!clean || !this.panel) return;
    await this.panel.webview.postMessage({ type: 'voiceText', text: clean, live });
  }

  /** 把焦点放回群输入框（系统听写 / 听写结束后要用）。 */
  async focusComposer(): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage({ type: 'focusComposer' });
  }

  /** 麦克风开关状态（原生录音时按钮要高亮）。 */
  async setVoiceActive(active: boolean): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage({ type: 'voiceState', active });
  }

  /** 安装 VS Code Speech 的进度（麦克风按钮周围的绿圈）。 */
  async setVoiceSetup(phase: 'installing' | 'ready' | 'failed'): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage({ type: 'voiceSetup', phase });
  }

  async refresh(): Promise<void> {
    if (!this.panel) return;
    const state = this.service.groupState();
    const now = Date.now();
    const relay = this.callbacks.relay?.();
    const relayState = relay ? { connected: relay.connected, peers: relay.peers, url: relay.url } : undefined;
    const localId = this.service.localPeer().id;
    /*
     * 名册（本机 + 局域网 + 中继里出现过的）先收齐，再算身份标签：
     * 两台同名设备要自动补 IP 才能区分。
     */
    const roster: SyncPeer[] = (() => {
      const seen = new Map<string, SyncPeer>();
      const add = (peer: SyncPeer | undefined): void => {
        if (peer?.id && !seen.has(peer.id)) seen.set(peer.id, peer);
      };
      add(this.service.localPeer());
      for (const peer of state.peers) add(peer);
      for (const message of state.messages) add(message.from);
      return [...seen.values()];
    })();
    const labelOf = (peer: { id?: string; name?: string; platform?: string; version?: string; host?: string } | undefined): string =>
      deviceLabel(peer, roster);
    const labelForId = (id: string): string => {
      const peer = state.peers.find((item) => item.id === id)
        ?? relay?.devices?.find((item) => item.id === id);
      // 设备信息已经不在群里（换过设备 / 旧消息）时给个可读短码，不把原始 id 甩给用户。
      return peer ? labelOf(peer) : `设备 ${id.slice(0, 6)}`;
    };
    await this.panel.webview.postMessage({
      type: 'state',
      /* 本机设备 id：界面据此判断"这条是谁发的、要不要加本机白边"。 */
      localId,
      role: state.role,
      relay: relayState,
      /* 当前协作项目：进群后用这里显示与切换，不必事先选好。 */
      projectName: this.service.activeProjectName() || this.service.localProjects()[0] || '',
      projectRepo: this.service.currentRepo(),
      projectMismatch: projectMismatchText(
        { repo: this.service.currentRepo(), project: this.service.currentProject() },
        this.service.peerProjects(),
      ),
      /*
       * 每台设备各自在做的项目。
       *
       * 用户问过「这个群在做的项目，实际是不是这个设备在做的项目？」——
       * 原来只有一行、还混着"选过的"和"当前文件夹"两个来源，看不出是谁的。
       * 现在按设备摊开：谁在做哪个项目，一目了然；切换也要能指定设备。
       */
      projectRows: (() => {
        const local = this.service.localPeer();
        const rows: { device: string; project: string; repo: string; isLocal: boolean }[] = [{
          device: labelOf(local),
          project: this.service.activeProjectName(),
          repo: this.service.currentRepo(),
          isLocal: true,
        }];
        for (const peer of state.peers) {
          if (peer.id === local.id) continue;
          rows.push({
            device: labelOf(peer),
            project: peer.project ?? '',
            repo: (peer.repo ?? '') || '',
            isLocal: false,
          });
        }
        return rows;
      })(),
      /*
       * 两台版本不一致时必须明说。
       *
       * 这是这几轮反复踩的坑：一台更新了、另一台没更新（或装了没 reload），
       * 行为必然不同，而界面上完全看不出来 —— 用户只能靠猜，最后把「版本不同」
       * 当成「功能坏了」。
       */
      versionWarning: (() => {
        const local = this.service.localPeer();
        const mine = local.version ?? '';
        const others = this.service.remotePeers()
          .filter((peer) => peer.version && peer.version !== mine)
          .map((peer) => `${labelOf(peer)} 是 ${peer.version}`);
        if (!others.length) return '';
        /*
         * 版本不一致时**必须点名 @ 指派会失效**：用户 2026-11-25 就是在旧版本上
         * 「@ 了 macmini，那边没收到」，而界面上只有一句笼统的「行为会不一样」。
         */
        return `本机是 ${mine}，${others.join('；')} —— 两台行为会不一样，**@ 指派在旧版本上会失效（消息可能只发给其中一台）**。请把两台都更新到同一版本，并各自重载窗口（Developer: Reload Window）。`;
      })(),
      /* 邀请码（只有主机有）：一直显示在窗口顶部，并带可复制的整串。 */
      invite: this.service.currentInviteCode(),
      inviteText: this.service.currentInviteText(),
      inviteWaiting: this.service.currentInviteCode() !== '' && this.service.remotePeers().length === 0,
      header: groupHeader({
        role: state.role,
        peerCount: this.service.remotePeers().length,
        ...(relayState ? { relay: relayState } : {}),
        ...(state.phaseLabel ? { phaseLabel: state.phaseLabel } : {}),
        ...(state.autonomous ? { autonomous: true } : {}),
      }),
      peers: (() => {
        const local = this.service.localPeer();
        const seen = new Map<string, SyncPeer>();
        const add = (peer: SyncPeer): void => {
          if (seen.has(peer.id)) return;
          seen.set(peer.id, peer);
        };
        add(local);
        for (const peer of state.peers) add(peer);
        // 中继上的设备不在局域网 peer 列表里，但它们在群里发过言 —— 按消息补出来
        for (const message of state.messages) add(message.from);
        /*
         * 先收齐名册再算标签：两台同名设备要自动补 IP 才能区分，
         * 逐条各自算的话两边都只看到自己，永远发现不了重名。
         */
        const names = [...seen.values()];
        return names.map((peer) => ({
          id: peer.id,
          /** 给 @ 前缀与指派用的原始设备名（不含系统类型）。 */
          name: peer.name,
          /** 统一身份标识：系统类型 · 设备名（重名时带 IP）。 */
          label: deviceLabel(peer, names),
          platform: platformLabel(peer.platform),
          project: peer.project,
          isLocal: peer.id === local.id,
        }));
      })(),
      /*
       * 「乙方在等你回答」：谁在问、问什么、有哪几个现成答案。
       *
       * 用户 2026-11-24：「这种等我回答的弹出提示，没写是哪个设备等我回答，
       * 我直接回答会导致所有 agent 都收到消息。并且这种弹出提示却没有
       * 勾选选项 + 自定义回答，很不合理」。
       */
      openQuestion: state.openQuestion
        ? {
          body: state.openQuestion.body,
          askerId: state.openQuestion.askerId,
          askerLabel: state.openQuestion.askerLabel,
          options: state.openQuestion.options,
        }
        : null,
      /**
       * 「由谁执行」候选：**局域网里的每台设备 + 中继在线设备**。
       *
       * 以前只从中继取，于是纯局域网时这里永远只有一个「所有人」——
       * 用户想单独指派给某台 agent 时根本选不出来。
       */
      devices: (() => {
        const local = this.service.localPeer();
        const seen = new Set<string>();
        const out: { id: string; name: string; label: string; project: string; isLocal: boolean }[] = [];
        const add = (item: { id?: string; name?: string; label?: string; project?: string } | undefined): void => {
          const id = typeof item?.id === 'string' ? item.id : '';
          if (!id || seen.has(id)) return;
          seen.add(id);
          out.push({
            id,
            name: item?.name ?? id,
            label: item?.label ?? item?.name ?? id,
            project: item?.project ?? '',
            isLocal: id === local.id,
          });
        };
        // 先放局域网成员（群窗口的成员列表就是这一份）。
        for (const peer of this.service.groupState().peers) add(peer);
        // 再接中继设备（跨网时才有的那份）。
        for (const device of this.callbacks.relay?.()?.devices ?? []) add(device);
        return out;
      })(),
      canStop: state.role !== 'off' || Boolean(this.callbacks.relay?.()?.connected),
      /*
       * 每台设备的 agent 状态（指示灯）：本机由面板上报，对端通过 `agentState` 上报。
       * 谁都没上报时按「空闲」——绝不把没消息当成「正在运行」。
       */
      statuses: (() => {
        const states = this.service.agentStates();
        const seen = new Map<string, { id: string; label: string; state: string; isLocal: boolean }>();
        const add = (peer: { id?: string; name?: string; platform?: string } | undefined): void => {
          const id = typeof peer?.id === 'string' ? peer.id : '';
          if (!id || seen.has(id)) return;
          seen.set(id, {
            id,
            label: labelOf(peer as SyncPeer),
            state: states[id] ?? 'idle',
            isLocal: id === localId,
          });
        };
        add(this.service.localPeer());
        for (const peer of state.peers) add(peer);
        for (const message of state.messages) add(message.from);
        for (const device of this.callbacks.relay?.()?.devices ?? []) add(device);
        return [...seen.values()];
      })(),
      taskGroups: groupTasksByStatus(buildTaskBoard(state.messages)).map((group) => ({
        status: group.status,
        label: TASK_STATUS_LABEL[group.status],
        tasks: group.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          project: task.project,
          assigneeName: task.assignee
            ? (labelOf(state.peers.find((peer) => peer.id === task.assignee)) || task.assignee)
            : '',
          lastLine: task.lastLine,
        })),
      })),
      /*
       * 群发言和「队友之间的往来」合成一条按时间排序的时间线。
       *
       * 以前往来自成一块追加在最后 —— 不管时间多早都占着对话框下半部分，
       * 而且完全不在时间顺序上（用户 2026-11-25 反馈）。
       */
      lines: buildGroupTimeline(state.messages, state.dialogue ?? [], {
        now,
        roster,
        labelOf,
        localId,
        labelForId,
        reads: this.service.allReads(),
        otherDeviceCount: roster.length - 1,
        assetView: (id) => {
          const path = this.service.assetPath(id);
          const view = this.panel?.webview;
          if (!path || !existsSync(path)) return { ready: false };
          return {
            ready: true,
            path,
            ...(view ? { src: view.asWebviewUri(vscode.Uri.file(path)).toString() } : {}),
          };
        },
      }),
      /* 刚输入、还没判定完的那句话：先画出来，判定完被正式消息替换。 */
      pending: state.pending,
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = [...Array(32)].map(() => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    // 富文本渲染（markdown）：代码块、表格、列表、链接、图片 —— 群里的发言不再是一坨纯文本。
    const richScript = mediaUri(webview, this.extensionUri, 'richtext.js');
    // 群窗口自己的脚本：真文件，测试可以挂到 DOM 上执行（以前是内联脚本，只能读源码断言）。
    const groupScript = mediaUri(webview, this.extensionUri, 'group.js');
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;`;
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    color-scheme: light dark;
    --gap: 14px;
    --radius: 10px;
    --muted: var(--vscode-descriptionForeground);
    --line: var(--vscode-panel-border, rgba(128,128,128,.25));
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.55;
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
  }

  /* 顶部：标题 + 成员 */
  header { padding: 10px 16px 8px; border-bottom: 1px solid var(--line); }
  .row1 { display: flex; align-items: center; gap: 10px; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .2px; }
  /*
   * 「群信息」折叠按钮。
   *
   * 顶部原来堆了成员、四个操作按钮、项目框、邀请框，把对话区挤得只剩一条缝。
   * 现在默认只留一行摘要，要看细节再展开。
   */
  .morebtn { margin-left: auto; font-size: 11px; padding: 3px 10px; border-radius: 999px;
    border: 1px solid var(--line); background: transparent; color: var(--muted);
    cursor: pointer; font-family: inherit; }
  .morebtn:hover { color: var(--accent); border-color: var(--accent); }
  .morebtn.on { color: var(--accent); border-color: var(--accent); }
  /* 一行摘要：成员 + 项目，超长省略，绝不换行堆高 */
  .peek { margin-top: 6px; font-size: 11.5px; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .drawer { margin-top: 8px; }
  .pill { font-size: 11px; padding: 2px 10px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .pill.on { background: var(--vscode-charts-green, #1a7f37); color: #fff; }
  .sub { margin-top: 4px; font-size: 11.5px; color: var(--muted); }
  .members { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .member { display: flex; align-items: center; gap: 7px; padding: 6px 12px 6px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; }
  /*
   * 头像按**设备**上色：每台设备一个固定色相，agent 用饱和色、用户用同色系的深色。
   *
   * 用户要求：不同设备的 agent 头像颜色不同，不同设备用户发言的头像也要不同颜色，
   * 方便区分。颜色由设备 id 稳定派生（同一台永远是同一个颜色，重启也不变）。
   */
  .avatar { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
    font-size: 11px; font-weight: 700; color: #fff; flex: none;
    box-shadow: 0 0 0 1px rgba(255,255,255,.16) inset; }
  .avatar.agent { background: hsl(var(--hue, 262) 62% 52%); }
  /* 同一台设备的用户：色相相同、明度更低，和它的 agent 一眼能配对又不混淆 */
  .avatar.user { background: hsl(var(--hue, 262) 55% 34%); }
  /* 本机一律加一圈白边，先分清"我这边"和"对面" */
  .avatar.local { box-shadow: 0 0 0 2px var(--vscode-foreground), 0 0 0 1px rgba(255,255,255,.16) inset; }
  .member small { color: var(--muted); font-size: 10.5px; }
  .toolbar { display: flex; gap: 8px; margin-top: 12px; }
  .toolbar button { font-size: 11.5px; padding: 4px 10px; border-radius: 6px; cursor: pointer; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.16)); border: 1px solid transparent; }
  .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.28)); }

  /* 待回答提醒 */
  .banner { display: none; position: relative; margin: 14px 20px 0; padding: 12px 14px; border-radius: var(--radius); font-size: 12.5px; background: var(--vscode-inputValidation-warningBackground, rgba(215,166,0,.14)); border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(215,166,0,.5)); }
  .banner b { display: block; margin-bottom: 3px; padding-right: 22px; }
  /* 不想回答 / 另有安排时收起来，不占地方（用户 2026-11-24 要求） */
  .banner-close { position: absolute; top: 6px; right: 8px; width: 22px; height: 22px; line-height: 1;
    border: 0; border-radius: 6px; background: transparent; color: inherit; opacity: .6;
    font-size: 15px; cursor: pointer; font-family: inherit; }
  .banner-close:hover { opacity: 1; background: rgba(128,128,128,.25); }
  /* 现成答案（可点）+ 自定义回答提示：追问本来大多是二选一，让甲方手打整句不合理 */
  .banner-opts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .banner-opts button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(215,166,0,.6));
    background: transparent; color: inherit; }
  .banner-opts button:hover { background: var(--vscode-inputValidation-warningBorder, rgba(215,166,0,.35)); }
  .banner-hint { margin-top: 6px; font-size: 11px; opacity: .75; }
  /*
   * 追问正文默认**只显示前三行**（用户 2026-11-25：「这个消息这么长一块消息」——
   * agent 一次问好几段，提醒条能占满半个窗口，反而看不到群里的对话）。
   * 展开后最多占 40% 高度，自己滚动，绝不再把整个界面顶下去。
   */
  .banner-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden; white-space: pre-wrap; word-break: break-word; }
  .banner-text.open { display: block; -webkit-line-clamp: unset; overflow: auto; max-height: 40vh; }
  .banner-more { margin-top: 6px; padding: 0; border: 0; background: transparent; color: inherit;
    font: inherit; font-size: 11px; opacity: .8; cursor: pointer; text-decoration: underline; }
  .banner-more:hover { opacity: 1; }

  /* 消息区 */
  main { flex: 1; overflow-y: auto; padding: 14px 16px 18px; }
  .divider { display: flex; align-items: center; gap: 10px; margin: 18px 0 12px; font-size: 11px; color: var(--muted); }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .msg { display: flex; gap: 8px; margin-bottom: 12px; }
  .msg.user { flex-direction: row-reverse; }
  .bubble { max-width: min(80%, 680px); padding: 9px 12px; border-radius: var(--radius); background: var(--vscode-editorWidget-background, rgba(128,128,128,.10)); border: 1px solid var(--line); white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .msg.user .bubble { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .meta { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 10.5px;
    color: var(--vscode-foreground); opacity: .7; }
  .msg.user .meta { justify-content: flex-end; }
  /*
   * 用户气泡是**实心按钮色**：里面所有文字都必须跟着气泡前景色走。
   *
   * 用户实况：蓝色气泡里那行「需求 · 设备 · 甲方 · 21:13」几乎看不见 ——
   * 因为它用的是 descriptionForeground，那是给编辑器背景配的，压在按钮色上对比度不够。
   * 这里统一用 button-foreground，再用透明度分层，浅色 / 深色主题都清楚。
   */
  .msg.user .bubble,
  .msg.user .bubble .meta,
  .msg.user .bubble .tag { color: var(--vscode-button-foreground, #fff); }
  .msg.user .bubble .meta { opacity: .82; }
  .msg.user .bubble .tag { opacity: .9; border-color: currentColor; }
  /* 气泡上的指派对象：一眼看出这条发给了哪台。 */
  .meta .assignee { padding: 0 6px; border-radius: 999px; border: 1px solid currentColor; opacity: .9; }
  .tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; opacity: .9; }
  .tag.analysis { color: var(--vscode-charts-blue, #4a8fe0); }
  .tag.question { color: var(--vscode-charts-yellow, #d7a600); font-weight: 700; }
  .tag.confirm { color: var(--vscode-charts-orange, #d97706); }
  .tag.progress { color: var(--vscode-charts-purple, #9a6ee0); }
  .tag.result { color: var(--vscode-charts-green, #1a7f37); font-weight: 700; }
  .tag.requirement { color: inherit; opacity: .75; }
  /* 队友之间的往来：和群发言同一条时间线，用橙色标签 + 虚线气泡区分。 */
  .tag.note { color: var(--vscode-charts-orange, #d97706); }
  .bubble.note { border-style: dashed; opacity: .92; }
  .bubble.question { border-color: var(--vscode-charts-yellow, #d7a600); }
  /*
   * 富文本（markdown）样式：气泡里现在是结构化的内容，不是一整段等宽文字。
   * 用户要求「和飞书 / 微信 / copilotchat 一样能多种方式输出」。
   */
  .bubble .md { white-space: normal; }
  .bubble .md > *:first-child { margin-top: 0; }
  .bubble .md > *:last-child { margin-bottom: 0; }
  .bubble .md p { margin: 0 0 8px; }
  .bubble .md h1, .bubble .md h2, .bubble .md h3,
  .bubble .md h4, .bubble .md h5, .bubble .md h6 { margin: 12px 0 6px; font-weight: 600; line-height: 1.35; }
  .bubble .md h1 { font-size: 15px; } .bubble .md h2 { font-size: 14px; } .bubble .md h3 { font-size: 13.5px; }
  .bubble .md h4, .bubble .md h5, .bubble .md h6 { font-size: 13px; }
  .bubble .md ul, .bubble .md ol { margin: 4px 0 8px; padding-left: 20px; }
  .bubble .md li { margin: 2px 0; }
  .bubble .md blockquote { margin: 6px 0; padding: 2px 0 2px 10px; border-left: 3px solid var(--line); opacity: .85; }
  .bubble .md hr { border: 0; border-top: 1px solid var(--line); margin: 10px 0; }
  .bubble .md a { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; }
  .bubble .md a:hover { text-decoration: underline; }
  .msg.user .bubble .md a { color: inherit; text-decoration: underline; }
  .bubble .md code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
    padding: 1px 4px; border-radius: 4px; background: rgba(128,128,128,.22); }
  .bubble .md pre { margin: 6px 0; padding: 8px 10px; overflow-x: auto; border-radius: 8px;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,.18)); }
  .bubble .md pre code { padding: 0; background: transparent; font-size: 12px; line-height: 1.5; }
  .md-code { margin: 6px 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .md-code-head { display: flex; align-items: center; gap: 8px; padding: 3px 8px;
    background: rgba(128,128,128,.14); font-size: 11px; }
  .md-code-lang { opacity: .75; }
  .md-copy { margin-left: auto; border: 0; border-radius: 4px; padding: 1px 8px; cursor: pointer;
    font: inherit; font-size: 11px; background: transparent; color: inherit; opacity: .8; }
  .md-copy:hover { opacity: 1; background: rgba(128,128,128,.25); }
  .md-table-wrap { margin: 6px 0; overflow-x: auto; }
  .md-table { border-collapse: collapse; font-size: 12px; }
  .md-table th, .md-table td { border: 1px solid var(--line); padding: 3px 8px; text-align: left; }
  .md-table th { background: rgba(128,128,128,.14); font-weight: 600; }
  .md-img { max-width: 100%; border-radius: 6px; }
  /* 结构化元信息（项目 / 用时 / 改动文件 / 被停止）：小标签，不再是正文里的括号文字 */
  /*
   * 每台设备的 agent 状态灯（替换原来的操作提示文案）。
   *
   * 用户 2026-11-25：「团队群需要能显示设备 agent 运行状态……正常运行中显示成闪动频率
   * 合适的绿色圆点、运行结束显示成灰色圆点、异常中断显示成红色圆点、需要确认卡住了
   * 就显示闪动的黄色圆点」。
   */
  .agent-status { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px;
    font-size: 11px; line-height: 1.5; color: var(--muted); }
  .agent-status .who { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .agent-status .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: #8b949e; }
  .agent-status .dot.running { background: #3fb950; animation: agent-pulse 1.6s ease-in-out infinite; }
  .agent-status .dot.waiting { background: #d7a600; animation: agent-pulse 1.1s ease-in-out infinite; }
  .agent-status .dot.error { background: #f85149; }
  .agent-status .dot.idle { background: #8b949e; }
  @keyframes agent-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.86); } }
  @media (prefers-reduced-motion: reduce) {
    .agent-status .dot.running, .agent-status .dot.waiting { animation: none; }
  }
  /* 气泡上的「复制」：小、淡，鼠标移上去才明显 */
  .meta .msg-copy { margin-left: auto; border: 0; background: transparent; color: inherit; opacity: .55;
    font: inherit; font-size: 10.5px; padding: 0 4px; cursor: pointer; }
  .msg:hover .meta .msg-copy { opacity: .9; }
  .meta .msg-copy:hover { background: rgba(128,128,128,.22); border-radius: 4px; }
  /* 群里的附件：图片直接显示，文件是一行小卡片 */
  .msg-assets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .msg-image { max-width: 240px; max-height: 180px; border-radius: 8px; border: 1px solid var(--line); cursor: zoom-in; }
  .msg-file { padding: 3px 8px; border-radius: 8px; border: 1px solid var(--line); font-size: 11px; opacity: .85; }
  /* 已读 / 等待确认：气泡下方的细字，不抢正文 */
  .receipt { margin-top: 5px; font-size: 10.5px; opacity: .72; }
  .receipt-unread { color: #e0a33e; opacity: .95; }
  .receipt.pending { opacity: .5; font-style: italic; }
  /*
   * 麦克风周围那圈安装进度（装了 VS Code Speech 才会出现）。
   * 一次性特效：安装中转圈填充 → 装好闭环、亮 3 秒 → 由脚本移除节点。
   */
  .tool.has-ring { position: relative; }
  .voice-ring {
    position: absolute; inset: -3px; width: calc(100% + 6px); height: calc(100% + 6px);
    pointer-events: none; transform: rotate(-90deg); overflow: visible;
  }
  .voice-ring circle { fill: none; stroke-width: 6; }
  .voice-ring .track { stroke: rgba(46, 204, 113, .18); }
  .voice-ring .bar {
    stroke: #2ecc71; stroke-linecap: round;
    stroke-dasharray: 100; stroke-dashoffset: 100;
    transition: stroke-dashoffset .35s ease-out;
  }
  .voice-ring.installing .bar { animation: voice-ring-fill 22s cubic-bezier(.2, .7, .3, 1) forwards; }
  .voice-ring.ready .bar {
    stroke-dashoffset: 0;
    filter: drop-shadow(0 0 4px rgba(46, 204, 113, .85));
    animation: voice-ring-flash 3s ease-out forwards;
  }
  @keyframes voice-ring-fill { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 12; } }
  @keyframes voice-ring-flash {
    0% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: 0; }
  }
  /* 录音中：话筒图标换成跳动的音波条（用户 2026-11-25 指定的效果）。 */
  .tool.voice-recording { color: #2ecc71; display: grid; place-items: center; }
  .tool.voice-recording .ico-mic { display: none; }
  /* 细线条 + 严格收在按钮圆角矩形内部（同主对话框；尺寸用百分比，两种按钮比例一致）。 */
  .voice-bars {
    display: none; align-items: center; justify-content: center;
    width: 62%; height: 42%; gap: 15%;
    max-height: calc(100% - 16px); max-width: calc(100% - 8px);
    overflow: hidden; pointer-events: none;
    animation: voice-bars-breathe 2.2s ease-in-out infinite;
  }
  .tool.voice-recording .voice-bars { display: inline-flex; }
  /*
   * 纯绿实色条（不渐变）+ 高度按相位起伏（行进波）；
   * 明暗交给整排的透明度呼吸（黑 → 绿 → 黑），像呼吸灯。
   */
  .voice-bars i {
    display: block; flex: 0 0 8%; min-width: 1px; border-radius: 1px; height: var(--h, 100%);
    background: #3ee089;
    transform-origin: center; transform: scaleY(.45);
    animation: voice-bar-level 1.1s ease-in-out infinite var(--d, 0ms);
  }
  .voice-bars i:nth-child(1) { --h: 52%; --d: 0ms; }
  .voice-bars i:nth-child(2) { --h: 80%; --d: -220ms; }
  .voice-bars i:nth-child(3) { --h: 100%; --d: -440ms; }
  .voice-bars i:nth-child(4) { --h: 76%; --d: -660ms; }
  .voice-bars i:nth-child(5) { --h: 50%; --d: -880ms; }
  @keyframes voice-bar-level { 0%, 100% { transform: scaleY(.45); } 50% { transform: scaleY(1); } }
  @keyframes voice-bars-breathe { 0%, 100% { opacity: .1; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .voice-bars { animation: none; opacity: 1; }
    .voice-bars i { animation: none; transform: scaleY(.6); }
  }
  .msg-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; font-size: 10.5px; opacity: .75; }
  .msg-meta span { padding: 1px 7px; border-radius: 999px; background: rgba(128,128,128,.18); }
  .msg-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .msg-options button { font: inherit; font-size: 11.5px; padding: 3px 10px; border-radius: 999px;
    border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  .msg-options button:hover { background: rgba(128,128,128,.22); }  .bubble.result { border-color: var(--vscode-charts-green, #1a7f37); }
  /* 还在判定中的那句话：淡一点，表示「已发出、还没落定」。 */
  .msg.pending { opacity: .62; }
  .msg.pending .bubble { border-style: dashed; }
  .empty { margin: 40px auto; max-width: 460px; text-align: center; color: var(--muted); font-size: 12.5px; line-height: 1.9; }
  .empty b { color: var(--vscode-foreground); }

  /* 输入区 */
  footer { border-top: 1px solid var(--line); padding: 10px 16px 12px; }
  /* 「由谁执行」压成一行，不再单独占一块 */
  .assign { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
  .assign .label { margin-right: 2px; opacity: .8; }
  .assign .chip { padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line);
    background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; font-family: inherit;
    transition: color .14s ease-out, border-color .14s ease-out; }
  .assign .chip.on { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); }
  .assign .stop { margin-left: auto; border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
  /* @ 设备选择：贴在输入框上方，不遮挡对话 */
  .mention { position: absolute; left: 16px; right: 16px; bottom: 100%;
    margin-bottom: 6px; padding: 4px; border-radius: 8px; max-height: 180px; overflow-y: auto;
    background: var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-editorSuggestWidget-border, var(--line));
    box-shadow: 0 6px 18px rgba(0,0,0,.28); z-index: 20; }
  .mention .item { display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    border-radius: 5px; font-size: 12px; cursor: pointer; }
  .mention .item:hover, .mention .item.on { background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-editorSuggestWidget-selectedForeground, inherit); }
  .mention .item small { color: var(--muted); font-size: 10.5px; margin-left: auto; }
  .composer { display: flex; gap: 10px; align-items: flex-end; position: relative; }
  textarea {
    flex: 1; min-height: 52px; max-height: 40vh; resize: none; padding: 11px 13px;
    font-family: inherit; font-size: 13px; line-height: 1.5; border-radius: var(--radius);
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--line));
  }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .send { padding: 11px 22px; border: none; border-radius: var(--radius); cursor: pointer; font-size: 13px; font-weight: 600; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .send:hover { background: var(--vscode-button-hoverBackground); }
  /* 附件 / 语音按钮：和主对话框一样，工具箱不该只在主对话里有 */
  .tool { width: 34px; min-width: 34px; height: 34px; padding: 0; border-radius: 8px; cursor: pointer;
    font-size: 15px; line-height: 1; border: 1px solid var(--line); background: transparent;
    color: var(--vscode-foreground); }
  .tool:hover { background: rgba(128,128,128,.2); }
  .tool.active { border-color: var(--vscode-focusBorder); color: var(--vscode-focusBorder); }
  .tool svg { display: block; margin: 0 auto; }
  /* 录音中：外圈轻微脉冲，只动颜色与光晕，不做位移 */
  .tool.active .ico-mic { animation: mic-pulse 1.2s ease-in-out infinite; }
  @keyframes mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
  .attach-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px 2px; }
  .attach-chip { display: flex; align-items: center; gap: 6px; max-width: 240px; padding: 3px 6px 3px 8px;
    border-radius: 8px; font-size: 11.5px; background: rgba(128,128,128,.16); border: 1px solid var(--line); }
  .attach-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attach-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 13px; opacity: .7; }
  .attach-chip button:hover { opacity: 1; }
  .hint { margin-top: 8px; font-size: 11px; color: var(--muted); }
  .board { border-bottom: 1px solid var(--line); padding: 8px 16px; background: var(--panel2); }
  .board-head { display: flex; gap: 8px; align-items: baseline; font-size: 12px; cursor: pointer; }
  .board-head span { color: var(--muted); font-size: 11px; }
  .board-head .chev { display: inline-block; transition: transform .15s ease-out; }
  .board.open .board-head .chev { transform: rotate(90deg); }
  .board.open .board-head { margin-bottom: 8px; }
  .board:not(.open) .board-cols { display: none; }
  .board-cols { display: flex; gap: 10px; overflow-x: auto; }
  .board-col { min-width: 170px; flex: 0 0 auto; }
  .board-col > b { display: block; font-size: 11px; color: var(--muted); margin-bottom: 5px; }
  .task { border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; margin-bottom: 6px; background: var(--panel); }
  .task .t { font-size: 12px; line-height: 1.35; margin-bottom: 3px; }
  .task .m { font-size: 10px; color: var(--muted); }
  .task .badge { display: inline-block; font-size: 9px; padding: 0 5px; border-radius: 999px; border: 1px solid var(--line); margin-right: 4px; }
  /* 邀请码：一直摆在窗口里，不靠一闪而过的通知 */
  .invite { display: none; margin: 10px 0 0; padding: 10px 12px; border: 1px solid var(--accent);
    border-radius: 8px; background: var(--accent-soft); }
  /* 收起状态：只留一行，不占地方 */
  .invite.collapsed { padding: 6px 12px; }
  .invite.collapsed .v { display: none; }
  .invite .k { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .invite .k:hover { color: var(--accent); }
  .invite .chev { display: inline-block; transition: transform .15s ease-out; }
  .invite.collapsed .chev { transform: rotate(-90deg); }
  .invite .v { display: flex; align-items: center; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
  .invite .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 22px; font-weight: 700;
    letter-spacing: 3px; color: var(--accent); user-select: all; }
  .invite .how { font-size: 11px; color: var(--muted); }
  /* 每台设备一行的项目列表：谁在做哪个项目，一眼看清 */
  .prow { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr) minmax(0, auto);
    gap: 8px; align-items: baseline; padding: 3px 0; font-size: 12px; }
  .prow + .prow { border-top: 1px dashed var(--line); }
  .prow .pwho { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .prow .pname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prow .how { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .invite button { font-size: 11px; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--accent);
    background: transparent; color: var(--accent); cursor: pointer;
    transition: background-color .14s ease-out, color .14s ease-out, transform .1s ease-out; }
  .invite button:hover { background: var(--accent); color: #fff; }
  /* 按下立刻有回应：以前点「复制邀请码」完全没反馈，用户以为没生效 */
  .invite button:active { transform: translateY(1px) scale(.97); filter: brightness(.9); }
  .invite button.copied { background: var(--ok, #34d399); border-color: var(--ok, #34d399); color: #06231a; }
</style></head>
<body>
<header>
  <div class="row1">
    <h1>团队群</h1>
    <span class="pill" id="status">未连接</span>
    <button class="morebtn" id="moreBtn" title="展开/收起群信息">群信息</button>
  </div>
  <div class="peek" id="peek"></div>
  <div class="drawer" id="drawer" style="display:none">
    <div class="sub" id="sub">在这个窗口说需求，群里的 agent 先解析、必要时追问，达成一致后才动手。</div>
    <div class="members" id="members"></div>
    <div class="toolbar">
      <button data-command="hwchat.lanSync.openLedger">对齐账本</button>
      <button data-command="hwchat.lanSync.status">连接状态</button>
      <button data-command="hwchat.lanSync.switchPeerProject">换项目</button>
      <button data-command="hwchat.lanSync.advanced">高级设置</button>
    </div>
    <div class="invite" id="projectBox">
      <div class="k">每台设备在做的项目</div>
      <div class="v" id="projectRows"></div>
    </div>
    <div class="invite" id="invite">
      <div class="k" id="inviteToggle">
        <span class="chev">▾</span>
        <span>把这台电脑的邀请码给对方，另一台点「加入群聊」填进来</span>
        <button id="copyInviteInline" style="margin-left:auto">复制</button>
      </div>
      <div class="v">
        <span class="code" id="inviteCode"></span>
        <button id="copyInvite">复制邀请码</button>
        <span class="how" id="inviteHow"></span>
      </div>
    </div>
  </div>
  <div class="banner" id="versionWarn" style="display:none"></div>
  <div class="banner" id="projectWarn" style="display:none"></div>
</header>
<div class="banner" id="banner"><b id="bannerWho">乙方在等你回答</b><button class="banner-close" id="bannerClose" type="button" title="先不回答（收起这条提醒）">×</button><div class="banner-text" id="bannerText"></div><button class="banner-more" id="bannerMore" type="button">展开全文</button><div class="banner-opts" id="bannerOpts"></div><div class="banner-hint" id="bannerHint"></div></div>
<section id="board" class="board" style="display:none">
  <div class="board-head" id="boardHead"><span class="chev">▸</span><b>任务看板</b><span id="boardHint"></span></div>
  <div class="board-cols" id="boardCols"></div>
</section>
<main id="feed"></main>
<footer>
  <div class="assign" id="assign"></div>
  <!-- 已选附件（图片/文件）：发出去前能看到、能删 -->
  <div class="attach-list" id="attachList" style="display:none"></div>
  <div class="composer">
    <div class="mention" id="mention" style="display:none"></div>
    <input type="file" id="fileInput" multiple style="display:none"
      accept="image/*,application/pdf,text/*,.md,.json,.log,.csv,.zip">
    <button class="tool" id="attachBtn" type="button" title="添加图片或文件（也可以直接粘贴图片）"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg></button>
    <button class="tool" id="voiceBtn" type="button" title="语音输入"><svg class="ico-mic" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.6" width="4" height="7.2" rx="2"/><path d="M4.2 7.4a3.8 3.8 0 0 0 7.6 0M8 11.2v2.4"/></svg></button>
    <textarea id="text" rows="2" placeholder="说需求，或回答乙方的追问… 输入 @ 指定设备"></textarea>
    <button class="send" id="send">发送</button>
  </div>
  <div class="agent-status" id="agentStatus"></div>
</footer>
<script nonce="${nonce}" src="${richScript}"></script>
<script nonce="${nonce}" src="${groupScript}"></script>
</body></html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    for (const disposable of this.disposables) disposable.dispose();
  }
}
