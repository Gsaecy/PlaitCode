import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import {
  TEAM_DISCIPLINE_PROMPT,
  checkTeamPost,
  duplicatesRecent,
  enforceSingleInProgress,
  hasEvidence,
  similarPost,
  staleNudgeBody,
  staleWatchVerdict,
  STALE_POST_HARD_LIMIT,
  STALE_POST_LIMIT,
} from '../sync/processDiscipline';
import { requirementPromptForLocal, type SyncPeer } from '../sync/lanProtocol';

/**
 * 用户 2026-11-26：「团队群里面 agent 很没有逻辑，请查询网络成熟的项目推进工作方法，
 * 来约束行为，避免 agent 相互乱说，又没有逻辑，这里改一下，那里改一下，项目却没有丝毫推进。」
 *
 * 采用的方法论（都能落到可执行判据上）：
 *  - Kanban/Lean 的 **WIP=1**（「no one is multitasking」）→ `enforceSingleInProgress`
 *  - Toyota Kata/PDCA 的「现状 → 目标条件 → **一个**动作」→ `staleNudgeBody`
 *  - Scrum 的 **Definition of Done**（说完成必须带证据）→ `checkTeamPost` 的 result 闸
 *  - SRE 的「没有新事实不发状态」→ `duplicatesRecent`
 *  - Lean 的 **Andon 停线**（长时间没进展就停，而不是继续绕）→ `staleWatchVerdict`
 */

const me: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 'test' };

test('WIP=1：同时只能有一件事进行中，其余降回待办并告知模型', () => {
  const todos = [
    { content: '统一段名', status: 'in_progress' },
    { content: '改上传上限', status: 'in_progress' },
    { content: '补测试', status: 'pending' },
  ];
  const result = enforceSingleInProgress(todos);
  assert.equal(result.todos.filter((todo) => todo.status === 'in_progress').length, 1, '只留一件进行中');
  assert.equal(result.todos[0]!.status, 'in_progress', '保留第一件（手里正做的那件）');
  assert.deepEqual(result.demoted, ['改上传上限'], '要告诉模型哪件被降级');
  // 只有一件时不动。
  const single = enforceSingleInProgress([{ content: 'a', status: 'in_progress' }]);
  assert.deepEqual(single.demoted, []);
});

test('重复发言会被拦（复述不推进项目）', () => {
  assert.equal(similarPost('我把 files 段上限改成 500KB 了', '我把 files 段上限改成 500KB 了。'), true);
  assert.equal(similarPost('我把 files 段上限改成 500KB 了', '单文件上限 4MB，总量 8MB。'), false);
  const recent = ['files 段单文件上限 4MB、总量 8MB', '先等 Windows 那台的数字'];
  assert.equal(duplicatesRecent('files 段单文件上限 4MB、总量 8MB。', recent), true, '几乎一样就算重复');
  assert.equal(duplicatesRecent('已改完 sync.rs:1240 的判定', recent), false, '有新事实就放行');
});

test('「结果」必须带证据（Definition of Done）', () => {
  assert.equal(hasEvidence('改好了'), false);
  assert.equal(hasEvidence('已经处理完毕，请放心'), false);
  assert.equal(hasEvidence('改了 src/mail/sync.rs:1240，跑 npm run check 通过'), true);
  assert.equal(hasEvidence('单文件上限 4MB，总量 8MB'), true);
  assert.equal(hasEvidence('第 175 行的判断改成了 >='), true);

  assert.equal(checkTeamPost({ body: '都弄好了', phase: 'result', recent: [] }).action, 'reject');
  assert.match(
    checkTeamPost({ body: '都弄好了', phase: 'result', recent: [] }).guidance ?? '',
    /证据/,
    '要说明为什么被拒、该怎么改',
  );
  // 同样的内容当 progress 发是允许的（还没验证就该算进展）。
  assert.equal(checkTeamPost({ body: '都弄好了', phase: 'progress', recent: [] }).action, 'accept');
});

test('停线：绕到一定条数就提醒，再绕就真的停下', () => {
  assert.equal(staleWatchVerdict(STALE_POST_LIMIT - 1), 'ok');
  assert.equal(staleWatchVerdict(STALE_POST_LIMIT), 'nudge');
  assert.equal(staleWatchVerdict(STALE_POST_HARD_LIMIT), 'hold');
  const body = staleNudgeBody(STALE_POST_LIMIT);
  assert.match(body, /没有推进/);
  assert.match(body, /下一步/);
  assert.match(body, /一件事/, '只让它回答一件事（Toyota Kata 的目标条件）');
});

test('服务层：重复发言真的发不出去，且回给模型的话说明了原因', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-discipline-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  try {
    const first = await service.postGroup({
      author: 'agent',
      phase: 'progress',
      body: 'files 段单文件上限 4MB、总量 8MB，超了跳过该文件。',
    });
    assert.equal(first.ok, true, '第一条正常发');

    const duplicate = await service.postGroup({
      author: 'agent',
      phase: 'progress',
      body: 'files 段单文件上限 4MB、总量 8MB，超了跳过该文件',
    });
    assert.equal(duplicate.ok, false, '几乎一样的第二条要被拦下');
    assert.match(duplicate.message, /重复|下一步/, '要告诉它换个做法');

    // 甲方的发言不受这条纪律约束（他可以重复强调）。
    const user = await service.postGroup({ author: 'user', phase: 'requirement', body: '快点' });
    assert.equal(user.ok, true);
    const userAgain = await service.postGroup({ author: 'user', phase: 'requirement', body: '快点' });
    assert.equal(userAgain.ok, true, '甲方重复说话不该被机器拦');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('服务层：连续发没有推进的发言 → 群里出现一条停线提醒', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-stale-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  try {
    await service.shareRequirement('把同步打通', undefined, []);
    // 每句都不一样（避开去重），但都没有推进信号。
    for (let index = 0; index < STALE_POST_LIMIT; index += 1) {
      await service.postGroup({ author: 'agent', phase: 'progress', body: `第 ${index} 次解释：我觉得应该先看看别的方案再决定。` });
    }
    const nudges = service.recentGroup(30).filter((item) => item.body.includes('没有推进'));
    assert.equal(nudges.length, 1, '到阈值要停线提醒一次（不刷屏）');
    assert.match(nudges[0]!.body, /下一步/);
    // 甲方发话后清零，之后还可以正常讨论。
    await service.postGroup({ author: 'user', phase: 'requirement', body: '就按第一个方案做' });
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('纪律进了提示词：模型一开始就知道这些规则', async () => {
  const requirement = { id: 'r-1', from: me, title: '打通同步', detail: 'x', createdAt: 1, project: 'app' };
  const prompt = requirementPromptForLocal(requirement as never, me, [], { planPhase: 'negotiate' });
  assert.match(prompt, /过程纪律/);
  assert.match(prompt, /单件流/, 'WIP=1');
  assert.match(prompt, /一个/, '每轮只推进一个动作');
  assert.match(prompt, /证据/);
  assert.ok(TEAM_DISCIPLINE_PROMPT.includes('过程纪律'));
});
