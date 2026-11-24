/**
 * 把局域网同步接到 VS Code：读设置、拼本机身份、注册命令与状态栏、写账本文件。
 *
 * 设计目标（用户 2026-11-23）：「需要傻瓜式的简化使用」。
 * 所以对外的**唯一必点项**是一个状态栏按钮 / 一个命令：
 *
 *   点一下 → 附近有队友就直接连上（对方点一次「允许」）→ 没有队友就自己待命，
 *   另一台也点同一个按钮即可。
 *
 * 配对码、IP、主机/从机这些词都不再出现在正常流程里；它们只在「高级」命令里保留，
 * 给需要固定码或跨网段的用户用。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { ALIGNMENT_FILE, type SyncPeer } from './lanProtocol';

/** 团队群记录文件（与对齐账本并列，一个记状态、一个记过程）。 */
const TRANSCRIPT_FILE = 'docs/TEAM-CHAT.md';
import { LanSyncService, defaultDeviceName, defaultPlatform, lanAddresses, peerIdFor, type LanSyncBridge } from './lanSync';
import { GroupPanel } from '../views/groupPanel';
import { MobilePanel } from '../views/mobilePanel';
import { RelayPhonePanel } from '../views/relayPhonePanel';
import { RelayClient, enrollRelayDevice } from './relayClient';
import { tt } from '../core/i18n';
import { buildPairingText, deriveKeys, newPairingSecret, parsePairingText } from './relayCrypto';

export interface LanSetupOptions {
  context: vscode.ExtensionContext;
  output: vscode.LogOutputChannel;
  chat: {
    setLanSync(service: LanSyncService | undefined): void;
    runSyncRequirement(requirement: import('./lanProtocol').SyncRequirement): Promise<boolean>;
    runSyncNote(note: import('./lanProtocol').SyncNote): Promise<boolean>;
    /** 群窗口里发一句话（需求或回答），由面板决定走哪条路径。 */
    sendGroupMessage(text: string): Promise<void>;
    /** 中继上收到甲方需求：开跑但不再广播；跑没跑起来都要回执。 */
    runRelayedUserRequirement(
      text: string,
      onOutcome?: (outcome: { ok: boolean; reasonKey?: string; vars?: Record<string, string | number> }) => void,
      onFinished?: (result: { ok: boolean; summary: string; files: string[] }) => void,
    ): Promise<void>;
    /** 手机发来的远程控制（改权限档位 / 改步数 / 中止 / 查状态）。 */
    applyRemoteControl(input: {
      action: 'preset' | 'steps' | 'stop';
      preset?: import('./lanProtocol').RemotePreset;
      steps?: number;
    }): Promise<{ ok: boolean; message: string }>;
    /** 手机界面上要显示的「真实生效值」，不是手机自己猜的。 */
    remoteControlState(): Promise<{
      preset: import('./lanProtocol').RemotePreset;
      steps: number;
      running: boolean;
    }>;
  };
  version: string;
}

export interface LanSetupResult {
  service: LanSyncService;
  disposables: vscode.Disposable[];
}

/** 本机身份：同一台机器每次都得到同一个 id，换机才不同。 */
export function localPeer(input: {
  deviceName: string;
  version: string;
  project: string;
}): SyncPeer {
  const platform = defaultPlatform();
  const name = input.deviceName.trim() || defaultDeviceName();
  return {
    id: peerIdFor(`${name}:${platform}`),
    name,
    platform,
    project: input.project,
    version: input.version,
  };
}

function setting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('plaitcode').get<T>(key, fallback);
}

