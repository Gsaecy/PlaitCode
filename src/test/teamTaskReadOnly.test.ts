import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { tt } from '../core/i18n';
import { rejectsComposerInput, rejectsTeamControl, type TeamControlKind } from '../sync/teamTask';

/**
 * 「团队任务」对话 = 只读执行窗口（用户 2026-11-24）：
 *   「我说的删掉不只是 UI 层面，还是功能层面，避免再出现干扰的情况」
 *   「所有它们执行团队任务窗口的指令，都来自团队群」
 *
 * 这里**执行**「哪条输入该被拒」的规则；界面隐藏（CSS）无法"执行"，
 * 单独留一条静态断言并注明原因。
 */

const KINDS: TeamControlKind[] = ['send', 'setPermissionPreset', 'setAgentMaxSteps', 'setReasoningEffort'];

test('功能层面拒绝输入：四种操作在团队任务对话里全部被拒，普通对话全部放行', () => {
  for (const kind of KINDS) {
    assert.equal(rejectsTeamControl(kind, true), true, `${kind} 在团队任务对话里必须被拒`);
    assert.equal(rejectsTeamControl(kind, false), false, `${kind} 在普通对话里不该被拒`);
  }
});

test('send() 开头那道闸：用户输入被拒，群里派下来的活（有 origin）放行', () => {
  assert.equal(rejectsComposerInput({ isTeamConversation: true, hasOrigin: false }), true, '用户在窗口里敲字 → 拒');
  assert.equal(rejectsComposerInput({ isTeamConversation: true, hasOrigin: true }), false, '群里的活 → 放行');
  assert.equal(rejectsComposerInput({ isTeamConversation: false, hasOrigin: false }), false, '普通对话 → 放行');
});

test('拒绝时给的是可读提示，不是静默失败', () => {
  const text = tt('sync.teamTaskReadOnly');
  assert.ok(text.trim().length > 0, '文案不能是空串');
  assert.match(text, /团队群/, '要告诉用户指令从团队群下达');
  // 面板真的把这条文案发出去（不是只存在于 i18n 表里）。
  assert.match(readFileSync('src/views/chatPanel.ts', 'utf8'), /tt\('sync\.teamTaskReadOnly'\)/);
});

test('界面层：输入框与运行控件在团队任务里隐藏（CSS 无运行时行为，只能静态核对）', () => {
  /*
   * 这一条**必须**是静态的：CSS 规则本身没有可执行的入口。
   * 行为层面的保证在上面三条（功能层面拒绝），这里只确认「界面也收掉了」。
   */
  const css = readFileSync('media/chat.css', 'utf8');
  for (const selector of ['#promptInput', '.composer-runtime-controls', '#attachButton', '#voiceButton', '#sendButton']) {
    assert.ok(css.includes(`body.team-task ${selector}`), `CSS 缺少隐藏 ${selector}`);
  }
  assert.match(css, /body\.team-task #composer \{ display: none !important; \}/, '整个输入框要收掉');
  assert.match(css, /body\.team-task #stopButton \{[^}]*display: inline-flex !important/, '停止按钮要常驻可见');
});

test('「停止执行」的状态机由 DOM 层验证（见 teamStopButtonDom.test.ts）', () => {
  /*
   * 空闲灰 + 不可点、运行中红色闪动，已经在 `teamStopButtonDom.test.ts` 里
   * 用 linkedom 真挂载 `media/chat.js` 验证过（点得动 / 点不动都断言了）。
   * 这里只守一个前提：那颗按钮初始必须是 disabled（否则页面加载瞬间就能点）。
   */
  assert.match(
    readFileSync('src/views/chatPanel.ts', 'utf8'),
    /<button id="teamTaskStop" class="stop-button" type="button" disabled aria-disabled="true"/,
    '初始状态必须是禁用的（还没开始跑）',
  );
});
