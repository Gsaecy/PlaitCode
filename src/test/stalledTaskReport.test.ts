import assert from 'node:assert/strict';
import test from 'node:test';
import { makeGroupMessage, parseSyncMessage, type SyncPeer } from '../sync/lanProtocol';
import { OUTCOME_OPTIONS, planOutcomePost } from '../sync/outcomePlan';

/**
 * 没跑完必须在群里说清并能继续 —— 但**正文只用 agent 自己说的话**。
 *
 * 用户 2026-11-24：
 *  「任务没执行完，agent 停止了…都需要在团队群里说明，或者讨论，得到解答下阶段再继续」
 *  「我看到的是程序或者提示词设置好的程序，而不是 agent 的智能输出输入和互相对话沟通」
 *
 * 所以：项目 / 用时 / 改动文件 / 被停止 → 结构化 `meta`；选项 → 结构化 `options`；
 * `body` 只放 agent 自己写的话。结论由 `planOutcomePost` 给出，这里**执行**验证。
 */

const win: SyncPeer = { id: 'p-win', name: 'PC', platform: 'win32', project: 'app', version: 't' };
const stoppedPlan = () => planOutcomePost({
  outcome: 'stopped',
  text: '卡在权限上，需要你决定下一步。',
  files: ['a.ts'],
  requirementId: 'req-1',
  project: 'app',
  seconds: 12,
  waitingTeammates: [],
  alreadyReported: false,
  superseded: false,
});

test('没跑完时仍是 question（群里算「等你回复」，下一句能接上）', () => {
  assert.equal(stoppedPlan().post?.phase, 'question');
});

test('没跑完：正文不再拼【需要你决定】/停在这里/请回一句就继续', () => {
  const body = stoppedPlan().post!.body;
  assert.doesNotMatch(body, /【需要你决定】/, '不要再由程序起标题');
  assert.doesNotMatch(body, /停在这里：/, '不要拼「停在这里」');
  assert.doesNotMatch(body, /请回一句就继续/, '不要拼恢复方式，改成可点选项');
});

test('没跑完：选项与元信息走结构化字段', () => {
  const post = stoppedPlan().post!;
  assert.deepEqual(post.options, [...OUTCOME_OPTIONS], '选项要是数组');
  assert.equal(post.meta.stopped, true, '要标出这一轮是被停止的');
  assert.equal(post.meta.seconds, 12, '用时进 meta');
  assert.deepEqual(post.meta.files, ['a.ts'], '改动文件进 meta');
  assert.equal(post.meta.project, 'app', '项目进 meta');
});

test('跑完：result + 正文是 agent 自己的结论', () => {
  const plan = planOutcomePost({
    outcome: 'completed',
    text: '中英文切换的选中态修好了。',
    files: [],
    requirementId: 'req-1',
    waitingTeammates: [],
    alreadyReported: false,
    superseded: false,
  });
  assert.equal(plan.post?.phase, 'result');
  assert.equal(plan.post?.body, '中英文切换的选中态修好了。', '正文用 agent 自己的话');
});

test('协议过网保留 replyTo / options / meta', () => {
  const built = makeGroupMessage(win, {
    author: 'agent',
    phase: 'question',
    body: '导出要 CSV 还是 Excel？',
    options: ['CSV', 'Excel'],
    meta: { project: 'app', seconds: 12, files: ['a.ts'], stopped: true },
  }, 10, 'seed')!;
  assert.deepEqual(built.options, ['CSV', 'Excel']);
  assert.equal(built.meta?.seconds, 12);

  const parsed = parseSyncMessage(JSON.parse(JSON.stringify(built)));
  assert.ok(parsed && parsed.kind === 'group');
  assert.deepEqual(parsed.options, ['CSV', 'Excel'], '选项要过网');
  assert.equal(parsed.meta?.stopped, true, '停止标记要过网');
  assert.deepEqual(parsed.meta?.files, ['a.ts'], '改动文件要过网');
});

test('meta 不合法时不会把脏数据带进界面', () => {
  const built = makeGroupMessage(win, {
    author: 'agent',
    phase: 'progress',
    body: '在做',
    meta: { seconds: -5, files: [''], project: '   ' },
  }, 10, 'seed')!;
  assert.equal(built.meta, undefined, '空/非法 meta 直接不要');
});
