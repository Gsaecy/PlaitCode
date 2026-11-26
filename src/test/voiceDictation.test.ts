import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DICTATION_START_COMMAND,
  DICTATION_STOP_COMMAND,
  SPEECH_EXTENSION_ID,
  installSpeechExtension,
  mergeVoiceText,
  prefersVsCodeSpeech,
  speechExtensionInstalled,
  startEditorDictation,
  systemDictationHint,
  voiceEngineChoice,
} from '../core/voiceDictation';
import {
  closedTabs,
  executedCommands,
  lastUntitledDocument,
  setConfiguration,
  setInstalledExtension,
} from './support/vscodeMock';

/**
 * 「像 Copilot Chat 那样在 VS Code 里录音输入」。
 *
 * 事实：Copilot Chat 的麦克风由微软官方的 **VS Code Speech** 扩展提供（本机离线识别）。
 * webview 拿不到麦克风，所以我们借它的「编辑器听写」命令把文字打进临时编辑器，
 * 再实时同步到输入框。
 *
 * 这里**真的调用** `voiceDictation` 的函数（vscode 用测试替身），
 * 而不是读源码猜它调了哪条命令。
 */

const reset = (): void => {
  setInstalledExtension(undefined);
  setConfiguration({});
  executedCommands.length = 0;
  closedTabs.length = 0;
};

test('认准微软官方扩展与它的听写命令（不是自研模型）', () => {
  assert.equal(SPEECH_EXTENSION_ID, 'ms-vscode.vscode-speech');
  assert.equal(DICTATION_START_COMMAND, 'workbench.action.editorDictation.start');
  assert.equal(DICTATION_STOP_COMMAND, 'workbench.action.editorDictation.stop');
});

test('录音引擎设置：只认 speech / native，其余一律 auto', () => {
  reset();
  setConfiguration({ 'hwchat.voiceEngine': 'native' });
  assert.equal(voiceEngineChoice(), 'native');
  setConfiguration({ 'hwchat.voiceEngine': 'speech' });
  assert.equal(voiceEngineChoice(), 'speech');
  setConfiguration({ 'hwchat.voiceEngine': 'browser' });
  assert.equal(voiceEngineChoice(), 'auto', '脏值不能让它走一条不存在的路');
  setConfiguration({});
  assert.equal(voiceEngineChoice(), 'auto');
});

test('系统听写的热键按平台给对（Windows Win+H / macOS Fn×2 / 其它兜底）', () => {
  assert.match(systemDictationHint('win32'), /Win\+H/);
  assert.match(systemDictationHint('win32'), /不需要任何扩展/);
  assert.match(systemDictationHint('darwin'), /Fn/);
  assert.match(systemDictationHint('darwin'), /不需要任何扩展/);
  const other = systemDictationHint('linux');
  assert.ok(other.length > 0);
  assert.doesNotMatch(other, /Win\+H/, '别把 Windows 热键安到别的平台上');
});

test('装没装 Speech 扩展：按扩展真实存在判断', () => {
  reset();
  assert.equal(speechExtensionInstalled(), false);
  setInstalledExtension({ id: SPEECH_EXTENSION_ID, isActive: true });
  assert.equal(speechExtensionInstalled(), true);
  assert.equal(prefersVsCodeSpeech(true), true);
  assert.equal(prefersVsCodeSpeech(false), false);
});

test('安装：命令返回不算数，要等扩展真的可用', async () => {
  reset();
  const installed = await installSpeechExtension(50);
  assert.equal(installed, false, '没装成功就要如实返回 false');
  assert.ok(executedCommands.some((item) => item.id === 'workbench.extensions.installExtension'), '要真的调用安装命令');

  // 一开始「未激活」，activate() 后变可用 —— 这就是「等它落地」的路径。
  reset();
  const extension = {
    id: SPEECH_EXTENSION_ID,
    isActive: false,
    activate: async () => {
      extension.isActive = true;
    },
  };
  setInstalledExtension(extension);
  assert.equal(await installSpeechExtension(5_000), true);
  assert.equal(extension.isActive, true);
});