/** 当前工作区目录（多根工作区取第一个，和「项目根」的口径一致）。 */
function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function setupLanSync(options: LanSetupOptions): Promise<LanSetupResult> {
  const { context, output, chat } = options;
  let deviceName = setting('lanSync.deviceName', '');
  /** 跨网中继客户端（没加入频道时是 undefined）。 */
  let relay: RelayClient | undefined;
  /** 频道密钥：SecretStorage 是异步的，这里缓存一份，供同步拼手机链接用。 */
  let relayKey = '';
  const relaySecretKey = 'plaitcode.relay.secret';
  /** 企业身份模式下的设备令牌（SecretStorage，不进 settings.json）。 */
  let relayDeviceToken = '';
  const relayDeviceTokenKey = 'plaitcode.relay.deviceToken';

  const bridge: LanSyncBridge = {
    peer: () => {
      const root = workspaceRoot();
      return localPeer({ deviceName, version: options.version, project: root ? basename(root) : 'workspace' });
    },
    runRequirement: (requirement) => chat.runSyncRequirement(requirement),
    runNote: (note) => chat.runSyncNote(note),
    /**
     * 陌生设备想连进来：一个弹窗、两个按钮，这就是全部的「安全确认」。
     *
     * 用 `modal: true` 让它足够显眼（不会像普通通知一样被忽略），也是这个功能里
     * 唯一的信任决策点。点过「允许」之后会被记住，以后自动重连不再问。
     */
    approvePeer: async (peer) => {
      const answer = await vscode.window.showInformationMessage(
        `「${peer.name}」想连接这台设备，一起开发同一个 app 的另一个平台版本。允许吗？`,
        { modal: true, detail: `项目：${peer.project || '（未命名）'}\n允许后会记住，下次不再询问。` },
        '允许',
        '拒绝',
      );
      return answer === '允许';
    },
    async writeLedger(markdown: string): Promise<void> {
      const root = workspaceRoot();
      if (!root) return;
      const target = join(root, ALIGNMENT_FILE);
      try {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, markdown, 'utf8');
      } catch (error) {
        output.warn(`[sync] 写账本失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    /** 团队群记录：与账本一样进仓库，人和模型都能读。 */
    async writeTranscript(markdown: string): Promise<void> {
      const root = workspaceRoot();
      if (!root) return;
      const target = join(root, TRANSCRIPT_FILE);
      try {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, markdown, 'utf8');
      } catch (error) {
        output.warn(`[sync] 写群记录失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    /**
     * 群里有新发言：刷新团队群窗口。
     *
     * **不再往主对话里追加消息** —— 那是「信息繁杂」的来源。主对话只放本机 agent
     * 自己的工作过程；群的事在群窗口里看（一行一条、可展开），全过程另有
     * `docs/TEAM-CHAT.md`。
     */
    async onGroupMessage(message) {
      await groupPanel?.refresh().catch(() => undefined);
      if (message.author === 'agent' && message.phase === 'question') {
        void vscode.window
          .showInformationMessage(`乙方在等你确认需求：${message.body.slice(0, 120)}`, '打开团队群')
          .then(async (choice) => {
            if (choice) await vscode.commands.executeCommand('plaitcode.lanSync.openGroup');
          });
      }
    },
    log: (line, level) => {
      if (level === 'warn') output.warn(line);
      else output.info(line);
    },
    /**
     * 手机发来的一句话：**走和群窗口完全相同的入口**。
     *
     * 判断「回答追问还是新需求」、广播、本机开跑，全都复用 `sendGroupMessage()`。
     * 如果这里另写一套，手机和电脑迟早会得出不同结论 —— 那正是最难查的一类 bug。
     */
    async onMobileMessage(text: string) {
      try {
        await chat.sendGroupMessage(text);
        output.info(`[mobile] 已转发到团队群：${text.slice(0, 80)}`);
        return { ok: true, message: '已发到团队群' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.warn(`[mobile] 发送失败：${message}`);
        return { ok: false, message: `本机现在没法执行：${message}` };
      }
    },
    /** 手机上能否批准工具授权（用户可在「手机遥控」窗口里一键关掉）。 */
    canApproveFromPhone: () => setting('mobile.allowApproval', false),
    /**
     * 本机产生的每条消息 → 加密后送去中继。
     *
     * 只在「本机产生」时触发；收到对端的消息走 `ingestRelayMessage`，不会回环。
     */
    onOutgoing: (message) => {
      if (!relay) return;
      void relay.send(message).then((result) => {
        if (!result.ok) output.warn(`[relay] ${result.message}`);
      });
    },
    /**
     * 手机发来的远程控制：改权限档位 / 改步数 / 中止当前任务。
     *
     * 手机上必须能改这些，否则 agent 一卡在"要不要允许这条命令"，
     * 用户还是得跑到电脑前点一次，"用手机指挥"就失去意义。
     */
    onRemoteControl: async (control) => {
      if (control.action === 'state') {
        service.broadcastControl(await chat.remoteControlState());
        return { ok: true, message: '已把当前设置同步给手机' };
      }
      const result = await chat.applyRemoteControl({
        action: control.action,
        ...(control.preset ? { preset: control.preset } : {}),
        ...(control.steps !== undefined ? { steps: control.steps } : {}),
      });
      if (result.ok) service.broadcastControl(await chat.remoteControlState());
      return result;
    },
    /**
     * 手机在群里发的需求（经中继到达）：本机开跑。
     * 不再广播 —— 中继已经发给所有设备了。
     *
     * 无论跑没跑起来，都往群里回一条 —— 手机那边看不到电脑上的弹窗，
     * 没有回执就只能盯着自己那条消息，不知道是排队中还是被拦下了。
     */
    onRelayUserMessage: (text) => chat.runRelayedUserRequirement(text, (outcome) => {
      const project = bridge.peer().project;
      const body = outcome.ok
        ? tt('notice.relayStarted', { project })
        : tt('notice.relayBlocked', {
          reason: outcome.reasonKey ? tt(outcome.reasonKey, outcome.vars ?? {}) : tt('notice.relayUnknownReason'),
        });
      output.info(`[relay] 甲方需求${outcome.ok ? '已开跑' : '未开跑'}：${body}`);
      // 失败用 blocked 而不是 result：result 会让看板把任务标成"已完成"，
      // 用户看到的却是"根本没跑"，那是假信息。
      void service.postGroup({ author: 'agent', phase: outcome.ok ? 'progress' : 'blocked', body })
        .catch((error: unknown) => output.warn(`[relay] 回执发送失败：${error instanceof Error ? error.message : String(error)}`));
    }, (result) => {
      /*
       * 跑完了：把结论送回群里。
       *
       * 手机看不到电脑屏幕，没有这一条它永远停在"已在 X 开始处理"。
       * 结论太长会刷屏，截断到 800 字；改了哪些文件单独列一行。
       */
      const head = result.ok
        ? tt('notice.relayFinished', { project: bridge.peer().project })
        : tt('notice.relayInterrupted');
      const body = [
        head,
        result.summary ? result.summary.slice(0, 800) : '',
        result.files.length ? `改动 ${result.files.length} 个文件：${result.files.slice(0, 8).join('、')}` : '',
      ].filter(Boolean).join('\n\n');
      output.info(`[relay] 甲方需求${result.ok ? '已完成' : '未完成'}：${result.files.length} 个文件`);
      void service.postGroup({ author: 'agent', phase: result.ok ? 'result' : 'blocked', body })
        .catch((error: unknown) => output.warn(`[relay] 结果回传失败：${error instanceof Error ? error.message : String(error)}`));
    }),
  };

  const service = new LanSyncService(join(context.globalStorageUri.fsPath, 'lan-sync.json'), bridge);
  await service.load();
  /*
   * 团队群窗口：独立面板，不进主对话。
   *
   * 发消息复用 `chat.send()` —— 它已经知道「这是回答追问还是新需求」，
   * 群窗口不重复实现那套判断。
   */
  const groupPanel = new GroupPanel(context.extensionUri, service, {
    send: (text) => chat.sendGroupMessage(text),
    log: (line) => output.info(line),
    relay: () => {
      const state = relay?.status();
      return state ? { connected: state.connected, peers: state.peers, url: state.url } : undefined;
    },
  });
  /*
   * 「手机遥控」窗口：电脑上显示二维码 + 6 位码。
   *
   * 和群窗口分开：群窗口是「看过程」，这个窗口只在配手机时用一次，
   * 之后手机上就能看到同样的群。
   */
  const mobilePanel = new MobilePanel(context.extensionUri, service, {
    rotate: () => service.rotateMobileCode(),
    getApprove: () => setting('mobile.allowApproval', false),
    setApprove: async (value) => {
      await vscode.workspace.getConfiguration('plaitcode').update('mobile.allowApproval', value, vscode.ConfigurationTarget.Global);
      output.info(`[mobile] 手机批准工具授权：${value ? '已允许' : '已禁止'}`);
    },
  });

  /*
   * 跨网中继：把本机产生的消息加密后送到中转，再把收到的密文解回团队群。
   *
   * 与局域网是**两条独立通道**，可以同时开着：同一 WiFi 走直连更快，外网走中继。
   * 密钥存在 SecretStorage（不进 settings.json），中转只见到密文。
   */
  const relayUrl = (): string => setting('relay.url', '').trim();
  /**
   * 写中继地址。失败不往命令层抛（会变成「命令导致错误」的红色弹窗），
   * 而是明确说清是哪一步坏了——0.7.2 就因为配置项没声明，用户只看到一句英文式报错。
   */
  const saveRelayUrl = async (url: string): Promise<boolean> => {
    try {
      await vscode.workspace.getConfiguration('plaitcode').update('relay.url', url, vscode.ConfigurationTarget.Global);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.warn(`[relay] 保存中继地址失败：${message}`);
      void vscode.window.showWarningMessage(`没能保存中继地址（${message}）。频道当次可用，但重启后不会自动恢复。`);
      return false;
    }
  };
  /** 手机要打开的地址：密钥放在 fragment，不会进服务器日志。 */
  const relayPhoneLink = (): string | undefined => {
    const url = relayUrl();
    if (!url || !relayKey) return undefined;
    return `${url.replace(/\/+$/, '')}/m#k=${encodeURIComponent(relayKey)}`;
  };
  const relayPhonePanel = new RelayPhonePanel(context.extensionUri, { link: relayPhoneLink });
  const startRelay = (url: string, secret: string): void => {
    relay?.stop();
    relayKey = secret;
    relay = new RelayClient({
      url,
      secret,
      device: bridge.peer(),
      ...(relayDeviceToken ? { deviceToken: relayDeviceToken } : {}),
      onMessage: async (message) => {
        await service.ingestRelayMessage(message);
        await groupPanel.refresh().catch(() => undefined);
      },
      onStatus: () => refreshStatus(),
      log: (line, level) => {
        if (level === 'warn') output.warn(line);
        else output.info(line);
      },
    });
    relay.start();
    output.info(`[relay] 已连接 ${url}（频道 ${relay.status().channel.slice(0, 8)}…，${relayDeviceToken ? '设备令牌' : '频道密钥'}鉴权）`);
  };
  // 设置里填了固定配对码就以设置为准（高级用法；正常流程根本不需要）。
  const configuredCode = setting('lanSync.pairingCode', '').trim();
  if (configuredCode) await service.setPairingCode(configuredCode);

  /*
   * 状态栏**始终可见** —— 这就是「傻瓜式」的入口。
   * 没连接时写着「连接另一台设备」，点一下开始找；连上后显示设备数与待对齐项。
   */
  const status = vscode.window.createStatusBarItem('plaitcode.lanSync', vscode.StatusBarAlignment.Right, 90);
  const refreshStatus = (): void => {
    // 中继优先显示：它覆盖"任何网络"，局域网只是同一 WiFi 下的更短路径。
    const relayState = relay?.status();
    if (relayState) {
      status.text = `$(globe) ${relayState.connected ? '中继已连接' : '中继重连中'} · ${relayState.peers + 1}台`;
      status.tooltip = `${relayState.url}\n频道 ${relayState.channel.slice(0, 8)}…\n收到 ${relayState.received} 条 / 发出 ${relayState.sent} 条${relayState.lastError ? `\n${relayState.lastError}` : ''}\n点击查看详情。`;
      status.command = 'plaitcode.relay.status';
      status.show();
      return;
    }
    const state = service.state();
    if (state.role === 'off') {
      // 单机 + 手机遥控：状态栏直接说清楚「手机那端能连」，不然用户会以为没生效。
      if (service.mobileAllowed()) {
        status.text = '$(device-mobile) 手机遥控已开';
        status.tooltip = `手机打开 ${service.mobileUrl()}（或用二维码）。点这里看二维码 / 换验证码。`;
        status.command = 'plaitcode.mobile.open';
        status.show();
        return;
      }
      status.text = '$(broadcast) 连接另一台设备';
      status.tooltip = '在同一 WiFi 的每台设备上各点一次，就能共享需求、一起执行（点了才启用）。';
      status.command = 'plaitcode.lanSync.connect';
      status.show();
      return;
    }
    status.text = `$(broadcast) ${state.peers}台 · ${state.divergences ? `${state.divergences}处待对齐` : '已对齐'}`;
    status.tooltip = `${state.text}\n点击查看详情 / 打开对齐账本。`;
    status.command = 'plaitcode.lanSync.status';
    status.show();
  };
  bridge.onState = refreshStatus;

  const announce = async (role: 'hub' | 'peer' | 'off', message: string): Promise<void> => {
    refreshStatus();
    if (role === 'off') {
      void vscode.window.showWarningMessage(message);
      return;
    }
    const hint = role === 'hub'
      ? '这台已就绪。请在同一 WiFi 的其它设备上点状态栏的「连接另一台设备」。'
      : '已连上。频道里的设备都会收到同一条需求，并各自更新 docs/PLATFORM-ALIGNMENT.md。';
    void vscode.window.showInformationMessage(`${message}\n${hint}`, '知道了');
  };

  const disposables: vscode.Disposable[] = [
    status,
    service,
    vscode.commands.registerCommand('plaitcode.lanSync.connect', async () => {
      const result = await service.autoConnect(setting('lanSync.port', 47821));
      if (result.role === 'hub') {
        await announce('hub', `已让这台电脑等待连接（地址：${lanAddresses().join(' / ') || '未发现局域网地址'}）。`);
      } else {
        await announce(result.role, result.message);
      }
    }),
    vscode.commands.registerCommand('plaitcode.lanSync.disconnect', async () => {
      service.stop();
      refreshStatus();
      void vscode.window.showInformationMessage('已断开。随时可以再点状态栏的「连接另一台设备」。');
    }),
    vscode.commands.registerCommand('plaitcode.lanSync.status', async () => {
      const state = service.state();
      const requirements = service.requirementTitles(6);
      const notes = service.recentNotes(6);
      for (const line of [
        state.text,
        `本机地址：${lanAddresses().join(' / ') || '（未发现局域网地址）'}`,
        '',
        requirements.length ? `最近需求：\n${requirements.join('\n')}` : '最近需求：（无）',
        '',
        notes.length ? `最近队友消息：\n${notes.map((note) => `${note.from.name}：${note.body.slice(0, 120)}`).join('\n')}` : '最近队友消息：（无）',
      ]) output.info(line);
      const choice = await vscode.window.showInformationMessage(state.text, '打开对齐账本', '断开连接');
      if (choice === '打开对齐账本') await vscode.commands.executeCommand('plaitcode.lanSync.openLedger');
      if (choice === '断开连接') await vscode.commands.executeCommand('plaitcode.lanSync.disconnect');
    }),
    vscode.commands.registerCommand('plaitcode.lanSync.openGroup', async () => {
      await groupPanel.open();
    }),
    /*
     * 手机遥控：一个命令开窗，一个命令开关。
     *
     * 打开时**顺手把监听起起来** —— 单机（没连第二台电脑）也要能用手机指挥，
     * 所以不能依赖 `lanSync.enabled`。
     */
    vscode.commands.registerCommand('plaitcode.mobile.open', async () => {
      if (!service.mobileAllowed()) {
        const started = await service.setMobileControl(true, setting('lanSync.port', 47821));
        if (!started.ok) {
          void vscode.window.showWarningMessage(started.message);
          return;
        }
        await vscode.workspace.getConfiguration('plaitcode').update('mobile.enabled', true, vscode.ConfigurationTarget.Global);
      }
      await mobilePanel.open();
    }),
    vscode.commands.registerCommand('plaitcode.mobile.toggle', async () => {
      const next = !service.mobileAllowed();
      const result = await service.setMobileControl(next, setting('lanSync.port', 47821));
      await vscode.workspace.getConfiguration('plaitcode').update('mobile.enabled', next, vscode.ConfigurationTarget.Global);
      refreshStatus();
      if (!result.ok) {
        void vscode.window.showWarningMessage(result.message);
        return;
      }
      void vscode.window.showInformationMessage(result.message);
      if (next) await mobilePanel.open();
    }),
    /*
     * 跨网中继：新建 / 加入 / 分享配对 / 状态 / 退出。
     *
     * 配对信息只有一行 `plaitcode://join?u=…&s=…`：里面同时含中继地址和频道密钥，
     * 所以它等于"进入这个频道的钥匙"——别发到公开的群里。
     */
    vscode.commands.registerCommand('plaitcode.relay.create', async () => {
      const url = (await vscode.window.showInputBox({
        title: '新建跨网频道 · 中继地址',
        prompt: '你服务器的地址，例如 https://plaitcode.example.com（不带路径）',
        value: relayUrl(),
        ignoreFocusOut: true,
        validateInput: (value) => (/^https?:\/\/[^\s]+$/.test(value.trim()) ? undefined : '要写成 https://域名 的形式'),
      }))?.trim();
      if (!url) return;
      const secret = newPairingSecret();
      // 先把地址落盘再存密钥：任一步失败都不会留下"有密钥没地址"的半截状态
      await saveRelayUrl(url);
      await context.secrets.store(relaySecretKey, secret);
      startRelay(url, secret);
      refreshStatus();
      await vscode.env.clipboard.writeText(buildPairingText(url, secret));
      const channel = deriveKeys(secret).channel;
      void vscode.window.showInformationMessage(
        `频道已创建：${channel}\n（授权设备时用这个频道 ID）\n配对信息已复制到剪贴板，另一台设备用「PlaitCode: 加入跨网频道」粘贴它。`,
        '知道了',
      );
    }),
    /**
     * 给另一台设备发配对信息：一次粘贴就能同时拿到频道密钥和设备令牌，
     * 不用再去服务器手工发令牌。这是"我自己的第二台电脑"最常见的操作。
     */
    vscode.commands.registerCommand('plaitcode.relay.invite', async () => {
      const url = relayUrl();
      const secret = await context.secrets.get(relaySecretKey);
      if (!url || !secret) {
        void vscode.window.showWarningMessage('还没有加入频道。先「新建跨网频道」或「加入跨网频道」。');
        return;
      }
      if (!relayDeviceToken) {
        void vscode.window.showWarningMessage(
          '本机还没有设备令牌。企业身份模式下需要先用「登记本机设备令牌」登记这台电脑，之后才能给别的设备签发。',
        );
        return;
      }
      const name = await vscode.window.showInputBox({
        title: '给另一台设备发配对信息',
        prompt: '这台新设备叫什么（方便你在看板上区分）',
        value: `另一台电脑 · ${defaultPlatform()}`,
        ignoreFocusOut: true,
      });
      if (!name) return;
      const result = await enrollRelayDevice(url, relayDeviceToken, { name: name.trim(), platform: defaultPlatform() });
      if (!result.ok || !result.token) {
        void vscode.window.showWarningMessage(result.message);
        return;
      }
      const text = buildPairingText(url, secret, result.token);
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage(
        `已为「${name.trim()}」签发令牌，配对信息已复制。\n`
        + '在那台电脑上装好 PlaitCode，执行「PlaitCode: 加入跨网频道」粘贴这一行即可，不需要再发令牌。',
        '知道了',
      );
    }),
    vscode.commands.registerCommand('plaitcode.relay.join', async () => {
      const text = await vscode.window.showInputBox({
        title: '加入跨网频道',
        placeHolder: 'plaitcode://join?u=https://…&s=…',
        ignoreFocusOut: true,
      });
      if (!text) return;
      const parsed = parsePairingText(text);
      if (!parsed) {
        void vscode.window.showWarningMessage('这段配对信息看不懂：应以 plaitcode://join 开头，并包含 u= 与 s=。');
        return;
      }
      await saveRelayUrl(parsed.url);
      await context.secrets.store(relaySecretKey, parsed.secret);
      // 配对信息里带了设备令牌就一并存下：新设备一次粘贴即可，不用再手工发令牌
      if (parsed.deviceToken) {
        await context.secrets.store(relayDeviceTokenKey, parsed.deviceToken);
        relayDeviceToken = parsed.deviceToken;
      }
      startRelay(parsed.url, parsed.secret);
      refreshStatus();
      void vscode.window.showInformationMessage(
        `已加入频道 ${deriveKeys(parsed.secret).channel}（${parsed.url}）`
        + `${parsed.deviceToken ? '，并已登记本机设备令牌' : ''}。这台设备产生的需求会加密同步给频道内的其它设备。`,
      );
    }),
    vscode.commands.registerCommand('plaitcode.relay.share', async () => {
      const secret = await context.secrets.get(relaySecretKey);
      const url = relayUrl();
      if (!secret || !url) {
        void vscode.window.showWarningMessage('还没有加入跨网频道。先「新建跨网频道」或「加入跨网频道」。');
        return;
      }
      await vscode.env.clipboard.writeText(buildPairingText(url, secret));
      void vscode.window.showInformationMessage('配对信息已复制。频道内所有设备共用这一条，直接发给另一台设备粘贴。');
    }),
    vscode.commands.registerCommand('plaitcode.relay.status', async () => {
      const state = relay?.status();
      if (!state) {
        // 没有活动连接时，只要存过密钥就还能报出频道 ID —— 授权设备正需要它
        const secret = await context.secrets.get(relaySecretKey);
        const channel = secret ? deriveKeys(secret).channel : '';
        void vscode.window.showInformationMessage(
          channel
            ? `中继未连接。频道 ${channel}（授权设备时用这个 ID）\n地址：${relayUrl() || '（没保存）'}\n用「新建 / 加入跨网频道」重新连接。`
            : '还没有连接中继。用「PlaitCode: 新建跨网频道」开始。',
        );
        return;
      }
      void vscode.window.showInformationMessage(
        `跨网中继：${state.connected ? '已连接' : '未连接'}${state.lastError ? `（${state.lastError}）` : ''}\n`
        + `${state.url}\n频道 ${state.channel}（授权设备时用这个 ID）\n`
        + `在线设备 ${state.peers + 1} 台 · 收到 ${state.received} 条 / 发出 ${state.sent} 条 · ${relayDeviceToken ? '设备令牌鉴权' : '频道密钥鉴权'}`,
      );
    }),
    /**
     * 登记设备令牌：开了身份模式的中转只认设备令牌（手机走登录 Cookie）。
     * 令牌由管理员在服务器上生成、只显示一次，这里存进 SecretStorage。
     */
    vscode.commands.registerCommand('plaitcode.relay.device', async () => {
      const secret = await context.secrets.get(relaySecretKey);
      const channel = secret ? deriveKeys(secret).channel : '';
      const token = await vscode.window.showInputBox({
        title: '登记本机设备令牌',
        prompt: channel ? `频道 ID：${channel}　（管理员给这台设备授权时要用它）` : '还没加入频道：先「新建跨网频道」或「加入跨网频道」',
        placeHolder: '粘贴管理员生成的一次性设备令牌；留空表示清除',
        password: true,
        ignoreFocusOut: true,
      });
      if (token === undefined) return;
      const trimmed = token.trim();
      if (trimmed) await context.secrets.store(relayDeviceTokenKey, trimmed);
      else await context.secrets.delete(relayDeviceTokenKey);
      relayDeviceToken = trimmed;
      const url = relayUrl();
      if (url && secret) startRelay(url, secret);
      refreshStatus();
      void vscode.window.showInformationMessage(trimmed ? '设备令牌已保存，正用新令牌重连中继。' : '已清除设备令牌，改回频道密钥鉴权。');
    }),
    vscode.commands.registerCommand('plaitcode.relay.leave', async () => {
      relay?.stop();
      relay = undefined;
      relayKey = '';
      await context.secrets.delete(relaySecretKey);
      refreshStatus();
      void vscode.window.showInformationMessage('已退出跨网频道。');
    }),
    /** 手机加入：显示二维码（密钥在 fragment 里，扫码即进）。 */
    vscode.commands.registerCommand('plaitcode.relay.phone', async () => {
      await relayPhonePanel.open();
    }),
    relayPhonePanel,
    { dispose: () => relay?.stop() },
    groupPanel,
    mobilePanel,
    vscode.commands.registerCommand('plaitcode.lanSync.openLedger', async () => {
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage('当前没有打开工作区，无法定位对齐账本。');
        return;
      }
      await service.syncLedger();
      const target = vscode.Uri.file(join(root, ALIGNMENT_FILE));
      try {
        await vscode.workspace.fs.stat(target);
      } catch {
        void vscode.window.showInformationMessage('还没有跨平台需求。发第一条需求后账本会自动生成。');
        return;
      }
      await vscode.window.showTextDocument(target, { preview: true });
    }),
    // 高级：手动地址 / 固定配对码 / 固定主机。正常流程用不到，保留给跨网段或固定码场景。
    vscode.commands.registerCommand('plaitcode.lanSync.advanced', async () => {
      const choice = await vscode.window.showQuickPick([
        { label: '手动填写对方 IP', description: '自动找不到时用（同一 WiFi 通常不需要）', target: 'address' },
        { label: '设置固定配对码', description: '多台设备共用同一个配对码时用', target: 'code' },
        { label: '启动为固定主机', description: '这台总是作为主机等待别人加入', target: 'hub' },
      ], { title: '局域网同步 · 高级设置' });
      if (!choice) return;
      if (choice.target === 'address') {
        const address = await vscode.window.showInputBox({ title: '对方 IP', placeHolder: '192.168.1.20', ignoreFocusOut: true });
        if (!address) return;
        const joined = await service.joinHub(address.trim(), setting('lanSync.port', 47821));
        await announce(joined.ok ? 'peer' : 'off', joined.message);
        return;
      }
      if (choice.target === 'code') {
        const code = await vscode.window.showInputBox({ title: '固定配对码', value: service.pairingCode(), ignoreFocusOut: true });
        if (!code) return;
        await service.setPairingCode(code);
        void vscode.window.showInformationMessage('已设置。所有设备填同一个值即可自动互通。');
        return;
      }
      const started = await service.startHub(setting('lanSync.port', 47821));
      await announce(started.ok ? 'hub' : 'off', started.message);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('plaitcode.lanSync')) {
        deviceName = setting('lanSync.deviceName', '');
      }
      // 只认「开关本身」的变化：改「允许手机批准」不该把验证码和会话重置一遍。
      if (event.affectsConfiguration('plaitcode.mobile.enabled')) {
        void service.setMobileControl(setting('mobile.enabled', false), setting('lanSync.port', 47821)).then((result) => {
          refreshStatus();
          if (!result.ok) output.warn(`[mobile] ${result.message}`);
        });
      }
    }),
  ];

  refreshStatus();
  /*
   * 首次提示：只弹一次。
   *
   * 用户 2026-11-23 的反馈是「按钮在哪里」—— 说明状态栏那个入口太隐蔽。
   * 与其写一堆说明，不如在升级后第一次打开时直接给一个带按钮的提示，
   * 用户点一次就懂了；之后再也不会打扰。
   */
  const hintedKey = 'plaitcode.lanSync.hinted.v1';
  if (!context.globalState.get<boolean>(hintedKey) && !setting('lanSync.enabled', false)) {
    void context.globalState.update(hintedKey, true);
    void vscode.window
      .showInformationMessage(
        'PlaitCode 新功能：同一 WiFi 下的多台设备可以一起开发同一个项目（各管一个平台也行）。要现在连一台试试吗？',
        '连接另一台设备',
        '以后再说',
      )
      .then(async (choice) => {
        if (choice === '连接另一台设备') await vscode.commands.executeCommand('plaitcode.lanSync.connect');
      });
  }
  /*
   * 自动恢复：用户上次连过，这次开窗口就不用再点一次。
   * 上次是主机就继续待命；上次加入了某台就继续连那台，连不上退回待命 ——
   * 绝不会卡在一个永远连不上的按钮上。
   */
  if (setting('lanSync.enabled', false)) {
    const resumed = await service.resume(setting('lanSync.port', 47821));
    if (!resumed.ok) output.warn(`[sync] 自动恢复失败：${resumed.message}`);
    refreshStatus();
  }
  /*
   * 手机遥控同样自动恢复：上次开着，这次打开窗口就直接可用。
   * 它不依赖 `lanSync.enabled` —— 只有一台电脑也能用手机指挥。
   */
  if (setting('mobile.enabled', false)) {
    const mobile = await service.setMobileControl(true, setting('lanSync.port', 47821));
    if (!mobile.ok) output.warn(`[mobile] ${mobile.message}`);
    refreshStatus();
  }
  /*
   * 中继自动恢复：上次加入过频道就继续连着，打开窗口即可跨网络收发。
   */
  const storedDeviceToken = await context.secrets.get(relayDeviceTokenKey);
  if (storedDeviceToken) relayDeviceToken = storedDeviceToken;
  const storedRelaySecret = await context.secrets.get(relaySecretKey);
  if (storedRelaySecret && relayUrl()) startRelay(relayUrl(), storedRelaySecret);
  relayKey = storedRelaySecret ?? '';

  return { service, disposables };
}
