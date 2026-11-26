import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BASE_STATE, mountChatDom } from './support/chatDom';

/**
 * 团队任务「停止执行」按钮的真 DOM 行为（不是对着源码猜）。
 *
 * 用户 2026-11-25：「只有在运行的时候显示闪动的红色，没运行的时候显示成灰色，且不可点击」。
 *
 * 这里把 `media/chat.js` 真的挂到 DOM 上，分别推 `streaming: false / true` 两次状态，
 * 直接读按钮的 `disabled` / class / title。
 */

test('空闲：停止按钮禁用 + 灰色（没有 team-stop-running），并解释为什么点不动', async () => {
  const { document, errors, push } = await mountChatDom();
  assert.deepEqual(errors, [], `chat.js 挂载不应该报错：${errors.join(' / ')}`);
  push({ ...BASE_STATE, teamTask: true }, null);
  const button = document.getElementById('teamTaskStop');
  assert.equal(button.disabled, true, '没在跑 → 点不动');
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(button.classList.contains('team-stop-running'), false, '没在跑 → 不是红色闪动状态');
  assert.match(button.title, /没有在运行/, '悬停要说明「现在没活可停」');
});

test('运行中：停止按钮可点 + 进入红色闪动状态', async () => {
  const { document, errors, push } = await mountChatDom();
  assert.deepEqual(errors, [], `chat.js 挂载不应该报错：${errors.join(' / ')}`);
  push({ ...BASE_STATE, teamTask: true }, 'c1');
  const button = document.getElementById('teamTaskStop');
  assert.equal(button.disabled, false, '在跑 → 点得动');
  assert.equal(button.getAttribute('aria-disabled'), 'false');
  assert.equal(button.classList.contains('team-stop-running'), true, '在跑 → 红色闪动');
  assert.doesNotMatch(button.title, /没有在运行/, '在跑时不该说「没活可停」');
});

test('跑完退回空闲：按钮重新禁用（状态是双向的，不是只点亮一次）', async () => {
  const { document, push } = await mountChatDom();
  push({ ...BASE_STATE, teamTask: true }, 'c1');
  const button = document.getElementById('teamTaskStop');
  assert.equal(button.disabled, false);
  push({ ...BASE_STATE, teamTask: true }, null);
  assert.equal(button.disabled, true, '这一轮结束后要重新变灰');
  assert.equal(button.classList.contains('team-stop-running'), false);
});

test('面板把群脚本当**外部文件**加载（不是内联），否则 groupPanelDom 那些只是「读源码」', () => {
  const panel = readFileSync('src/views/groupPanel.ts', 'utf8');
  assert.match(panel, /mediaUri\(webview, this\.extensionUri, 'group\.js'\)/, '要按媒体地址加载 group.js');
  assert.match(panel, /<script nonce="\$\{nonce\}" src="\$\{groupScript\}"><\/script>/, '带 nonce 的外链脚本（CSP 才放行）');
  assert.doesNotMatch(panel, /<script nonce="\$\{nonce\}">\s*const vscode = acquireVsCodeApi\(\);/, '不许再内联那份脚本');
});

test('点停止按钮真的发出 stop 指令（不是只有样式）', async () => {
  const { document, push, posted } = await mountChatDom();
  push({ ...BASE_STATE, teamTask: true }, 'c1');
  const button = document.getElementById('teamTaskStop');
  button.dispatchEvent(new document.defaultView.Event('click'));
  assert.ok(posted.some((message) => message.type === 'stop'), `应当发出 stop，实际：${JSON.stringify(posted)}`);
});
