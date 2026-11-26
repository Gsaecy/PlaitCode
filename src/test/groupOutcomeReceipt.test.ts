import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { OUTCOME_OPTIONS, alreadyReportedBySelf, planOutcomePost } from '../sync/outcomePlan';

/**
 * 跑完必须回群（用户 2026-11-24 / 11-25，三次实况）：
 *  - 「执行完任务后没有回答我消息」—— 只写账本、群里静悄悄；
 *  - 「每次我要求群里 agent 互相沟通…就会有 agent 单方面发出结果」—— 队友没回话就发 result；
 *  - 「我看到的是程序或者提示词设置好的程序」—— 正文里拼【项目 X】。
 *
 * 结论 = `planOutcomePost()` 的输出，这里**真的执行**它（以前只能读源码 + 正则）。
 */

const base = {
  outcome: 'completed' as const,
  text: '中英文切换的选中态已经修好，重新打开就能看到。',
  files: ['src/a.ts', 'src/b.ts'],
  requirementId: 'req-1',
  project: 'Personal Workstation OS',
  seconds: 42,
  waitingTeammates: [] as string[],
  alreadyReported: false,
  superseded: false,
};

test('跑完了、也没在等队友 → 发 result，正文只用 agent 自己的话', () => {
  const plan = planOutcomePost(base);
  assert.equal(plan.post?.phase, 'result');
  assert.equal(plan.post?.body, base.text, '正文就是 agent 说的话，不拼机器标签');
  assert.doesNotMatch(plan.post!.body, /【项目/, '项目信息不许拼进正文');
  assert.deepEqual(plan.post?.meta, { project: base.project, seconds: 42, files: base.files });
  assert.equal(plan.askedUser, false, '结果不算「等甲方」');
  assert.equal(plan.ledger?.status, 'done');
});

test('跑完了但队友还没回话 → 只能发 progress，并说清「还不是最终结果」', () => {
  const plan = planOutcomePost({ ...base, waitingTeammates: ['MAGICBOOKV14', 'MAGICBOOKV14', 'guohongyu'] });
  assert.equal(plan.post?.phase, 'progress', '不许单方面宣布一致');
  assert.match(plan.post!.body, /不是最终结果/);
  assert.match(plan.post!.body, /MAGICBOOKV14、guohongyu/, '要去重并点名在等谁');
  assert.equal(plan.askedUser, false, '等的是队友，不是甲方');
  // 账本状态必须和群里说的话一致：还在等 → 不是 done。
  assert.equal(plan.ledger?.status, 'in_progress');
  assert.match(plan.ledger!.note, /还在等/);
});

test('没跑完 → 发 question（群里算「等你回复」），带三个可执行选项', () => {
  const plan = planOutcomePost({ ...base, outcome: 'stopped', text: '卡在权限上，需要你决定下一步。' });
  assert.equal(plan.post?.phase, 'question');
  assert.deepEqual(plan.post?.options, [...OUTCOME_OPTIONS]);
  assert.equal(plan.post?.meta.stopped, true, '要标出是被停下的');
  assert.equal(plan.askedUser, true, '在等甲方 → 指示灯黄闪');
  assert.equal(plan.ledger?.status, 'in_progress');
  assert.match(plan.ledger!.note, /没有跑完/);
});

test('agent 一个字都没说时给兜底正文，但不编内容', () => {
  const plan = planOutcomePost({ ...base, text: '   ' });
  assert.equal(plan.post?.body, '这一轮做完了。');
  const stopped = planOutcomePost({ ...base, outcome: 'failed', text: '' });
  assert.match(stopped.post!.body, /这一轮没有产生结论/);
});

test('被新消息顶掉的那一轮：不发群、不弹「等你回答」，但账本照写', () => {
  const plan = planOutcomePost({ ...base, superseded: true });
  assert.equal(plan.post, undefined, '甲方刚说了下一步，别再挂一个「需要你决定」');
  assert.equal(plan.askedUser, false);
  assert.ok(plan.ledger, '这轮被中断照样有据可查');
  assert.equal(plan.ledger!.status, 'in_progress');
});

test('本机已经报过 result → 不重复发（否则群里刷屏）', () => {
  const plan = planOutcomePost({ ...base, alreadyReported: true });
  assert.equal(plan.post, undefined);
  assert.ok(plan.ledger, '账本仍然要写');
});

test('没有需求号时不写账本，但群消息照发（群里的活可能没有号）', () => {
  const plan = planOutcomePost({ ...base, requirementId: '' });
  assert.equal(plan.ledger, undefined);
  assert.equal(plan.post?.phase, 'result');
});

test('「已经报过」按群里的真实消息判定：只认本机自己的 result / blocked', () => {
  const group = [
    { author: 'agent', phase: 'progress', requirementId: 'req-1', from: { id: 'me' } },
    { author: 'agent', phase: 'result', requirementId: 'req-2', from: { id: 'me' } },
    { author: 'agent', phase: 'result', requirementId: 'req-1', from: { id: 'other' } },
  ];
  assert.equal(alreadyReportedBySelf({ requirementId: 'req-1', selfId: 'me', group }), false, '别人的 result 不算');
  assert.equal(alreadyReportedBySelf({ requirementId: 'req-2', selfId: 'me', group }), true);
  assert.equal(
    alreadyReportedBySelf({ requirementId: 'req-1', selfId: 'me', group: [...group, { author: 'agent', phase: 'blocked', requirementId: 'req-1', from: { id: 'me' } }] }),
    true,
  );
});

test('面板真的按这份结论发群（不是自己再判一遍）', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /const plan = planOutcomePost\(\{/, '收尾要调用纯函数');
  assert.match(panel, /phase: plan\.post\.phase/, '发群用结论里的阶段');
  assert.match(panel, /body: plan\.post\.body/, '发群用结论里的正文');
  assert.doesNotMatch(panel, /【项目 \$\{project/, '正文里不许再拼【项目 X】');
  assert.doesNotMatch(panel, /private async postGroupOutcome/, '旧的就地拼接实现已删除，避免两套规则并存');
});
