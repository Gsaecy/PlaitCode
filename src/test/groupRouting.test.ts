import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GROUP_DECISION_TTL_MS, approvalVerdict, routeGroupMessage, shouldReportToGroup, syncToolAllowed } from '../sync/groupRouting';

/**
 * 群消息分流的**执行级**验证（不是读源码猜）。
 *
 * 现场（2026-11-25，真实群记录）：甲方在 macOS 那台的输入框里选了「macOS（本机）」
 * 再发消息，群里却显示「没有 @ 任何人」；另一台收到当成说给所有人照跑，
 * 被指派的那台反而没执行。记录里那两条是：
 *
 *     phase=answer from=<发送方> assignee=[] to=[]
 *
 * 也就是**被「回答/结算」捷径接走了**：那条捷径只发 `phase=answer`，
 * 既不带宽 `assignee` 也不带 `to` 就 return。这不是某台设备的特例。
 *
 * 这里用三台设备（A/B/C）把全部分流组合跑一遍 —— 任意台数都成立。
 */

const A = 'dev-a';
const B = 'dev-b';
const C = 'dev-c';
const NOW = 1_700_000_000_000;

/** 甲方当时那句：二十来个字的**新需求**，不是选项答案。 */
const REAL_MESSAGE = '1.实测，删掉邮箱刷新没有继续出现了；2.但是中文英文切换，选中状态会刷新到第一个邮箱，而不是保持在选中的邮箱那里';

test('现场复现：有卡片在等 + 明确选了执行设备 → 仍然是派活，指派不丢', () => {
  const route = routeGroupMessage({
    text: REAL_MESSAGE,
    explicitAssignee: B,
    pendingDecision: { options: ['先修 A', '先修 B'], at: NOW - 30_000 },
    now: NOW,
  });
  assert.deepEqual(route, { kind: 'requirement', assignee: B }, '指派给谁就派给谁，不许被结算卡吞掉');
});

test('现场复现：有卡片在等 + 这句话是新需求 → 走需求，而不是被当成「你自己说怎么做」', () => {
  const route = routeGroupMessage({
    text: REAL_MESSAGE,
    pendingDecision: { options: ['先修 A', '先修 B'], at: NOW - 30_000 },
    now: NOW,
  });
  assert.equal(route.kind, 'requirement', '普通陈述句不是自由回答');
});

test('卡片确实在等，且甲方真的在选：数字 / 选项名 / 自由回答都还能结算', () => {
  const pending = { options: ['先修 A', '先修 B'], at: NOW - 30_000 };
  assert.deepEqual(routeGroupMessage({ text: '2', pendingDecision: pending, now: NOW }), { kind: 'decision', index: 1 });
  assert.deepEqual(routeGroupMessage({ text: '选 1', pendingDecision: pending, now: NOW }), { kind: 'decision', index: 0 });
  assert.deepEqual(routeGroupMessage({ text: '我选先修 B', pendingDecision: pending, now: NOW }), { kind: 'decision', index: 1 });
  assert.deepEqual(
    routeGroupMessage({ text: '你自己看着办', pendingDecision: pending, now: NOW }),
    { kind: 'decision-custom', answer: '你自己看着办' },
    '明确的自由回答仍然算答案',
  );
});

test('过期的卡片不再接管任何消息（否则所有短句都会被它吃掉）', () => {
  const stale = { options: ['先修 A'], at: NOW - GROUP_DECISION_TTL_MS - 1 };
  assert.equal(routeGroupMessage({ text: '就这样', pendingDecision: stale, now: NOW }).kind, 'requirement');
  assert.equal(routeGroupMessage({ text: '1', pendingDecision: stale, now: NOW }).kind, 'requirement');
});

test('审批卡：授权/拒绝话术才结算；带明确指派时不许误放行', () => {
  assert.deepEqual(routeGroupMessage({ text: '授权', pendingApproval: true, now: NOW }), { kind: 'approval', allow: true });
  assert.deepEqual(routeGroupMessage({ text: '拒绝', pendingApproval: true, now: NOW }), { kind: 'approval', allow: false });
  assert.equal(routeGroupMessage({ text: '这个功能还是不对', pendingApproval: true, now: NOW }).kind, 'requirement');
  assert.deepEqual(
    routeGroupMessage({ text: '授权', explicitAssignee: C, pendingApproval: true, now: NOW }),
    { kind: 'requirement', assignee: C },
    '明确指派的话带着「授权」二字，也不能拿去结算一张无关的审批卡',
  );
  assert.equal(approvalVerdict('不同意'), 'deny');
  assert.equal(approvalVerdict('随便聊聊'), undefined);
});

test('完全访问授权：只有「上一条是权限申请」才认，且带指派时不接管', () => {
  assert.equal(routeGroupMessage({ text: '授权', permissionRequestOpen: true, now: NOW }).kind, 'authorize');
  assert.equal(routeGroupMessage({ text: '授权', permissionRequestOpen: false, now: NOW }).kind, 'requirement');
  assert.equal(
    routeGroupMessage({ text: '授权', permissionRequestOpen: true, explicitAssignee: A, now: NOW }).kind,
    'requirement',
  );
});

