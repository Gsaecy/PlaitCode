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
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanSyncService } from '../sync/lanSync';
import { deviceLabel, groupSpeaker, platformLabel, type SyncGroupMessage, type SyncPeer } from '../sync/lanProtocol';
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

/** 群窗口里一条发言的紧凑描述（测试直接钉这段）。 */
export function compactGroupLine(message: SyncGroupMessage, now = Date.now(), roster?: readonly SyncPeer[]): {
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
    who: groupSpeaker(message, roster),
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
      const record = (message ?? {}) as {
        type?: unknown;
        text?: unknown;
        command?: unknown;
        assignee?: unknown;
        url?: unknown;
        name?: unknown;
        dataBase64?: unknown;
        attachments?: unknown;
      };
      if (record.type === 'ready') await this.refresh();
      /* 附件：存到本机临时目录，把路径带回给面板（群消息只带文字，路径给本机 agent 用）。 */
      if (record.type === 'attach' && typeof record.name === 'string' && typeof record.dataBase64 === 'string') {
        try {
          if (record.dataBase64.length > 9 * 1024 * 1024) throw new Error('附件太大');
          const safeName = record.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'attachment';
          const dir = join(tmpdir(), 'hwchat-attachments', randomUUID().slice(0, 8));
          await mkdir(dir, { recursive: true });
          const path = join(dir, safeName);
          await writeFile(path, Buffer.from(record.dataBase64, 'base64'));
          await panel.webview.postMessage({ type: 'attached', item: { name: record.name, path } });
          this.callbacks.log(`[group] 附件已保存：${path}`);
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
         * 附件：只在这台机器上落盘，路径随正文给本机 agent 用。
         * 群消息本身仍然只有文字（另一台读不到本机临时文件），所以正文里写明这一点，
         * 免得对面 agent 以为附件在它那儿。
         */
        const attachments = Array.isArray(record.attachments)
          ? record.attachments.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 20)
          : [];
        const body = attachments.length
          ? `${text}\n\n附件（本机文件，另一台看不到）：\n${attachments.map((path) => `- ${path}`).join('\n')}`
          : text;
        await this.callbacks.send(body, assignee);
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
        return `本机是 ${mine}，${others.join('；')} —— 两台行为会不一样，请把两台都更新到同一版本，并各自重载窗口（Developer: Reload Window）。`;
      })(),
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
      lines: state.messages.map((message) => ({
        ...compactGroupLine(message, now, roster),
        kind: 'group',
        requirementId: message.requirementId,
        /* 结构化附加信息：选项与元信息由界面渲染，不再写进正文。 */
        replyTo: message.replyTo ?? '',
        options: message.options ?? [],
        meta: message.meta ?? null,
        /* 谁发的：头像按设备上色，本机加白边。 */
        device: { id: message.from?.id ?? '', name: labelOf(message.from), isLocal: message.from?.id === localId },
        // 结果/未执行要保留换行：压成一行会把「改了哪些文件」挤成不可读的长句
        full: message.body.slice(0, 2_000),
      })),
      /*
       * 两个 agent 的往来合进同一条时间线（按时间排序），标签是「队友对话」。
       * 以前这些只在账本里，界面上就是「各干各的」。
       */
      dialogue: (state.dialogue ?? []).map((note) => ({
        id: note.id,
        who: note.who,
        body: note.body,
        at: note.at,
        replyTo: note.replyTo,
      })),
      /* 刚输入、还没判定完的那句话：先画出来，判定完被正式消息替换。 */
      pending: state.pending,
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = [...Array(32)].map(() => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    // 富文本渲染（markdown）：代码块、表格、列表、链接、图片 —— 群里的发言不再是一坨纯文本。
    const richScript = mediaUri(webview, this.extensionUri, 'richtext.js');
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
  .tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; opacity: .9; }
  .tag.analysis { color: var(--vscode-charts-blue, #4a8fe0); }
  .tag.question { color: var(--vscode-charts-yellow, #d7a600); font-weight: 700; }
  .tag.confirm { color: var(--vscode-charts-orange, #d97706); }
  .tag.progress { color: var(--vscode-charts-purple, #9a6ee0); }
  .tag.result { color: var(--vscode-charts-green, #1a7f37); font-weight: 700; }
  .tag.requirement { color: inherit; opacity: .75; }
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
<div class="banner" id="banner"><b id="bannerWho">乙方在等你回答</b><button class="banner-close" id="bannerClose" type="button" title="先不回答（收起这条提醒）">×</button><span id="bannerText"></span><div class="banner-opts" id="bannerOpts"></div><div class="banner-hint" id="bannerHint"></div></div>
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
  <div class="hint">Enter 发送 · Shift+Enter 换行 · ＋ 加图片/文件 · 语音输入 · 输入 @ 选设备（不选就是所有人）</div>
</footer>
<script nonce="${nonce}" src="${richScript}"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
/* 富文本模块要往宿主发消息（复制代码 / 打开链接）；webview 里只有 vscode.postMessage 能到宿主机。 */
window.HwPost = function (message) { vscode.postMessage(message); };
const el = (id) => document.getElementById(id);
const feed = el('feed'), members = el('members'), status = el('status'), sub = el('sub');
const banner = el('banner'), bannerText = el('bannerText'), text = el('text');
/**
 * 「等你回答」提醒上的 ×：只在本机收起这条提醒。
 *
 * 用户 2026-11-24：「这种弹出提示也需要增加关闭按钮，不想回答，
 * 或另外有安排，就不用一直显示占空间」。
 */
const bannerClose = el('bannerClose');
if (bannerClose) {
  bannerClose.addEventListener('click', function () {
    const question = lastState && lastState.openQuestion;
    dismissedQuestion = question
      ? (typeof question === 'string' ? question : [question.requirementId, question.body].join('|'))
      : '';
    banner.style.display = 'none';
  });
}
/** 最近一次渲染的状态：@ 候选和正文解析都要用。 */
let lastState = null;

/**
 * 设备 id → 稳定色相（0–359）。
 *
 * 用 djb2 散列而不是随机：同一台设备每次打开、在对方窗口里，都必须是同一个颜色，
 * 否则「颜色」本身就成了新的混乱来源。
 */
function hueOf(id) {
  const text = String(id || 'unknown');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  // 避开红/橙靠得太近的一段，让相邻色相的设备也容易分辨
  const hue = hash % 300;
  return hue < 15 ? hue + 300 : hue;
}

function avatar(who, side, device) {
  const node = document.createElement('div');
  node.className = 'avatar ' + side;
  const id = device && device.id ? device.id : '';
  node.style.setProperty('--hue', String(hueOf(id)));
  if (device && device.isLocal) node.classList.add('local');
  // 角色固定：用户=甲方，agent=乙方。不按平台取首字母，否则每个方块都是 W/M。
  node.textContent = side === 'user' ? '甲' : '乙';
  node.title = device && device.name ? device.name + (device.isLocal ? '（本机）' : '') : '';
  return node;
}

let boardCollapsed = true;
/** 邀请码默认收起（等对方加入时展开一次，之后不占地方）。 */
let inviteCollapsed = false;
/** 群信息（成员 / 操作 / 项目 / 邀请码）默认收起：只留一行摘要。 */
let drawerOpen = false;
/** 被收起的那条「等你回答」提醒（只影响本机显示，不影响问题本身）。 */
let dismissedQuestion = '';
function paintInvite() {
  el('invite').classList.toggle('collapsed', inviteCollapsed);
}
function paintDrawer() {
  el('drawer').style.display = drawerOpen ? 'block' : 'none';
  el('moreBtn').classList.toggle('on', drawerOpen);
}
/** 当前选中的执行设备；null = 所有人（旧行为）。 */
let assignee = null;
/** 当前输入框开头的 @ 前缀（用于判断用户是否手动删掉了它）。 */
let lastPrefix = '';
/**
 * 设备名里的 @ token。
 *
 * 设备名形如「192.168.0.8 · darwin」，带空格和间隔号；直接塞进 @xxx 会让
 * @ 前缀在第一个空格处断开（剥离时只剩半截）。所以只取第一段并去掉空格。
 */
function mentionToken(name) {
  const first = String(name || '').split(' · ')[0];
  return first.split('·')[0].replace(/\\s+/g, '').trim();
}
/** 「由谁执行」对应的 @ 前缀：没选就是所有人。 */
function prefixFor(target) {
  return target ? '@' + mentionToken(target.name) + ' ' : '@所有人 ';
}
/**
 * 把输入框开头的 @ 前缀换成当前选中的设备。
 *
 * 用户要求：选中 A 再去打字，输入框就显示 @A；选中 B 就显示 @B；没选就是 @所有人。
 * 只改开头那一段，后面的正文原样保留。
 */
function syncPrefixToAssignee(target) {
  const prefix = prefixFor(target);
  const rest = text.value.replace(/^@[^\\s@]*\\s*/, '');
  text.value = prefix + rest;
  lastPrefix = prefix;
  autosize();
  const caret = text.value.length;
  // 有些环境（测试用的轻量 DOM）没有 setSelectionRange，别让它把整个渲染打断。
  if (typeof text.setSelectionRange === 'function') text.setSelectionRange(caret, caret);
}

/*
 * @ 选择设备。
 *
 * 用户要求：输入 @ 弹出选项；不选继续输入或删掉 @ 就消失；
 * 选中就只让那台执行；不选 = 所有人（旧行为）。
 */
let mentionItems = [];
let mentionIndex = 0;
let mentionStart = -1;
function mentionCandidates(query) {
  // @ 候选与「由谁执行」同源：都用 state.peers，不再有第二份 devices。
  const peers = (lastState && Array.isArray(lastState.peers)) ? lastState.peers : [];
  const all = [{ id: null, name: '所有人', label: '所有人', platform: '' }].concat(
    peers.map(function (peer) { return { id: peer.id, name: peer.name, label: peer.label || peer.name, isLocal: peer.isLocal }; }),
  );
  const q = String(query || '').toLowerCase();
  return all.filter(function (item) {
    return !q || String(item.name).toLowerCase().indexOf(q) >= 0
      || String(item.label).toLowerCase().indexOf(q) >= 0;
  });
}
function paintMention() {
  const box = el('mention');
  if (!mentionItems.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.textContent = '';
  mentionItems.forEach(function (item, index) {
    const row = document.createElement('div');
    row.className = 'item' + (index === mentionIndex ? ' on' : '');
    row.textContent = item.label || item.name;
    const tag = document.createElement('small');
    tag.textContent = item.id === null ? '全部设备' : (item.isLocal ? '本机' : '队友');
    row.appendChild(tag);
    row.addEventListener('mousedown', function (event) {
      event.preventDefault();
      chooseMention(item);
    });
    box.appendChild(row);
  });
}
function closeMention() {
  mentionItems = [];
  mentionStart = -1;
  el('mention').style.display = 'none';
}
function chooseMention(item) {
  if (mentionStart < 0) return;
  const before = text.value.slice(0, mentionStart);
  const after = text.value.slice(text.selectionStart);
  const inserted = item.id === null ? '@所有人 ' : '@' + mentionToken(item.name) + ' ';
  text.value = before + inserted + after;
  assignee = item.id === null ? null : { id: item.id, name: item.name };
  lastPrefix = inserted;
  closeMention();
  if (typeof text.focus === 'function') text.focus();
  const caret = (before + inserted).length;
  if (typeof text.setSelectionRange === 'function') text.setSelectionRange(caret, caret);
  autosize();
}
/** 光标前是不是一个「刚落下的 @」；是就开列表。 */
function syncMention() {
  const caret = text.selectionStart;
  const before = text.value.slice(0, caret);
  const at = before.lastIndexOf('@');
  // 删掉 @ 或者 @ 后面有空格 → 关掉（用户要求：不选继续输入就消失）
  if (at < 0) { closeMention(); return; }
  const prevOk = at === 0 || /\\s/.test(before[at - 1]);
  const query = before.slice(at + 1);
  if (!prevOk || /\\s/.test(query)) { closeMention(); return; }
  mentionStart = at;
  mentionItems = mentionCandidates(query);
  mentionIndex = 0;
  paintMention();
}
/** 句子里带了 @某台 就用它当指派对象。 */
function mentionAssignee(value) {
  const match = String(value || '').match(/@([^\\s@]+)/);
  if (!match) return null;
  const name = match[1];
  const devices = (lastState && lastState.devices) || [];
  const hit = devices.find(function (item) {
    return String(item.name).indexOf(name) >= 0 || String(item.name).split(' · ')[0] === name;
  });
  return hit ? { id: hit.id, name: hit.name } : null;
}
function renderBoard(groups) {
  const board = el('board'), cols = el('boardCols'), hint = el('boardHint');
  const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  if (!total) { board.style.display = 'none'; return; }
  board.style.display = 'block';
  board.classList.toggle('open', !boardCollapsed);
  el('boardHead').onclick = () => {
    boardCollapsed = !boardCollapsed;
    board.classList.toggle('open', !boardCollapsed);
    paintHint();
  };
  function paintHint() {
    const counts = groups.map(function (group) { return group.label + ' ' + group.tasks.length; }).join(' · ');
    hint.textContent = boardCollapsed ? counts : total + ' 条（点击标题折叠）';
  }
  paintHint();
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
      parts.push(task.assigneeName ? '指派：' + task.assigneeName : '全部设备');
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
  lastState = state;
  // 第一次渲染时给输入框写上默认的 @所有人（用户要求：默认就显示 @内容）。
  if (!text.dataset.prefixed) {
    text.dataset.prefixed = '1';
    if (!text.value.trim()) syncPrefixToAssignee(assignee);
  }
  const head = state.header || { status: '未连接', sub: '', on: false };
  status.textContent = head.status;
  status.classList.toggle('on', head.on);
  sub.textContent = head.sub;
  /*
   * 一行摘要：成员 + 项目，超长省略。
   *
   * 详细的成员卡、四个操作按钮、项目框、邀请码都在「群信息」里展开看 ——
   * 之前它们全摊在顶部，把对话区挤得只剩一条缝。
   */
  const names = state.peers.map((peer) => peer.name).join('、');
  /*
   * 摘要里先写项目名，再写仓库 ID —— 只写仓库 ID 会和「群信息」里的名字对不上，
   * 看起来像两套说法。
   */
  const projectBit = state.projectName
    ? (state.projectRepo ? state.projectName + '（' + state.projectRepo + '）' : state.projectName)
    : '';
  el('peek').textContent = [names, projectBit].filter(Boolean).join('  ·  ');
  paintDrawer();

  /*
   * 邀请码：主机才显示，一直挂在窗口顶部。
   *
   * 用户之前只能在「右下角一闪而过」的通知里看到它，错过就得重开群（码会变）。
   * 这里同时给出可复制的整串（带地址），对方粘贴即可，不依赖广播。
   */
  if (state.projectRows && state.projectRows.length) {
    const rows = el('projectRows');
    rows.textContent = '';
    for (const row of state.projectRows) {
      const line = document.createElement('div');
      line.className = 'prow';
      const who = document.createElement('span');
      who.className = 'pwho';
      who.textContent = row.isLocal ? row.device + '（本机）' : row.device;
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = row.project || '（未选）';
      const repo = document.createElement('span');
      repo.className = 'how';
      repo.textContent = row.repo || '未绑定 GitHub 仓库';
      line.appendChild(who); line.appendChild(name); line.appendChild(repo);
      rows.appendChild(line);
    }
    el('projectBox').style.display = 'block';
  } else {
    el('projectBox').style.display = 'none';
  }
  /*
   * 项目对不上时**必须醒目**。
   *
   * 真机踩过：Windows 在做 deepseek-hwchat、mac 在做 personal_workstation，
   * 两台都显示「群聊中 · 2 台设备」，看着一切正常，但任务一律被门禁拦下 ——
   * 用户只会觉得「根本没法执行任务」。
   */
  const versionWarn = el('versionWarn');
  if (state.versionWarning) {
    versionWarn.style.display = 'block';
    versionWarn.textContent = '版本不一致：' + state.versionWarning;
  } else {
    versionWarn.style.display = 'none';
  }

  const warn = el('projectWarn');
  if (state.projectMismatch) {
    warn.style.display = 'block';
    warn.textContent = '两台在做不同的项目：' + state.projectMismatch
      + '。在群里说话照常能听到、照常能回；只有「会改代码」的任务需要先对齐项目。';
  } else {
    warn.style.display = 'none';
  }

  const inviteBox = el('invite');
  const inviteText = state.inviteText || '';
  if (inviteText) {
    inviteBox.style.display = 'block';
    el('inviteCode').textContent = state.invite || '';
    el('inviteHow').textContent = state.inviteWaiting
      ? '正在等对方填码…（点「复制邀请码」把整串发给对方）'
      : '';
    inviteBox.dataset.text = inviteText;
    /*
     * 已经有人加入了就自动收起：这时邀请码没用了，不该继续占地方。
     * 用户也可以点标题自己展开/收起。
     */
    if (!state.inviteWaiting) inviteCollapsed = true;
    paintInvite();
  } else {
    inviteBox.style.display = 'none';
  }

  members.textContent = '';
  for (const peer of state.peers) {
    const node = document.createElement('div');
    node.className = 'member';
    node.appendChild(avatar(peer.label || peer.name, 'agent', peer));
    const label = document.createElement('span');
    /*
     * 统一身份标识：系统类型 · 设备名（两台同名时自动带 IP）。
     * 以前这里直接显示 peer.name，一台是「Windows」、另一台是「MagicBookV14 · win32」，
     * 看不出是同一种东西，两台都是 Windows 时更分不清。
     */
    label.textContent = peer.label || peer.name;
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

  /*
   * 追问提示条：**写清是哪台在问**，并给出可点的现成答案 + 自定义回答。
   *
   * 点选项 = 直接发出这条回答，而且只回给问话的那台（assignee），
   * 不会让群里其它 agent 也收到一份回答去重复执行。
   */
  const question = state.openQuestion;
  /*
   * 关掉的是**这条提醒**，不是把问题撤掉。
   *
   * 用户 2026-11-24：「这种弹出提示也需要增加关闭按钮，不想回答，或另外有安排，
   * 就不用一直显示占空间」。所以只在本机收起；同一台再提新问题
   * （正文变了）会重新弹出来，别人那台也不受影响。
   */
  const signature = question
    ? (typeof question === 'string' ? question : [question.requirementId, question.body].join('|'))
    : '';
  if (question && dismissedQuestion !== signature) {
    const info = typeof question === 'string' ? { body: question, askerLabel: '', options: [] } : question;
    banner.style.display = 'block';
    const whoNode = el('bannerWho');
    if (whoNode) whoNode.textContent = info.askerLabel
      ? info.askerLabel + ' 的乙方在等你回答'
      : '乙方在等你回答';
    bannerText.textContent = info.body;
    const opts = el('bannerOpts');
    if (opts) {
      opts.textContent = '';
      (info.options || []).forEach(function (option) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option;
        button.addEventListener('click', function () {
          vscode.postMessage({
            type: 'send',
            text: option,
            assignee: info.askerId ? { id: info.askerId, name: info.askerLabel || info.askerId } : undefined
          });
        });
        opts.appendChild(button);
      });
      opts.style.display = (info.options || []).length ? 'flex' : 'none';
    }
    const hintNode = el('bannerHint');
    if (hintNode) hintNode.textContent = (info.options || []).length
      ? '点一个答案直接发送；也可以在下面输入自己的回答（同样只回给这一台）。'
      : '在下面输入回答即可，只会发给提问的这一台。';
  } else {
    banner.style.display = 'none';
  }

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
    row.appendChild(avatar(line.who, line.side, line.device));
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
    /*
     * 按 markdown 渲染，而不是原样贴一大坨。
     *
     * 用户 2026-11-24：「不要用你规定的输出格式限定输出…我需要它和飞书、微信、
     * copilotchat 等对话框一样，能支持多种方式的输入输出，而不是规定死的模板」。
     */
    const bodyText = (line.phaseKey === 'result' || line.phaseKey === 'blocked')
      ? (line.full || line.body)
      : line.body;
    if (window.HwRichText) window.HwRichText.render(body, bodyText);
    else body.textContent = bodyText;
    bubble.appendChild(meta);
    bubble.appendChild(body);
    /*
     * 结构化信息（项目 / 用时 / 改动文件 / 被停止）：由界面画成小标签。
     * 以前这些是拼在正文里的「【项目 X】…用时 12s…改动文件：a、b」，
     * 看着就是程序在说话。
     */
    if (line.meta) {
      const chips = [];
      if (line.meta.stopped) chips.push('被停止');
      if (line.meta.project) chips.push(line.meta.project);
      if (typeof line.meta.seconds === 'number') chips.push('用时 ' + line.meta.seconds + 's');
      if (line.meta.files && line.meta.files.length) chips.push(line.meta.files.length + ' 个文件');
      if (chips.length) {
        const metaLine = document.createElement('div');
        metaLine.className = 'msg-meta';
        chips.forEach(function (text) {
          const chip = document.createElement('span');
          chip.textContent = text;
          metaLine.appendChild(chip);
        });
        if (line.meta.files && line.meta.files.length) metaLine.title = line.meta.files.join('\\n');
        bubble.appendChild(metaLine);
      }
    }
    /* 追问的可点答案：点了直接发出（只发给问话的那台）。 */
    if (line.options && line.options.length) {
      const opts = document.createElement('div');
      opts.className = 'msg-options';
      line.options.forEach(function (option) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option;
        button.addEventListener('click', function () {
          vscode.postMessage({
            type: 'send',
            text: option,
            assignee: line.device && line.device.id && !line.device.isLocal
              ? { id: line.device.id, name: line.device.name }
              : undefined
          });
        });
        opts.appendChild(button);
      });
      bubble.appendChild(opts);
    }
    row.appendChild(bubble);
    feed.appendChild(row);
  }
  /*
   * 两个 agent 之间的往来：单独一段，标成「队友对话」。
   *
   * 用户 2026-11-24：「没有实现两个 agent 在团队群自己沟通任务的功能，还是各干各的」。
   * 这些消息以前只进账本，界面看不到；现在照着线程显示，谁回谁一眼可见。
   */
  if (state.dialogue && state.dialogue.length) {
    const divider = document.createElement('div');
    divider.className = 'divider';
    divider.textContent = '队友之间的往来';
    feed.appendChild(divider);
    state.dialogue.forEach(function (note) {
      const row = document.createElement('div');
      row.className = 'msg agent note';
      row.appendChild(avatar(note.who, 'agent', { id: note.id, name: note.who }));
      const bubble = document.createElement('div');
      bubble.className = 'bubble analysis';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = note.replyTo ? '回复队友' : '队友对话';
      const who = document.createElement('span');
      who.textContent = note.who;
      const at = new Date(note.at);
      const time = document.createElement('span');
      time.textContent = ('0' + at.getHours()).slice(-2) + ':' + ('0' + at.getMinutes()).slice(-2);
      meta.appendChild(tag); meta.appendChild(who); meta.appendChild(time);
      const body = document.createElement('div');
      if (window.HwRichText) window.HwRichText.render(body, note.body);
      else body.textContent = note.body;
      bubble.appendChild(meta);
      bubble.appendChild(body);
      row.appendChild(bubble);
      feed.appendChild(row);
    });
  }
  if (!state.lines.length && !state.pending) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<b>群里还没有发言</b><br>在下面发一条需求，频道里的乙方会各自给出解析；<br>有不清楚的地方它们会追问，你回答后才会开始动手。';
    feed.appendChild(empty);
  }
  /*
   * 刚发出去、还在判断「这是闲聊还是任务」的那句话。
   *
   * 判断要问一次模型，一两秒；这段时间必须先看到自己说的话，
   * 否则用户会以为没发出去、又发一遍。
   */
  if (state.pending) {
    const row = document.createElement('div');
    row.className = 'msg user pending';
    row.appendChild(avatar('你', 'user', { id: state.localId, name: '你', isLocal: true }));
    const bubble = document.createElement('div');
    bubble.className = 'bubble analysis';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = '发送中';
    const who = document.createElement('span');
    who.textContent = '你';
    const time = document.createElement('span');
    time.textContent = state.pending.time || '';
    meta.appendChild(tag); meta.appendChild(who); meta.appendChild(time);
    const body = document.createElement('div');
    body.textContent = state.pending.body;
    bubble.appendChild(meta);
    bubble.appendChild(body);
    row.appendChild(bubble);
    feed.appendChild(row);
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

  /*
   * 候选**只用 state.peers**（唯一来源）。
   *
   * 以前另有一份 state.devices（先局域网再中继去重），两份数据只要一份构造出问题，
   * 这一行就整个空掉、连设备都选不了。peers 一定包含本机，所以这里不会为空。
   */
  const devices = (Array.isArray(state.peers) ? state.peers : []).map(function (peer) {
    return {
      id: peer.id,
      /* name 只用来拼 @ 前缀（设备名，不带系统类型）；label 是给人看的统一标识。 */
      name: peer.name,
      label: peer.label || peer.name,
      isLocal: peer.isLocal
    };
  });
  const chips = [{ id: null, name: '所有人', label: '所有人' }].concat(devices);
  // 选中的设备掉线了就退回「所有人」，否则会发出一条谁都接不到的需求
  if (assignee && !chips.some(function (item) { return item.id === assignee.id; })) assignee = null;
  for (const item of chips) {
    const chip = document.createElement('button');
    chip.className = 'chip' + ((assignee ? assignee.id : null) === item.id ? ' on' : '');
    chip.textContent = item.id === null ? item.name : (item.label + (item.isLocal ? '（本机）' : ''));
    chip.title = item.id === null ? '不指定设备：每台都做' : ('@' + mentionToken(item.name) + ' · ' + item.label);
    chip.addEventListener('click', () => {
      assignee = item.id === null ? null : { id: item.id, name: item.name };
      // 选中谁，输入框开头就写 @谁（没选就是 @所有人）。
      syncPrefixToAssignee(assignee);
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
  const raw = text.value;
  /*
   * **永远不能因为解析前缀而阻止发送。**
   *
   * 0.9.5 加过一条「只写了 @设备、没有正文就不发」的判断，结果两台的发送全被吃掉 ——
   * 用户打了字却发不出去，这是最不可接受的失败方式。
   * 现在：能剥就剥，剥完是空的就按原文发，绝不 return。
   */
  const stripped = raw.replace(/^@[^\\s@]*\\s*/, '');
  /*
   * 只写了 @设备 而没写正文：不发（这是明确的空输入）。
   * 但**只要还有别的字**，就按原文发 —— 绝不吃掉用户打的内容。
   */
  if (!stripped.trim() && /^@[^\\s@]*\\s*$/.test(raw)) return;
  const body = (stripped.trim() ? stripped : raw).trim();
  if (!body) return;
  /*
   * 指派对象：正文里的 @设备 优先，其次「由谁执行」的选择。
   * 前缀里的「@所有人」不算指派。
   */
  const fromText = mentionAssignee(raw);
  const target = fromText || assignee;
  const files = attached.map(function (item) { return item.path; }).filter(Boolean);
  text.value = '';
  autosize();
  closeMention();
  lastPrefix = '';
  assignee = null;
  if (lastState) renderAssign(lastState);
  /* 附件随这条消息一起给本机 agent（路径由扩展保存后返回）。 */
  vscode.postMessage({ type: 'send', text: body, assignee: target || undefined, attachments: files });
  attached.length = 0;
  paintAttachments();
}

/* ---------------- 附件与语音（和主对话框同一套能力） ---------------- */
/** 已附加到这条消息的文件；路径由扩展保存到磁盘后返回。 */
const attached = [];
function paintAttachments() {
  const box = el('attachList');
  if (!box) return;
  box.textContent = '';
  if (!attached.length) { box.style.display = 'none'; return; }
  box.style.display = 'flex';
  attached.forEach(function (item, index) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    const name = document.createElement('span');
    name.textContent = item.name;
    name.title = item.path || item.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', function () { attached.splice(index, 1); paintAttachments(); });
    chip.appendChild(name);
    chip.appendChild(remove);
    box.appendChild(chip);
  });
}
function readAsBase64(file, done) {
  const reader = new FileReader();
  reader.onload = function () {
    const result = String(reader.result || '');
    done(result.slice(result.indexOf(',') + 1));
  };
  reader.onerror = function () { done(''); };
  reader.readAsDataURL(file);
}
function attachFiles(fileList) {
  Array.prototype.slice.call(fileList || []).forEach(function (file) {
    // 6 MB 上限和主对话框一致：再大就不是「顺手贴一张图」了。
    if (!file || file.size > 6 * 1024 * 1024) {
      vscode.postMessage({ type: 'toast', text: '附件超过 6 MB，没有添加' });
      return;
    }
    readAsBase64(file, function (dataBase64) {
      if (!dataBase64) return;
      vscode.postMessage({
        type: 'attach',
        name: file.name || 'attachment',
        mimeType: file.type || '',
        dataBase64: dataBase64
      });
    });
  });
}
if (el('attachBtn')) {
  el('attachBtn').addEventListener('click', function () { el('fileInput').click(); });
  el('fileInput').addEventListener('change', function (event) {
    attachFiles(event.target.files);
    event.target.value = '';
  });
  /* 直接粘贴图片：和主对话框一致 */
  text.addEventListener('paste', function (event) {
    const items = (event.clipboardData && event.clipboardData.items) || [];
    const files = [];
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) { event.preventDefault(); attachFiles(files); }
  });
  /* 语音输入：用浏览器自带的识别，识别结果直接追加到输入框，可再修改。 */
  let voice = null;
  el('voiceBtn').addEventListener('click', function () {
    const button = el('voiceBtn');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      vscode.postMessage({ type: 'toast', text: '这个环境不支持语音输入，请用键盘输入' });
      return;
    }
    if (voice) { try { voice.stop(); } catch (ignored) {} voice = null; button.classList.remove('active'); return; }
    const recognition = new Recognition();
    voice = recognition;
    button.classList.add('active');
    recognition.lang = navigator.language || 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = function (event) {
      let spoken = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) spoken += event.results[i][0].transcript;
      const clean = spoken.trim();
      if (!clean) return;
      text.value = (text.value.replace(/\\s+$/, '') ? text.value.replace(/\\s+$/, '') + ' ' : '') + clean;
      autosize();
    };
    recognition.onerror = function (event) {
      vscode.postMessage({ type: 'toast', text: '语音识别失败：' + (event.error || '未知原因') });
    };
    recognition.onend = function () { voice = null; button.classList.remove('active'); };
    try { recognition.start(); } catch (error) { voice = null; button.classList.remove('active'); }
  });
}

function autosize() {
  text.style.height = 'auto';
  text.style.height = Math.min(text.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
}

el('send').addEventListener('click', send);
text.addEventListener('input', () => {
  autosize();
  syncMention();
  /*
   * 用户手动删掉了开头的 @：选择跟着回到「所有人」。
   *
   * 这是用户定的规则：「不选继续输入或者删掉 @，选择会消失，就默认是所有设备」。
   */
  const hasPrefix = /^@[^\\s@]*\\s/.test(text.value);
  if (lastPrefix && !hasPrefix) {
    lastPrefix = '';
    assignee = null;
    if (lastState) renderAssign(lastState);
  } else if (hasPrefix) {
    lastPrefix = (text.value.match(/^@[^\\s@]*\\s/) ?? [''])[0];
  }
});
/* 光标移动（点别处、按方向键）也要同步，否则删掉 @ 后列表还挂着。 */
text.addEventListener('click', syncMention);
text.addEventListener('keyup', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') syncMention();
});
text.addEventListener('blur', () => { setTimeout(closeMention, 120); });
text.addEventListener('keydown', (event) => {
  if (mentionItems.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionIndex = (mentionIndex + 1) % mentionItems.length;
      paintMention();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length;
      paintMention();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      chooseMention(mentionItems[mentionIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMention();
      return;
    }
  }
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
el('copyInviteInline').addEventListener('click', (event) => {
  // 收起状态下也能直接复制，不必先展开。
  event.stopPropagation();
  const button = event.currentTarget;
  button.textContent = '已复制';
  vscode.postMessage({ type: 'copyInvite', text: el('invite').dataset.text || el('inviteCode').textContent || '' });
  setTimeout(() => { button.textContent = '复制'; }, 1400);
});
el('inviteToggle').addEventListener('click', (event) => {
  if (event.target === el('copyInviteInline')) return;
  inviteCollapsed = !inviteCollapsed;
  paintInvite();
});
el('moreBtn').addEventListener('click', () => {
  drawerOpen = !drawerOpen;
  paintDrawer();
});
window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'state') render(data);
  /* 附件保存结果：拿到磁盘路径后挂到这条消息上。 */
  if (data.type === 'attached' && data.item) {
    attached.push(data.item);
    paintAttachments();
  }
  if (data.type === 'attachFailed') {
    vscode.postMessage({ type: 'toast', text: '附件保存失败：' + (data.reason || '未知原因') });
  }
});
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
