import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseRecognizerLine,
  recognizerProbeScript,
  recognizerStreamScript,
  windowsRecognizerAvailable,
} from '../core/voiceWinRecognition';

/**
 * 「像扩展自己的功能」的录音输入（Windows）。
 *
 * 用户 2026-11-25：「`Win+H` 能把字打进 HWChat 输入框，但是需要按快捷键，
 * 想让它看起来像是扩展自己的功能，而不是唤起系统的录音」。
 *
 * 做法：扩展自己拉起一个 PowerShell 子进程，用 Windows 自带的 .NET 语音引擎
 * （`System.Speech`）录音并离线识别，文字实时回流到输入框 —— 没有系统听写浮层。
 * 这里是能自动跑的部分：输出协议、脚本内容、以及**本机到底有没有可用识别器**。
 */

const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
const CHAT_JS = readFileSync('media/chat.js', 'utf8');
const GROUP = readFileSync('src/views/groupPanel.ts', 'utf8');
/** 群窗口界面脚本（真文件）；宿主侧仍在 groupPanel.ts。 */
const GROUP_SCRIPT = readFileSync('media/group.js', 'utf8');

test('输出协议：定稿/临时/错误分得清，脏行不会污染输入框', () => {
  assert.deepEqual(parseRecognizerLine('READY zh-CN'), { kind: 'ready', text: 'zh-CN' });
  assert.deepEqual(parseRecognizerLine('H 你好'), { kind: 'interim', text: '你好' });
  assert.deepEqual(parseRecognizerLine('R 你好世界'), { kind: 'final', text: '你好世界' });
  assert.deepEqual(parseRecognizerLine('E no-recognizer'), { kind: 'error', text: 'no-recognizer' });
  assert.deepEqual(parseRecognizerLine('DONE'), { kind: 'done', text: '' });
  // 空行、未知标记、没有正文的 H/R 都当噪音丢掉（不能把空串塞给输入框）。
  assert.equal(parseRecognizerLine('').kind, 'ignore');
  assert.equal(parseRecognizerLine('   ').kind, 'ignore');
  assert.equal(parseRecognizerLine('whatever').kind, 'ignore');
  assert.equal(parseRecognizerLine('H').kind, 'ignore');
  assert.equal(parseRecognizerLine('R   ').kind, 'ignore');
});

test('脚本用的是 Windows 自带的离线听写引擎，不是云端、不需要 key', () => {
  const probe = recognizerProbeScript();
  assert.match(probe, /System\.Speech/, '用 .NET 自带的语音引擎（离线）');
  assert.match(probe, /InstalledRecognizers/, '先看这台机器装了哪些识别器');
  assert.doesNotMatch(probe, /https?:\/\//, '探测不联网');

  const stream = recognizerStreamScript();
  assert.match(stream, /DictationGrammar/, '自由听写，不是固定命令集');
  assert.match(stream, /SetInputToDefaultAudioDevice/, '麦克风走系统默认输入设备');
  assert.match(stream, /RecognizeMode\]::Multiple/, '连续识别，不是一句一停');
  assert.match(stream, /SpeechHypothesized/, '要有临时结果才能实时上屏');
  assert.match(stream, /SpeechRecognized/, '定稿结果');
  assert.match(stream, /\[Console\]::OutputEncoding = \[System\.Text\.Encoding\]::UTF8/, '中文要按 UTF-8 输出');
  assert.match(stream, /\[Console\]::Out\.Flush\(\)/, '不 flush 就没有实时性');
  assert.doesNotMatch(stream, /https?:\/\//, '识别全在本机，不联网');
});

test('本机识别器探测：Windows 上说得出「有没有、什么语言」', async (context) => {
  if (process.platform !== 'win32') {
    context.skip('只在 Windows 上有这条路径');
    return;
  }
  const available = await windowsRecognizerAvailable(true);
  // 探测必须给出确定结论：要么有识别器（带语言），要么说清为什么没有。
  assert.equal(typeof available.ok, 'boolean');
  if (available.ok) {
    assert.match(String(available.culture), /^[a-z]{2}(-[A-Za-z]{2,4})?$/, `语言标签要像 zh-CN：${available.culture}`);
  } else {
    assert.ok(available.reason, '没有识别器时也要给出原因');
  }
});

test('默认优先本机识别（不开页面），Speech 只是退路', () => {
  /*
   * 用户 2026-11-25 的决定：「不要那个临时听写页」。
   * 编辑器听写必须开一个聚焦的临时编辑器，所以默认（auto）先试本机识别；
   * 本机没有识别器时（例如还没实现的平台）才回到 VS Code Speech。
   */
  const autoStart = PANEL.indexOf('`auto`：**优先不开页面**');
  assert.ok(autoStart > 0, 'auto 分支要有明确注释');
  const autoBody = PANEL.slice(autoStart, PANEL.indexOf('private async offerSpeechInstall(', autoStart));
  const native = autoBody.indexOf('windowsRecognizerAvailable()).ok');
  const speech = autoBody.indexOf('prefersVsCodeSpeech(');
  assert.ok(native > 0 && speech > native, '本机识别必须排在 Speech 之前');
  assert.match(PANEL, /if \(await this\.startNativeVoice\(target\)\) return;/, '本机识别起得来就用它');
  // 再点一次 = 停（按钮像开关）。
  assert.match(PANEL, /if \(this\.nativeVoice \|\| this\.dictation\) \{/, '录音中再点麦克风要能停');
  assert.match(PANEL, /joinVoiceParts\(finalized, text\)/, '定稿要累加，临时结果替换');
});

test('录音时按钮变高亮，两个面板都要能看出「在录」', () => {
  assert.match(PANEL, /private async setVoiceActive\(active: boolean\)/, '宿主统一控制录音状态');
  assert.match(CHAT_JS, /case 'voiceState':/, '主对话框要处理录音状态');
  assert.match(CHAT_JS, /elements\.voiceButton\.classList\.toggle\('voice-recording', Boolean\(message\.active\)\)/, '主对话框录音时切到音波条');
  assert.match(GROUP_SCRIPT, /data\.type === 'voiceState'/, '群窗口按钮高亮');
  assert.match(PANEL, /native\?\.stop\(\)/, '停止时要把子进程收掉（否则麦克风一直开）');
});
