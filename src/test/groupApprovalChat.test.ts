import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { approvalVerdict, latestEntry, routeGroupMessage } from '../sync/groupRouting';
import { teamPromptChannel } from '../sync/teamTask';

/**
 * 「授权也在群里说」（用户 2026-11-24）：
 * 「参考 open claw 的模式，agent 很智能的，回答问题、执行任务、需要授权等等都会在群里说」
 *
 * 三件事：群里会出现【权限申请】、群里回「授权」就放行、只结算**最近一张**卡。
 * 前两条以前靠读源码断言，现在执行纯函数；第三条抽成 `latestEntry()` 后也能执行。
 */

const NOW = 1_700_000_000_000;

test('群里回「授权/同意/允许/批准」放行，「拒绝/不同意」停下，其它话不接管', () => {
  assert.equal(approvalVerdict('授权'), 'allow');
  assert.equal(approvalVerdict('同意'), 'allow');
  assert.equal(approvalVerdict('允许这一次'), 'allow');
  assert.equal(approvalVerdict('批准'), 'allow');
  assert.equal(approvalVerdict('拒绝'), 'deny');
  assert.equal(approvalVerdict('不同意'), 'deny');
  assert.equal(approvalVerdict('我先看看代码'), undefined, '无关的话不能被当成授权');
});

test('授权话术过闸：有审批卡时直接结算，没有卡时就是一条普通需求', () => {
  assert.deepEqual(routeGroupMessage({ text: '授权', pendingApproval: true, now: NOW }), { kind: 'approval', allow: true });
  assert.deepEqual(routeGroupMessage({ text: '拒绝', pendingApproval: true, now: NOW }), { kind: 'approval', allow: false });
  assert.equal(routeGroupMessage({ text: '授权', now: NOW }).kind, 'requirement', '没有卡就不要凭空结算');
});

test('团队任务的授权改到群里问（窗口里不弹卡），普通对话仍然弹卡', () => {
  assert.equal(teamPromptChannel(true), 'group');
  assert.equal(teamPromptChannel(false), 'card');
});

test('只结算最近一张卡：连说两句不会把后面的卡一起放掉', () => {
  const resolved: string[] = [];
  const cards = [
    { key: 'a1', value: () => resolved.push('a1') },
    { key: 'a2', value: () => resolved.push('a2') },
    { key: 'a3', value: () => resolved.push('a3') },
  ];
  const last = latestEntry(cards);
  assert.equal(last?.key, 'a3', '取最后插入的那张');
  last!.value();
  assert.deepEqual(resolved, ['a3'], '一次授权只放行一张');
  assert.equal(latestEntry([]), undefined, '没有卡时不结算任何东西');
});

test('面板接线：申请发到群里、按结论结算、结算后从表里撤掉', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  const ask = panel.slice(panel.indexOf('private async askDesktopApproval'));
  const askBody = ask.slice(0, 8_000);
  assert.match(askBody, /【权限申请】/, '群里要有明文申请');
  assert.match(askBody, /phase: 'question'/, '走群里的追问通道');
  assert.match(askBody, /this\.groupApprovals\.set/, '要记下这张卡');

  const settle = panel.slice(panel.indexOf('private settleGroupApprovalRoute'));
  const settleBody = settle.slice(0, 600);
  assert.match(settleBody, /latestEntry\(/, '只取最近一张');
  assert.match(settleBody, /last\.value\(allow\)/, '按分流给出的 allow 结算');
  assert.match(settleBody, /this\.groupApprovals\.delete\(last\.key\)/, '结算后撤掉，点不到过期的卡');
});
