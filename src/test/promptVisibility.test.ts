import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BASE_STATE, mountChatDom, userMessage } from './support/chatDom';

/**
 * 团队协议提示词是「潜规则」：模型必须读到，用户不该在气泡里读一整屏。
 *
 * 用户 2026-11-25：「agent 收到的消息文字很长……除了需求原文外，其他的内容根本不需要
 * 显示出来，只要保证它生效就行了，类似 agent 的潜规则」。
 *
 * 以前这里是「读三处源码看有没有写 displayContent」。现在直接推一条
 * `content = 整段协议` + `displayContent = 甲方原话` 的消息，**看界面到底画了什么**。
 */

const PROTOCOL = [
  '甲方在团队群里提出了一个需求（需求号 req-1）。',
  '需求原文：',
  '把中英文切换的选中态修好',
  '## 谁在说话',
  '- 甲方（用户）：发需求、做决定、给授权的人。',
  '## 交付方式',
  '做完用 team_sync action=result 报结果。',
].join('\n');
const ORIGINAL = '把中英文切换的选中态修好';

test('气泡只显示甲方原话，协议提示词一个字都不出现', async () => {
  const { document, errors, push } = await mountChatDom();
  assert.deepEqual(errors, [], `chat.js 挂载不应该报错：${errors.join(' / ')}`);
  push({
    ...BASE_STATE,
    messages: [userMessage(PROTOCOL, { displayContent: ORIGINAL })],
  });
  const bubble = document.querySelector('.message.user .message-content');
  assert.ok(bubble, '没有画出用户消息');
  const shown = String(bubble.textContent ?? '');
  assert.equal(shown.trim(), ORIGINAL, '气泡里只能是甲方原话');
  assert.doesNotMatch(shown, /谁在说话|team_sync|需求号/, '协议内容不应出现在界面上');
});

test('折叠阈值按「用户看得见的那段」算：协议再长也不该把原话折起来', async () => {
  const { document, push } = await mountChatDom();
  push({
    ...BASE_STATE,
    messages: [userMessage('字'.repeat(2_000), { displayContent: '短原话' })],
  });
  const bubble = document.querySelector('.message.user .message-content');
  assert.equal(bubble.classList.contains('is-clamped'), false, '界面只有一行字，不该出现「展开全文」');
});

test('没有 displayContent 的消息照旧显示 content（普通对话不受影响）', async () => {
  const { document, push } = await mountChatDom();
  push({ ...BASE_STATE, messages: [userMessage('普通的一句话')] });
  assert.equal(String(document.querySelector('.message.user .message-content').textContent).trim(), '普通的一句话');
});

test('落库时两段都要留：content 是协议（给模型），displayContent 是原话（给界面）', () => {
  /*
   * 存档层的行为在 `storage` 里（`appendMessage` 原样保存两个字段），
   * 这里只确认面板确实把两段都写了 —— 少了 displayContent，上面那条界面行为就没有输入。
   */
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /displayContent: options\.displayText\.trim\(\)/, '落库要写原话');
  assert.match(panel, /content: content \|\| tt\('notice\.processAttachments'\)/, 'content 仍是完整提示词');
  assert.match(panel, /const userText = content;/, '换正文之前先把甲方原话存下来');
  assert.match(panel, /displayText: requirement\.detail,/, '对端需求也只显示原文');
});