test('回答追问：有提问方才定向；点名别的设备算派活；提问方为空不许发广播式回答', () => {
  assert.deepEqual(
    routeGroupMessage({ text: '接着做', openAskerId: A, now: NOW }),
    { kind: 'answer', to: A },
    '回答定向回给提问那台',
  );
  assert.deepEqual(
    routeGroupMessage({ text: '接着做', openAskerId: A, explicitAssignee: C, now: NOW }),
    { kind: 'requirement', assignee: C },
    '点名别的设备 = 派活，不是回答',
  );
  assert.equal(
    routeGroupMessage({ text: '接着做', openAskerId: '', now: NOW }).kind,
    'requirement',
    '提问方为空时降级成需求，绝不发一条没有 to 的「回答」',
  );
});

test('没有任何卡片 / 追问时：就是一条普通需求（指派为空 = 广播）', () => {
  assert.deepEqual(routeGroupMessage({ text: '把颜色改深一点', now: NOW }), { kind: 'requirement', assignee: '' });
  assert.deepEqual(routeGroupMessage({ text: '把颜色改深一点', explicitAssignee: C, now: NOW }), { kind: 'requirement', assignee: C });
});

test('分流结论与设备名、台数无关：同一个函数对 A / B / C 结果对称', () => {
  for (const device of [A, B, C]) {
    const route = routeGroupMessage({
      text: '改一下样式',
      explicitAssignee: device,
      pendingDecision: { options: ['x'], at: NOW },
      pendingApproval: true,
      permissionRequestOpen: true,
      openAskerId: A,
      now: NOW,
    });
    assert.deepEqual(route, { kind: 'requirement', assignee: device }, `指派给 ${device} 就派给 ${device}`);
  }
});

/**
 * 泄露事故（用户 2026-11-25）：「普通对话框的消息，agent 回复到了团队群的对话框里」。
 *
 * 现场是两条通道一起漏：
 *  1. 收尾回报只要 `lanSync` 存在就执行（需求号还会退回「群里最近一条需求」）——
 *     随便一条普通对话跑完，它的回复就被当成那条群需求的结果发进群；
 *  2. 工具清单里永远有 `team_sync`，模型在普通对话里也能把内容当结果发进群。
 *
 * 这里执行验证判定，不看源码长相：普通对话**没有任何**通向群的路。
 */
test('普通对话（没有群标记、没有需求号）绝不回群、也不带 team_sync', () => {
  const normalRun = { conversationId: 'chat-1' };
  assert.equal(shouldReportToGroup({ ...normalRun, groupConversationId: 'team-1' }), false, '普通对话不许回群');
  assert.equal(shouldReportToGroup(normalRun), false, '连团队对话都没解析出来也不许回群');
  assert.equal(syncToolAllowed({ isTeamRun: false }), false, '普通对话不许带 team_sync');
});

test('群里的活照旧回群、照旧有 team_sync（三种来源都覆盖）', () => {
  // 起跑时打的标记（群消息 / 对端需求 / 团队任务对话）。
  assert.equal(shouldReportToGroup({ groupRun: true, conversationId: 'team-1' }), true);
  assert.equal(syncToolAllowed({ isTeamRun: true }), true);
  // 带着真实需求号的续跑（暂停恢复、模型换了会话号）。
  assert.equal(shouldReportToGroup({ syncRequirementId: 'req-1', conversationId: 'chat-2' }), true);
  assert.equal(syncToolAllowed({ isTeamRun: false, syncRequirementId: 'req-1' }), true);
  // 回落到「当前就是团队任务那条对话」。
  assert.equal(shouldReportToGroup({ conversationId: 'team-1', groupConversationId: 'team-1' }), true);
});

test('「群里最近一条需求」这条兜底只对群里的活生效', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  const index = panel.indexOf('private async reportSyncOutcome');
  assert.ok(index > 0, '找不到 reportSyncOutcome');
  // 按函数结束切（下一个方法前的文档注释）：写死长度会被注释挤出窗口。
  const next = panel.indexOf('  /**', panel.indexOf('this.updateAgentStatus();', index));
  const body = panel.slice(index, next > index ? next : index + 6_000);
  const guard = body.indexOf('if (!shouldReportToGroup({');
  const fallback = body.indexOf('this.lanSync.latestRequirementId()');
  assert.ok(guard > 0, '必须有「不是群里的活就直接返回」的硬闸');
  assert.ok(fallback > guard, '需求号兜底必须排在这道闸之后 —— 否则普通对话会被当成群需求');
  assert.equal(syncToolAllowed({ isTeamRun: false }), false);
  assert.match(panel, /syncToolAllowed\(\{\s*isTeamRun: isTeamRun \|\| this\.isTeamConversation/, '工具清单要按「是不是团队那一轮」裁剪');
});