test('编辑器听写：文字实时交出来，结束只给一次最终结果并关掉临时页', async () => {
  reset();
  const speech = { id: SPEECH_EXTENSION_ID, isActive: true, activate: async () => undefined };
  setInstalledExtension(speech);
  const received: Array<{ text: string; live: boolean }> = [];
  const session = await startEditorDictation({ onText: (text, live) => received.push({ text, live }) });

  assert.ok(executedCommands.some((item) => item.id === DICTATION_START_COMMAND), '要真的开始听写');

  // 模拟听写引擎往里写字（同一段文字的中间态）。
  const document = lastUntitledDocument();
  assert.ok(document, '听写必须有一个聚焦的编辑器当落点');
  document.setText('把团队群');
  document.setText('把团队群的截图也传给 agent');

  assert.deepEqual(received, [
    { text: '把团队群', live: true },
    { text: '把团队群的截图也传给 agent', live: true },
  ], '实时结果标 live:true（界面应替换而不是追加）');

  await session.stop();
  assert.deepEqual(received.at(-1), { text: '把团队群的截图也传给 agent', live: false }, '结束时给一次最终结果');
  assert.ok(executedCommands.some((item) => item.id === DICTATION_STOP_COMMAND), '要停下听写');
  assert.equal(closedTabs.length, 1, '临时编辑器必须关掉，不能留在标签栏');

  // 再停一次不会重复回调（避免界面里同一句话被写两遍）。
  const before = received.length;
  await session.stop();
  assert.equal(received.length, before);
});

test('没装 Speech 时开听写要明确报错，而不是静默什么都不做', async () => {
  reset();
  await assert.rejects(startEditorDictation({ onText: () => undefined }), /Speech/);
});

test('实时听写是**替换**不是追加（否则一句话会重复十几遍）', () => {
  // 第一次：输入框原来是空的。
  assert.equal(mergeVoiceText('', '', '你好'), '你好');
  // 第二次：送来的是整段，要把上一次插入的那段换掉。
  assert.equal(mergeVoiceText('你好', '你好', '你好世界'), '你好世界');
  // 输入框里原有别的内容：保留原文，只替换语音那一段。
  assert.equal(mergeVoiceText('先看看这个 你好', '你好', '你好世界'), '先看看这个 你好世界');
  // 空结果（例如用户说错了要清空）→ 只留原有内容。
  assert.equal(mergeVoiceText('原有内容 你好', '你好', '   '), '原有内容');
  // 保留原文与语音之间的一个空格，不要粘在一起。
  assert.equal(mergeVoiceText('原有内容', '', '新的一句'), '原有内容 新的一句');
});

test('面板与界面的接线（UI 层无法执行，只核对入口确实在）', () => {
  /*
   * 上面几条已经把「引擎选择 / 安装 / 听写 / 合并」都执行过了。
   * 这里只剩纯 UI 接线（弹提示、画进度环、状态栏按钮），没有可执行入口，
   * 所以保留最少的静态断言，并注明原因。
   */
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  const chatJs = readFileSync('media/chat.js', 'utf8');
  assert.match(panel, /if \(prefersVsCodeSpeech\(speechExtensionInstalled\(\)\)\) \{/, '装了就直接用官方引擎');
  assert.match(panel, /await this\.installSpeechWithRing\(target\)/, '没装时先问、确认后安装');
  assert.match(panel, /await this\.startVoiceFallback\(target\);/, '拒绝或失败仍要有退路');
  assert.match(panel, /createStatusBarItem/, '录音期间要在状态栏挂个可点的结束入口');
  assert.match(chatJs, /function paintVoiceRing\(phase\)/, '安装进度环的画法在界面侧');
});
