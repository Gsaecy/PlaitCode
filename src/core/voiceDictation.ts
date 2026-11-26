/**
 * VS Code 内「录音输入」——复用 Copilot Chat 用的那套离线语音识别。
 *
 * 为什么不是 webview 里识别（用户 2026-11-25 的两次追问）：
 *   「语音输入失败: not-allowed」→ webview 是受限 iframe，没有麦克风权限；
 *   「为什么不能像 copilot chat 那样在 vscode 软件里录音输入？」
 *
 * Copilot Chat 的麦克风按钮由微软官方的 **VS Code Speech** 扩展
 * （`ms-vscode.vscode-speech`）提供，识别在**本机离线**完成，不联网、不需要 key。
 * 那个能力只接进 VS Code 自己的聊天界面，第三方 webview 拿不到麦克风。
 *
 * 但它同时提供「编辑器听写」命令：把语音实时打进**当前聚焦的文本编辑器**。
 * 所以可以借它做真正在 VS Code 里的录音输入：
 *   开一个临时无标题编辑器 → 开始听写 → 把编辑器里长出来的文字实时同步到我们的
 *   对话框输入框（增量替换，不重复）→ 结束时关掉临时编辑器、把焦点还给面板。
 *
 * 这样体验与 Copilot Chat 一致（同引擎、离线、无浏览器标签页），
 * 且不需要我们打包任何语音模型。
 */

import * as vscode from 'vscode';

/** 微软官方离线语音扩展：Copilot Chat 的麦克风就是它。 */
export const SPEECH_EXTENSION_ID = 'ms-vscode.vscode-speech';
/** 把语音打进当前编辑器（Speech 扩展注册的命令）。 */
export const DICTATION_START_COMMAND = 'workbench.action.editorDictation.start';
export const DICTATION_STOP_COMMAND = 'workbench.action.editorDictation.stop';

/**
 * 用户选定的录音引擎（设置项 `hwchat.voiceEngine`）。
 *
 * 用户 2026-11-25：「录音为什么必须显示一个分栏页面？」
 * 编辑器听写是扩展唯一能拿到识别结果的公开路径，但它**必须有一个聚焦的文本编辑器**，
 * 所以会临时多出一个页面；`native` 就是那条真正不开任何页面的路（本机离线识别）。
 */
export type VoiceEngineChoice = 'auto' | 'speech' | 'native';

export function voiceEngineChoice(): VoiceEngineChoice {
  const value = vscode.workspace.getConfiguration('hwchat').get<unknown>('voiceEngine');
  return value === 'speech' || value === 'native' ? value : 'auto';
}

/**
 * 语音引擎的优先级：**装了 VS Code Speech 就用它**（识别质量最好，Copilot Chat 同款），
 * 没装就先引导安装；装不了 / 用户拒绝才退回本机识别与其它退路。
 *
 * 用户 2026-11-25 的决定：「那就换成 VS Code Speech，用户如果没有安装，
 * 第一次点击录音的时候就弹出安装提示，确认后就安装」。
 */
export function prefersVsCodeSpeech(hasSpeechExtension: boolean): boolean {
  return hasSpeechExtension;
}

/**
 * 系统听写的触发方式（**不需要任何扩展**）。
 *
 * Windows 的 `Win+H`、macOS 的连按两下 `Fn`（或按两下麦克风/地球键）都是操作系统自带的
 * 听写：麦克风由系统驱动采集、识别在系统里做，文字直接打进**当前有焦点的输入框** ——
 * 包括 VS Code 里我们这块 webview 输入框。这是最"原生"的那条路，代价是热键必须由用户按
 * （操作系统不允许别的程序静默开启麦克风，我们也不该绕过）。
 */
export function systemDictationHint(platform: string): string {
  if (platform === 'darwin') {
    return '把光标放进输入框，连按两下 Fn（或按两下键盘上的麦克风键）开始系统听写；说完再按一次结束。识别由 macOS 完成，不需要任何扩展。';
  }
  if (platform === 'win32') {
    return '把光标放进输入框，按 Win+H 开始系统听写；说完再按一次结束。识别由 Windows 完成，不需要任何扩展。';
  }
  return '把光标放进输入框，使用当前桌面环境自带的语音听写（例如输入法的语音输入），文字会直接进到输入框里。';
}

