import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 「团队任务」对话 = 只读执行窗口（用户 2026-11-24）：
 *   「我说的删掉不只是 UI 层面，还是功能层面，避免再出现干扰的情况」
 *   「所有它们执行团队任务窗口的指令，都来自团队群」
 *
 * 所以三条都要成立：
 *  1. 界面：收掉输入框、权限 / 步骤 / 思考深度，只留「停止执行」；
 *  2. 功能：send / setPermissionPreset / setAgentMaxSteps / setReasoningEffort 一律拒绝；
 *  3. 保底：`send()` 自己再拦一次（别的入口也绕不过去）。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
const CSS = readFileSync('media/chat.css', 'utf8');
const CHAT_JS = readFileSync('media/chat.js', 'utf8');

test('宿主把「这条对话是不是团队任务」告诉界面', () => {
  assert.match(PANEL, /teamTask: this\.isTeamConversation\(this\.activeConversationId\)/, 'state 里要带 teamTask');
  assert.match(CHAT_JS, /classList\.toggle\('team-task', message\.teamTask === true\)/, '界面要据此切 class');
});

test('界面收掉输入框与权限/步数，只留停止', () => {
  for (const selector of ['#promptInput', '.composer-runtime-controls', '#attachButton', '#voiceButton', '#sendButton']) {
    assert.ok(CSS.includes(`body.team-task ${selector}`), `CSS 缺少隐藏 ${selector}`);
  }
  assert.match(CSS, /body\.team-task #stopButton \{[^}]*display: inline-flex !important/, '停止按钮要常驻可见');
});

test('功能层面拒绝输入（不只隐藏界面）', () => {
  assert.match(PANEL, /case 'send':[\s\S]{0,400}isTeamConversation/, 'send 要拦');
  assert.match(PANEL, /case 'setPermissionPreset':[\s\S]{0,200}isTeamConversation/, '改权限要拦');
  assert.match(PANEL, /case 'setAgentMaxSteps':[\s\S]{0,200}isTeamConversation/, '改步数要拦');
  assert.match(PANEL, /case 'setReasoningEffort':[\s\S]{0,200}isTeamConversation/, '改思考深度要拦');
});

test('send() 自己再拦一次（队列 / 续跑等入口也绕不过）', () => {
  const index = PANEL.indexOf('private async send(');
  assert.ok(index > 0);
  const body = PANEL.slice(index, index + 1_200);
  assert.match(body, /if \(!options\?\.origin && this\.isTeamConversation/, 'send 开头要有这道闸');
  assert.match(body, /rejectTeamInput/, '要明确拒绝并说明');
});

test('拒绝时告诉用户指令从哪来（不是静默失败）', () => {
  assert.match(PANEL, /tt\('sync\.teamTaskReadOnly'\)/, '要有可读提示');
  assert.match(readFileSync('src/core/i18n.ts', 'utf8'), /'sync\.teamTaskReadOnly'/, 'i18n 要有这条文案');
});
