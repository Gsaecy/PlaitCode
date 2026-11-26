import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { startVoiceBridge } from '../core/voiceBridge';

/**
 * 语音输入必须真的能用。
 *
 * 用户实况（2026-11-25，截图「语音输入失败: not-allowed」）：webview 是受限 iframe，
 * 没有麦克风权限，也没有扩展 API 能申请 —— 在 webview 里识别注定失败。
 *
 * 所以改成：本机起一个只监听 127.0.0.1 的一次性页面，用**系统浏览器**说话，
 * 识别结果回传给扩展。这里用真实 HTTP 走一遍，确认三件事：
 *   1. 页面能打开（带正确 token）；
 *   2. 没 token / 错 token 一律 403（不能被同机其它页面乱塞文字）；
 *   3. 提交的文字会被 trim 后交给面板，关掉后再也连不上。
 */

const CHAT_JS = readFileSync('media/chat.js', 'utf8');
const GROUP = readFileSync('src/views/groupPanel.ts', 'utf8');
/** 群窗口界面脚本（真文件）；宿主侧仍在 groupPanel.ts。 */
const GROUP_SCRIPT = readFileSync('media/group.js', 'utf8');
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

test('语音页：正确 token 能拿到页面，页面里带识别结果入口', async () => {
  const received: string[] = [];
  const bridge = await startVoiceBridge({ onText: (text) => received.push(text) });
  try {
    const page = await fetch(bridge.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /语音输入/, '页面标题要说人话');
    assert.match(html, /webkitSpeechRecognition/, '用浏览器自带的识别，不需要 key');
    assert.match(html, /发送到 VS Code/, '要有把文字送回来的按钮');
    assert.match(html, /not-allowed/, '浏览器也不允许时要给出可行替代（系统听写）');
    assert.equal(received.length, 0, '还没说话就不该有文字');

    // 提交一句：要 trim 掉首尾空白。
    const token = new URL(bridge.url).searchParams.get('t')!;
    const posted = await fetch(new URL('/text', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: token, text: '  帮我看一下这个报错  ' }),
    });
    assert.equal(posted.status, 200);
    assert.deepEqual(received, ['帮我看一下这个报错']);
    assert.equal(bridge.received, true);
  } finally {
    bridge.dispose();
  }
});

test('语音页：没有 token / 错 token 一律拒绝（本机其它页面也不能往里塞字）', async () => {
  const received: string[] = [];
  const bridge = await startVoiceBridge({ onText: (text) => received.push(text) });
  try {
    const base = new URL(bridge.url);
    const noToken = await fetch(`${base.origin}/`);
    assert.equal(noToken.status, 403);

    const wrongToken = await fetch(`${base.origin}/?t=nope`);
    assert.equal(wrongToken.status, 403);

    const post = await fetch(new URL('/text', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: 'nope', text: '偷偷塞一句' }),
    });
    assert.equal(post.status, 403);
    assert.deepEqual(received, [], '没通过校验的文字不能进输入框');

    // 空文字也不要当成一句话。
    const token = base.searchParams.get('t')!;
    const empty = await fetch(new URL('/text', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: token, text: '   ' }),
    });
    assert.equal(empty.status, 400);
    assert.deepEqual(received, []);
  } finally {
    bridge.dispose();
  }
});

test('语音页：dispose 之后端口关掉（不留监听）', async () => {
  const bridge = await startVoiceBridge({ onText: () => undefined });
  bridge.dispose();
  await assert.rejects(fetch(bridge.url));
});

test('界面：语音走宿主（webview 里不再自己识别）', () => {
  // webview 没有麦克风权限，自己调 start() 必然 not-allowed。
  assert.doesNotMatch(CHAT_JS, /webkitSpeechRecognition/, '主对话框脚本不该再自己识别');
  assert.match(CHAT_JS, /post\('requestVoiceInput'\)/, '点麦克风交给宿主');
  assert.match(CHAT_JS, /case 'voiceText': applyVoiceText\(message\.text, message\.live !== false\)/, '识别结果要能填进输入框');

  assert.match(GROUP_SCRIPT, /vscode\.postMessage\(\{ type: 'voice' \}\)/, '群窗口也交给宿主');
  assert.match(GROUP_SCRIPT, /hwAppendVoiceText/, '群窗口要能接收识别结果');
  assert.doesNotMatch(GROUP_SCRIPT, /webkitSpeechRecognition/, '群窗口脚本不该再自己识别');

  assert.match(PANEL, /startVoiceBridge\(/, '浏览器兜底：一次性语音页');
  assert.match(PANEL, /startEditorDictation\(/, '首选：VS Code 内听写');
  assert.match(PANEL, /vscode\.env\.openExternal\(vscode\.Uri\.parse\(bridge\.url\)\)/, '兜底时用系统浏览器打开');
  assert.match(PANEL, /this\.voiceBridge\?\.dispose\(\)/, '关面板 / 重开时收掉旧服务');
  assert.match(PANEL, /registerGroupVoiceSink/, '群窗口的语音结果有地方接');
});