/** Speech 扩展装没装（装了才谈得上听写）。 */
export function speechExtensionInstalled(): boolean {
  return Boolean(vscode.extensions.getExtension(SPEECH_EXTENSION_ID));
}

/**
 * 装 VS Code Speech，并等它真的可用。
 *
 * 为什么不能只看命令返回：`workbench.extensions.installExtension` 返回时安装可能
 * 还没落地（下载 + 解包 + 激活）。用户要的是「圆圈闭环 = 现在就能录」，
 * 所以这里轮询到扩展真的出现、并激活成功才算成功。
 */
export async function installSpeechExtension(timeoutMs = 120_000): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', SPEECH_EXTENSION_ID);
  } catch {
    // 命令本身失败也要继续轮询：有些版本是先在后台排队的。
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const extension = vscode.extensions.getExtension(SPEECH_EXTENSION_ID);
    if (extension) {
      if (!extension.isActive) await Promise.resolve(extension.activate()).catch(() => undefined);
      if (extension.isActive) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

export interface DictationSession {
  /** 结束听写：停命令、关临时编辑器、把最终结果交回去。 */
  stop(): Promise<void>;
}

/**
 * 开一段 VS Code 内听写，把文字实时交给调用方。
 *
 * @param onText 每次文本变化都回调；`live: true` 表示还在听（调用方应**替换**上一次的
 *               内容而不是追加），`live: false` 表示这是最终结果。
 */
export async function startEditorDictation(options: {
  onText: (text: string, live: boolean) => void;
  log?: (line: string) => void;
  /** 这么久没有新文字就当作说完了（默认 20 秒；Speech 扩展自身也有静默超时）。 */
  idleStopMs?: number;
}): Promise<DictationSession> {
  const extension = vscode.extensions.getExtension(SPEECH_EXTENSION_ID);
  if (!extension) throw new Error('没有安装 VS Code Speech 扩展');
  if (!extension.isActive) await extension.activate();

  // 临时无标题编辑器：听写必须有聚焦的编辑器作为落点。
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '' });
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: false,
  });
  await vscode.commands.executeCommand(DICTATION_START_COMMAND);

  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const idleStopMs = options.idleStopMs ?? 20_000;

  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void finish(); }, idleStopMs);
  };

  const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
    if (stopped) return;
    if (event.document.uri.toString() !== document.uri.toString()) return;
    const text = event.document.getText().trim();
    if (!text || text === last) return;
    last = text;
    options.onText(text, true);
    arm();
  });

  async function finish(): Promise<void> {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    subscription.dispose();
    try { await vscode.commands.executeCommand(DICTATION_STOP_COMMAND); } catch { /* 已经停了 */ }
    // 关掉临时编辑器：不留在标签栏里，也不留下未命名文件。
    try {
      const tab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((item) => item.input instanceof vscode.TabInputText
          && item.input.uri.toString() === document.uri.toString());
      if (tab) await vscode.window.tabGroups.close(tab);
    } catch { /* 关不掉也不影响结果 */ }
    options.log?.(`[voice] 听写结束：${last.length} 字`);
    options.onText(last, false);
  }

  arm();
  return { stop: finish };
}

/**
 * 把「听写/语音」得到的文字合并进输入框里的旧内容。
 *
 * 抽成纯函数是为了能单测：实时听写会**反复**送来整段文字，必须替换上一次插入的那段，
 * 不能每来一次就追加一遍（否则一句话会重复十几遍）。
 */
export function mergeVoiceText(base: string, previouslyInserted: string, incoming: string): string {
  const value = incoming.trim();
  let rest = base;
  if (previouslyInserted) {
    if (rest.endsWith(previouslyInserted)) rest = rest.slice(0, rest.length - previouslyInserted.length);
    else rest = rest.split(previouslyInserted).join('');
  }
  const trimmed = rest.replace(/\s+$/, '');
  if (!value) return trimmed;
  return trimmed ? `${trimmed} ${value}` : value;
}
