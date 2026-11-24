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

import * as vscode from 'vscode';
import type { LanSyncService } from '../sync/lanSync';
import { groupSpeaker, platformLabel, type SyncGroupMessage, type SyncPeer } from '../sync/lanProtocol';
import { TASK_STATUS_LABEL, buildTaskBoard, groupTasksByStatus } from '../sync/tasks';

const PHASE_LABEL: Record<string, string> = {
  requirement: '需求',
  analysis: '解析',
  question: '追问',
  answer: '甲方回复',
  confirm: '确认',
  progress: '进度',
  result: '结果',
};

/** 群窗口里一条发言的紧凑描述（测试直接钉这段）。 */
export function compactGroupLine(message: SyncGroupMessage, now = Date.now()): {
  who: string;
  phase: string;
  body: string;
  time: string;
  /** 甲方在自己这边（右侧气泡），乙方在左侧。 */
  side: 'user' | 'agent';
  phaseKey: string;
} {
  const at = new Date(message.at);
  const sameDay = new Date(now).toDateString() === at.toDateString();
  return {
    who: groupSpeaker(message),
    phase: PHASE_LABEL[message.phase] ?? message.phase,
    body: message.body.replace(/\s+/g, ' ').trim(),
    time: sameDay
      ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
      : `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
    side: message.author === 'user' ? 'user' : 'agent',
    phaseKey: message.phase,
  };
}

export interface GroupHeaderInput {
  role: string;
  relay?: { connected: boolean; peers: number; url: string };
  /** 除本机以外的设备数：从机要确认「主机真的在」才敢说已连接。 */
  peerCount?: number;
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
    if (members !== undefined && members < 1) {
      return {
        status: '群聊已开 · 等对方加入',
        sub: '把邀请码复制给对方，让对方点「加入群聊」粘贴进来。两台加入后，在这个窗口说的话两边 agent 会一起做。',
        on: false,
      };
    }
    return {
      status: members === undefined ? '群聊中' : `群聊中 · ${members + 1} 台设备`,
      sub: '每台设备上有一位甲方（你）和一个乙方（agent）。你在哪天说需求都行，群里的乙方先解析、必要时追问，达成一致后才动手。',
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
      send: (text: string, assignee?: { id: string; name: string }) => Promise<void>;
      /** 远程控制：目前只用到「停止当前执行」。 */
      control?: (action: 'stop') => Promise<{ ok: boolean; message: string }>;
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
    const panel = vscode.window.createWebviewPanel(
      'hwchat.teamGroup',
      '团队群',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.extensionUri] },
    );
    this.panel = panel;
    panel.webview.html = this.html(panel.webview);
    this.disposables.push(panel.webview.onDidReceiveMessage(async (message: unknown) => {
      const record = (message ?? {}) as { type?: unknown; text?: unknown; command?: unknown; assignee?: unknown };      if (record.type === 'ready') await this.refresh();
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
        await this.callbacks.send(text, assignee);
        await this.refresh();
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
  async refresh(): Promise<void> {
    if (!this.panel) return;
    const state = this.service.groupState();
    const now = Date.now();
    const relay = this.callbacks.relay?.();
    const relayState = relay ? { connected: relay.connected, peers: relay.peers, url: relay.url } : undefined;
    await this.panel.webview.postMessage({
      type: 'state',
      role: state.role,
      relay: relayState,
      /* 邀请码（只有主机有）：一直显示在窗口顶部，并带可复制的整串。 */
      invite: this.service.currentInviteCode(),
      inviteText: this.service.currentInviteText(),
      inviteWaiting: this.service.currentInviteCode() !== '' && this.service.remotePeers().length === 0,
      header: groupHeader({
        role: state.role,
        peerCount: this.service.remotePeers().length,
        ...(relayState ? { relay: relayState } : {}),
      }),
      peers: (() => {
        const local = this.service.localPeer();
        const seen = new Map<string, { id: string; name: string; platform: string; project: string; isLocal: boolean }>();
        const add = (peer: { id: string; name: string; platform: SyncPeer['platform']; project: string }): void => {
          if (seen.has(peer.id)) return;
          seen.set(peer.id, {
            id: peer.id,
            name: peer.name,
            platform: platformLabel(peer.platform),
            project: peer.project,
            isLocal: peer.id === local.id,
          });
        };
        add(local);
        for (const peer of state.peers) add(peer);
        // 中继上的设备不在局域网 peer 列表里，但它们在群里发过言 —— 按消息补出来
        for (const message of state.messages) add(message.from);
        return [...seen.values()];
      })(),
      openQuestion: state.openQuestion?.body ?? '',
      /** 「由谁执行」候选：中继在线设备；没接中继时为空（只能本机做）。 */
      devices: (() => {
        const local = this.service.localPeer();
        const list = this.callbacks.relay?.()?.devices ?? [];
        return list.length
          ? list.map((device) => ({
            id: device.id,
            name: device.name,
            project: device.project,
            isLocal: device.id === local.id,
          }))
          : [];
      })(),
      canStop: state.role !== 'off' || Boolean(this.callbacks.relay?.()?.connected),
      taskGroups: groupTasksByStatus(buildTaskBoard(state.messages)).map((group) => ({
        status: group.status,
        label: TASK_STATUS_LABEL[group.status],
        tasks: group.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          project: task.project,
          assigneeName: task.assignee
            ? (state.peers.find((peer) => peer.id === task.assignee)?.name ?? task.assignee)
            : '',
          lastLine: task.lastLine,
        })),
      })),
      lines: state.messages.map((message) => ({
        ...compactGroupLine(message, now),
        requirementId: message.requirementId,
        // 结果/未执行要保留换行：压成一行会把「改了哪些文件」挤成不可读的长句
        full: message.body.slice(0, 2_000),
      })),
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = [...Array(32)].map(() => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;`;
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
  header { padding: 16px 20px 12px; border-bottom: 1px solid var(--line); }
  .row1 { display: flex; align-items: center; gap: 10px; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .2px; }
  .pill { margin-left: auto; font-size: 11px; padding: 2px 10px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .pill.on { background: var(--vscode-charts-green, #1a7f37); color: #fff; }
  .sub { margin-top: 4px; font-size: 11.5px; color: var(--muted); }
  .members { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .member { display: flex; align-items: center; gap: 7px; padding: 6px 12px 6px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; }
  .avatar { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; flex: none; }
  .avatar.user { background: var(--vscode-charts-blue, #1a6dd6); }
  .avatar.agent { background: var(--vscode-charts-purple, #7a3fd6); }
  .member small { color: var(--muted); font-size: 10.5px; }
  .toolbar { display: flex; gap: 8px; margin-top: 12px; }
  .toolbar button { font-size: 11.5px; padding: 4px 10px; border-radius: 6px; cursor: pointer; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.16)); border: 1px solid transparent; }
  .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.28)); }

  /* 待回答提醒 */
  .banner { display: none; margin: 14px 20px 0; padding: 12px 14px; border-radius: var(--radius); font-size: 12.5px; background: var(--vscode-inputValidation-warningBackground, rgba(215,166,0,.14)); border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(215,166,0,.5)); }
  .banner b { display: block; margin-bottom: 3px; }

  /* 消息区 */
  main { flex: 1; overflow-y: auto; padding: 18px 20px 24px; }
  .divider { display: flex; align-items: center; gap: 10px; margin: 22px 0 14px; font-size: 11px; color: var(--muted); }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .msg { display: flex; gap: 10px; margin-bottom: 16px; }
  .msg.user { flex-direction: row-reverse; }
  .bubble { max-width: min(78%, 720px); padding: 10px 14px; border-radius: var(--radius); background: var(--vscode-editorWidget-background, rgba(128,128,128,.10)); border: 1px solid var(--line); white-space: pre-wrap; word-break: break-word; }
  .msg.user .bubble { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .meta { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 10.5px; color: var(--muted); }
  .msg.user .meta { justify-content: flex-end; }
  .tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; opacity: .9; }
  .tag.analysis { color: var(--vscode-charts-blue, #4a8fe0); }
  .tag.question { color: var(--vscode-charts-yellow, #d7a600); font-weight: 700; }
  .tag.confirm { color: var(--vscode-charts-orange, #d97706); }
  .tag.progress { color: var(--vscode-charts-purple, #9a6ee0); }
  .tag.result { color: var(--vscode-charts-green, #1a7f37); font-weight: 700; }
  .tag.requirement { color: inherit; opacity: .75; }
  .bubble.question { border-color: var(--vscode-charts-yellow, #d7a600); }
  .bubble.result { border-color: var(--vscode-charts-green, #1a7f37); }
  .empty { margin: 40px auto; max-width: 460px; text-align: center; color: var(--muted); font-size: 12.5px; line-height: 1.9; }
  .empty b { color: var(--vscode-foreground); }

  /* 输入区 */
  footer { border-top: 1px solid var(--line); padding: 12px 20px 16px; }
  .assign { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
  .assign .label { margin-right: 2px; }
  .assign .chip { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line);
    background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; font-family: inherit; }
  .assign .chip.on { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); }
  .assign .stop { margin-left: auto; border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
  .composer { display: flex; gap: 10px; align-items: flex-end; }
  textarea {
    flex: 1; min-height: 52px; max-height: 40vh; resize: none; padding: 11px 13px;
    font-family: inherit; font-size: 13px; line-height: 1.5; border-radius: var(--radius);
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--line));
  }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .send { padding: 11px 22px; border: none; border-radius: var(--radius); cursor: pointer; font-size: 13px; font-weight: 600; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .send:hover { background: var(--vscode-button-hoverBackground); }
  .hint { margin-top: 8px; font-size: 11px; color: var(--muted); }
  .board { border-bottom: 1px solid var(--line); padding: 10px 16px; background: var(--panel2); }
  .board-head { display: flex; gap: 10px; align-items: baseline; font-size: 12px; margin-bottom: 8px; }
  .board-head span { color: var(--muted); font-size: 11px; }
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
  .invite .k { font-size: 11px; color: var(--muted); }
  .invite .v { display: flex; align-items: center; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
  .invite .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 22px; font-weight: 700;
    letter-spacing: 3px; color: var(--accent); user-select: all; }
  .invite .how { font-size: 11px; color: var(--muted); }
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
  </div>
  <div class="sub" id="sub">在这个窗口说需求，群里的 agent 先解析、必要时追问，达成一致后才动手。</div>
  <div class="members" id="members"></div>
  <div class="toolbar">
    <button data-command="hwchat.lanSync.openLedger">对齐账本</button>
    <button data-command="hwchat.lanSync.status">连接状态</button>
    <button data-command="hwchat.lanSync.advanced">高级设置</button>
  </div>
  <div class="invite" id="invite">
    <div class="k">把这台电脑的邀请码给对方，另一台点「加入群聊」填进来</div>
    <div class="v">
      <span class="code" id="inviteCode"></span>
      <button id="copyInvite">复制邀请码</button>
      <span class="how" id="inviteHow"></span>
    </div>
  </div>
</header>
<div class="banner" id="banner"><b>乙方在等你回答</b><span id="bannerText"></span></div>
<section id="board" class="board" style="display:none">
  <div class="board-head"><b>任务看板</b><span id="boardHint"></span></div>
  <div class="board-cols" id="boardCols"></div>
</section>
<main id="feed"></main>
<footer>
  <div class="assign" id="assign"></div>
  <div class="composer">
    <textarea id="text" rows="2" placeholder="说需求，或回答乙方的追问…"></textarea>
    <button class="send" id="send">发送</button>
  </div>
  <div class="hint">Enter 发送 · Shift+Enter 换行 · 选「所有人」= 频道内每台设备都做，选某台设备 = 只有它做</div>
</footer>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const el = (id) => document.getElementById(id);
const feed = el('feed'), members = el('members'), status = el('status'), sub = el('sub');
const banner = el('banner'), bannerText = el('bannerText'), text = el('text');

function avatar(who, side) {
  const node = document.createElement('div');
  node.className = 'avatar ' + side;
  // 角色固定：用户=甲方，agent=乙方。不按平台取首字母，否则每个方块都是 W/M。
  node.textContent = side === 'user' ? '甲' : '乙';
  return node;
}

let boardCollapsed = false;
/** 当前选中的执行设备；null = 所有人（旧行为）。 */
let assignee = null;
function renderBoard(groups) {
  const board = el('board'), cols = el('boardCols'), hint = el('boardHint');
  const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  if (!total) { board.style.display = 'none'; return; }
  board.style.display = 'block';
  const head = board.querySelector('.board-head b');
  head.onclick = () => {
    boardCollapsed = !boardCollapsed;
    cols.style.display = boardCollapsed ? 'none' : 'flex';
    paintHint();
  };
  function paintHint() {
    hint.textContent = total + ' 条' + (boardCollapsed ? ' · 已折叠' : ' · 点击标题折叠');
  }
  paintHint();
  cols.style.display = boardCollapsed ? 'none' : 'flex';
  cols.textContent = '';
  for (const group of groups) {
    const col = document.createElement('div');
    col.className = 'board-col';
    const headNode = document.createElement('b');
    headNode.textContent = group.label + ' · ' + group.tasks.length;
    col.appendChild(headNode);
    for (const task of group.tasks) {
      const card = document.createElement('div');
      card.className = 'task';
      const title = document.createElement('div');
      title.className = 't';
      title.textContent = task.title;
      card.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'm';
      const parts = [];
      if (task.project) parts.push(task.project);
      parts.push(task.assigneeName ? '指派：' + task.assigneeName : '未指派');
      meta.textContent = parts.join(' · ');
      card.appendChild(meta);
      if (task.lastLine) {
        const last = document.createElement('div');
        last.className = 'm';
        last.textContent = task.lastLine;
        card.appendChild(last);
      }
      col.appendChild(card);
    }
    cols.appendChild(col);
  }
}

function render(state) {
  const head = state.header || { status: '未连接', sub: '', on: false };
  status.textContent = head.status;
  status.classList.toggle('on', head.on);
  sub.textContent = head.sub;

  /*
   * 邀请码：主机才显示，一直挂在窗口顶部。
   *
   * 用户之前只能在「右下角一闪而过」的通知里看到它，错过就得重开群（码会变）。
   * 这里同时给出可复制的整串（带地址），对方粘贴即可，不依赖广播。
   */
  const inviteBox = el('invite');
  const inviteText = state.inviteText || '';
  if (inviteText) {
    inviteBox.style.display = 'block';
    el('inviteCode').textContent = state.invite || '';
    el('inviteHow').textContent = state.inviteWaiting
      ? '正在等对方填码…（点「复制邀请码」把整串发给对方）'
      : '';
    inviteBox.dataset.text = inviteText;
  } else {
    inviteBox.style.display = 'none';
  }

  members.textContent = '';
  for (const peer of state.peers) {
    const node = document.createElement('div');
    node.className = 'member';
    node.appendChild(avatar(peer.name, 'agent'));
    const label = document.createElement('span');
    label.textContent = peer.name;
    /*
     * 每台设备上都有一位甲方（用户）和一个乙方（agent）。
     * 标清角色，用户才不会以为另一台只有"一台机器"在跟他协作。
     */
    const tag = document.createElement('small');
    tag.textContent = peer.isLocal ? '本机 · 甲方(你) + 乙方' : '队友 · 甲方 + 乙方';
    node.appendChild(label);
    node.appendChild(tag);
    members.appendChild(node);
  }

  if (state.openQuestion) { banner.style.display = 'block'; bannerText.textContent = state.openQuestion; }
  else banner.style.display = 'none';

  renderBoard(state.taskGroups || []);
  renderAssign(state);

  feed.textContent = '';
  let lastRequirement = '';
  for (const line of state.lines) {
    if (line.phaseKey === 'requirement' && line.requirementId !== lastRequirement) {
      lastRequirement = line.requirementId;
      const divider = document.createElement('div');
      divider.className = 'divider';
      divider.textContent = '需求 ' + line.requirementId.slice(0, 12);
      feed.appendChild(divider);
    }
    const row = document.createElement('div');
    row.className = 'msg ' + line.side;
    row.appendChild(avatar(line.who, line.side));
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + line.phaseKey;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const tag = document.createElement('span');
    tag.className = 'tag ' + line.phaseKey;
    tag.textContent = line.phase;
    const who = document.createElement('span');
    who.textContent = line.who;
    const time = document.createElement('span');
    time.textContent = line.time;
    meta.appendChild(tag); meta.appendChild(who); meta.appendChild(time);
    const body = document.createElement('div');
    body.textContent = (line.phaseKey === 'result' || line.phaseKey === 'blocked')
      ? (line.full || line.body)
      : line.body;
    bubble.appendChild(meta);
    bubble.appendChild(body);
    row.appendChild(bubble);
    feed.appendChild(row);
  }
  if (!state.lines.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<b>群里还没有发言</b><br>在下面发一条需求，频道里的乙方会各自给出解析；<br>有不清楚的地方它们会追问，你回答后才会开始动手。';
    feed.appendChild(empty);
  }
  feed.scrollTop = feed.scrollHeight;
}

function renderAssign(state) {
  const box = el('assign');
  box.textContent = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = '由谁执行';
  box.appendChild(label);

  const chips = [{ id: null, name: '所有人' }, ...(state.devices || [])];
  // 选中的设备掉线了就退回「所有人」，否则会发出一条谁都接不到的需求
  if (assignee && !chips.some((item) => item.id === assignee.id)) assignee = null;
  for (const item of chips) {
    const chip = document.createElement('button');
    chip.className = 'chip' + ((assignee ? assignee.id : null) === item.id ? ' on' : '');
    chip.textContent = item.id === null ? item.name : (item.name + (item.isLocal ? '（本机）' : ''));
    chip.addEventListener('click', () => {
      assignee = item.id === null ? null : { id: item.id, name: item.name };
      renderAssign(state);
    });
    box.appendChild(chip);
  }

  if (state.canStop) {
    const stop = document.createElement('button');
    stop.className = 'chip stop';
    stop.textContent = '停止执行';
    stop.addEventListener('click', () => vscode.postMessage({ type: 'control', command: 'stop' }));
    box.appendChild(stop);
  }
}

function send() {
  const value = text.value.trim();
  if (!value) return;
  text.value = '';
  autosize();
  vscode.postMessage({ type: 'send', text: value, assignee: assignee || undefined });
}

function autosize() {
  text.style.height = 'auto';
  text.style.height = Math.min(text.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
}

el('send').addEventListener('click', send);
text.addEventListener('input', autosize);
text.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
});
for (const button of document.querySelectorAll('.toolbar button')) {
  button.addEventListener('click', () => vscode.postMessage({ type: 'command', command: button.dataset.command }));
}
el('copyInvite').addEventListener('click', () => {
  const button = el('copyInvite');
  // 立刻给出可见结果：以前点了完全没反应，用户不知道复制成没成。
  button.classList.add('copied');
  button.textContent = '已复制';
  vscode.postMessage({ type: 'copyInvite', text: el('invite').dataset.text || el('inviteCode').textContent || '' });
  setTimeout(() => {
    button.classList.remove('copied');
    button.textContent = '复制邀请码';
  }, 1400);
});
window.addEventListener('message', (event) => { if (event.data?.type === 'state') render(event.data); });
vscode.postMessage({ type: 'ready' });
</script>
</body></html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    for (const disposable of this.disposables) disposable.dispose();
  }
}
