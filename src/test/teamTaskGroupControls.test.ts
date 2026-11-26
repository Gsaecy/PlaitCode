import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { routeGroupMessage } from '../sync/groupRouting';
import { teamPromptChannel } from '../sync/teamTask';

/**
 * 「团队任务对话框里面的选择、决策、授权，都需要通过团队群来」（用户 2026-11-24）。
 *
 * 三条规则的**结论**由纯函数给出，这里执行验证：
 *  1. 团队任务的决策 / 授权走群，不在窗口里弹卡；
 *  2. 群里回「1」「2」/ 选项名 → 结算选择；
 *  3. 回「授权」→ 结算授权；且**选择优先于审批**（否则「1」会被当成授权词）。
 */

const NOW = 1_700_000_000_000;
const pendingDecision = { options: ['先修 A', '先修 B'], at: NOW - 1_000 };

test('团队任务的选择 / 授权走群，普通对话仍然弹卡', () => {
  assert.equal(teamPromptChannel(true), 'group', '团队任务：群里问');
  assert.equal(teamPromptChannel(false), 'card', '普通对话：窗口里弹卡');
  // 面板两处（决策 / 授权）都用这个结论，而不是各写一遍 if。
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  const uses = (panel.match(/teamPromptChannel\(this\.isTeamConversation\(run\.conversationId\)\) === 'group'/g) ?? []).length;
  assert.equal(uses, 2, '决策与授权两处都要走同一个判定');
});

test('群里回数字 / 选项名能结算选择', () => {
  assert.deepEqual(routeGroupMessage({ text: '2', pendingDecision, now: NOW }), { kind: 'decision', index: 1 });
  assert.deepEqual(routeGroupMessage({ text: '选1', pendingDecision, now: NOW }), { kind: 'decision', index: 0 });
  assert.deepEqual(routeGroupMessage({ text: '先修 B', pendingDecision, now: NOW }), { kind: 'decision', index: 1 });
  assert.deepEqual(routeGroupMessage({ text: '就选「先修 A」吧', pendingDecision, now: NOW }), { kind: 'decision', index: 0 }, '短句里点名选项也算选择');
  /*
   * 长句里顺带提到选项名**不算选择** —— 否则「先修 A 那个文案，B 下周再说」
   * 会被结算成「选了第 1 项」，后面那半句指令直接消失（既不执行、也不进群）。
   */
  const custom = routeGroupMessage({ text: '先修 A 那个文案，B 下周再说', pendingDecision, now: NOW });
  assert.equal(custom.kind, 'requirement', '这是一条新指令，不能被卡吞掉');
});

test('选择在审批之前结算（否则「1」会被当成授权词）', () => {
  const route = routeGroupMessage({
    text: '1',
    pendingDecision,
    pendingApproval: true,
    now: NOW,
  });
  assert.equal(route.kind, 'decision', '同一时刻既有卡片又有审批时，数字是选卡片');
});

test('群里的授权话术结算审批；带明确指派时不误放行', () => {
  const pendingApproval = true;
  assert.deepEqual(routeGroupMessage({ text: '授权', pendingApproval, now: NOW }), { kind: 'approval', allow: true });
  assert.deepEqual(routeGroupMessage({ text: '拒绝', pendingApproval, now: NOW }), { kind: 'approval', allow: false });
  assert.equal(
    routeGroupMessage({ text: '授权给 macOS 那台去做', pendingApproval, explicitAssignee: 'p-mac', now: NOW }).kind,
    'requirement',
    '带指派的话是派活，不能顺手把授权放行',
  );
});

test('界面结构：状态条只有「项目 + 任务简介 + 停止」（静态，CSS/标记无运行时）', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  for (const id of ['teamTaskBar', 'teamTaskProject', 'teamTaskTitle', 'teamTaskStop']) {
    assert.ok(panel.includes(`id="${id}"`), `缺少 ${id}`);
  }
  // 停止按钮真的接了点击（DOM 行为在 teamStopButtonDom.test.ts 里执行验证）。
  assert.match(readFileSync('media/chat.js', 'utf8'), /teamTaskStop'\)\?\.addEventListener\('click', \(\) => post\('stop'\)\)/);
});
