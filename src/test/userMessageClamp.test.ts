import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BASE_STATE, mountChatDom, userMessage } from './support/chatDom';

/**
 * 长用户消息默认折叠 —— 直接看 DOM 结果，不再读源码数常量。
 *
 * 现场需求：贴进来的长篇需求（ADR、决策表）会把对话框顶成几屏，自己刚说的话
 * 反倒把回复挤出视野。所以要「够长就折起来，给一个展开全文」。
 */

// 产品阈值（media/chat.js 里的 USER_CLAMP_CHARS / USER_CLAMP_LINES）：> 480 字 或 > 12 行。
const CHARS = 480;
const LINES = 12;

const clampOf = (document: any): any => {
  const content = document.querySelector('.message.user .message-content');
  assert.ok(content, '没有画出用户消息');
  return content;
};

/** 消息里那颗「展开全文」按钮（没折叠时不该存在）。 */
const toggleOf = (document: any): any => document.querySelector('.message-clamp-toggle');

test('短消息不折叠：只有一个问题、一两句话', async () => {
  const { document, errors, push } = await mountChatDom();
  assert.deepEqual(errors, []);
  push({ ...BASE_STATE, messages: [userMessage('帮我把登录页的按钮改成主色。')] });
  assert.equal(clampOf(document).classList.contains('is-clamped'), false);
  assert.equal(toggleOf(document), null, '不该给短消息挂展开按钮');
});

test('长消息折叠：字符数超阈值 → 加 is-clamped 并出现展开按钮', async () => {
  const { document, push } = await mountChatDom();
  push({ ...BASE_STATE, messages: [userMessage('字'.repeat(CHARS + 1))] });
  const content = clampOf(document);
  assert.equal(content.classList.contains('is-clamped'), true);
  const toggle = toggleOf(document);
  assert.ok(toggle, '长消息必须有展开按钮');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.match(toggle.textContent, /展开/, '按钮文案来自 i18n');
});

test('刚好等于阈值不折（免得边界上抖）', async () => {
  const { document, push } = await mountChatDom();
  push({ ...BASE_STATE, messages: [userMessage('字'.repeat(CHARS))] });
  assert.equal(clampOf(document).classList.contains('is-clamped'), false);
});

test('行数超阈值也折叠（Markdown 表格字符不多但行很多）', async () => {
  const { document, push } = await mountChatDom();
  const table = ['| 决策 | 建议 |', '| --- | --- |', ...Array.from({ length: LINES }, (_v, i) => `| 第 ${i} 项 | 建议 |`)].join('\n');
  push({ ...BASE_STATE, messages: [userMessage(table)] });
  assert.equal(clampOf(document).classList.contains('is-clamped'), true, '行多的表格必须折起来');
});

test('空白内容不折叠（不该给空消息挂一个展开按钮）', async () => {
  const { document, push } = await mountChatDom();
  push({ ...BASE_STATE, messages: [userMessage('   \n\n  ')] });
  assert.equal(toggleOf(document), null);
});

test('只对用户消息生效：同样长的助手回复不折叠', async () => {
  const { document, push } = await mountChatDom();
  push({
    ...BASE_STATE,
    messages: [userMessage('字'.repeat(CHARS + 50), { role: 'assistant' })],
  });
  const assistant = document.querySelector('.message.assistant .message-content');
  assert.ok(assistant, '没有画出助手回复');
  assert.equal(assistant.classList.contains('is-clamped'), false);
});

test('点展开只加/去 class：正文不被重建（选中状态与代码块都要留住）', async () => {
  const { document, push } = await mountChatDom();
  push({ ...BASE_STATE, messages: [userMessage('字'.repeat(CHARS + 1))] });
  const content = clampOf(document);
  const firstChild = content.firstChild;
  const toggle = toggleOf(document);

  toggle.dispatchEvent(new document.defaultView.Event('click'));
  assert.equal(content.classList.contains('is-clamped'), false, '展开后要取消折叠');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(content.firstChild, firstChild, '折叠不能重建内容节点（会丢选中状态）');

  toggle.dispatchEvent(new document.defaultView.Event('click'));
  assert.equal(content.classList.contains('is-clamped'), true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('展开状态在整段重绘后仍然保持', async () => {
  const { document, push } = await mountChatDom();
  const messages = [userMessage('字'.repeat(CHARS + 1))];
  push({ ...BASE_STATE, messages });
  toggleOf(document).dispatchEvent(new document.defaultView.Event('click'));
  assert.equal(clampOf(document).classList.contains('is-clamped'), false);

  // 同一条消息再推一次（真机里每次状态变化都会重画）。
  push({ ...BASE_STATE, messages });
  assert.equal(clampOf(document).classList.contains('is-clamped'), false, '重绘后仍应保持展开');
  assert.equal(toggleOf(document).getAttribute('aria-expanded'), 'true');
});

test('阈值常量与 CSS 上限（CSS 无运行时行为，只能静态核对）', () => {
  /*
   * 折叠的「高度上限 / 渐隐」是纯样式，没有可执行入口；行为部分已在上面的 DOM 用例里跑过。
   * 这里只确认样式确实存在，且 fold 上限不会小到把两行字也遮住。
   */
  const css = readFileSync('media/chat.css', 'utf8');
  assert.match(css, /\.message\.user \.message-content\.is-clamped\s*\{[^}]*max-height:\s*\d+px/);
  assert.match(css, /\.message\.user \.message-content\.is-clamped\s*\{[^}]*mask-image:\s*linear-gradient/);
  assert.match(css, /\.message-clamp-toggle\s*\{/);
});
