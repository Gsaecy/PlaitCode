/** 任务看板：从群消息折叠出「谁提的、指派给谁、在哪一步」。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeGroupMessage, type SyncGroupMessage, type SyncPeer } from '../sync/lanProtocol';
import { buildTaskBoard, groupTasksByStatus } from '../sync/tasks';

const PHONE: SyncPeer = { id: 'dev-phone', name: '手机 · 浏览器', platform: 'linux', project: 'mobile', version: 'web' };
const HOME: SyncPeer = { id: 'dev-home', name: '家里电脑', platform: 'win32', project: 'foo', version: '0.7.4' };
const OFFICE: SyncPeer = { id: 'dev-office', name: '公司电脑', platform: 'darwin', project: 'foo', version: '0.7.4' };

function message(
  from: SyncPeer,
  input: Parameters<typeof makeGroupMessage>[1],
  at: number,
  seed: string,
): SyncGroupMessage {
  const built = makeGroupMessage(from, input, at, seed);
  assert.ok(built, '测试消息构造失败');
  return built;
}

test('看板：甲方一条需求 + 进度 + 结果，折叠成一条已完成任务', () => {
  const requirementId = 'req-1';
  const board = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '把登录页的按钮改成圆角\n细节略', requirementId, project: 'foo', assignee: 'dev-office' }, 1_000, 'a'),
    message(OFFICE, { author: 'agent', phase: 'progress', body: '正在改 Button.tsx', requirementId }, 2_000, 'b'),
    message(OFFICE, { author: 'agent', phase: 'result', body: '已完成，改了 2 个文件', requirementId }, 3_000, 'c'),
  ]);

  assert.equal(board.length, 1);
  const task = board[0]!;
  assert.equal(task.id, requirementId);
  assert.equal(task.title, '把登录页的按钮改成圆角');
  assert.equal(task.project, 'foo');
  assert.equal(task.assignee, 'dev-office');
  assert.equal(task.requester, '手机 · 浏览器');
  assert.equal(task.status, 'done');
  assert.equal(task.lastLine, '已完成，改了 2 个文件');
  assert.equal(task.createdAt, 1_000);
  assert.equal(task.updatedAt, 3_000);
});

test('看板：追问状态优先于进行中，且甲方回答后回到进行中', () => {
  const id = 'req-2';
  const asked = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '做个导出', requirementId: id }, 1_000, 'a'),
    message(OFFICE, { author: 'agent', phase: 'analysis', body: '先拆一下', requirementId: id }, 1_100, 'b'),
    message(OFFICE, { author: 'agent', phase: 'question', body: '导出 CSV 还是 Excel？', requirementId: id }, 1_200, 'c'),
  ]);
  assert.equal(asked[0]?.status, 'question');
  assert.equal(asked[0]?.lastLine, '导出 CSV 还是 Excel？');

  const answered = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '做个导出', requirementId: id }, 1_000, 'a'),
    message(OFFICE, { author: 'agent', phase: 'question', body: '导出 CSV 还是 Excel？', requirementId: id }, 1_200, 'c'),
    message(PHONE, { author: 'user', phase: 'answer', body: 'Excel', requirementId: id }, 1_300, 'd'),
  ]);
  assert.equal(answered[0]?.status, 'running');
});

test('看板：已完成的任务不会被迟到的进度消息拉回进行中', () => {
  const id = 'req-3';
  const board = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '修个 bug', requirementId: id }, 1_000, 'a'),
    message(OFFICE, { author: 'agent', phase: 'result', body: '已修好', requirementId: id }, 2_000, 'b'),
    message(HOME, { author: 'agent', phase: 'progress', body: '我这边还在看', requirementId: id }, 3_000, 'c'),
  ]);
  assert.equal(board[0]?.status, 'done');
  assert.equal(board[0]?.lastLine, '我这边还在看', '最近一条仍要更新，但状态不能被拉回去');
});

test('看板：只有 agent 的解析没有甲方需求时不成任务', () => {
  const board = buildTaskBoard([
    message(OFFICE, { author: 'agent', phase: 'analysis', body: '我自己想到一件事', requirementId: 'req-x' }, 1_000, 'a'),
  ]);
  assert.equal(board.length, 0);
});

test('看板：多条任务按最近更新排序，limit 生效', () => {
  const board = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '老任务', requirementId: 'req-old' }, 1_000, 'a'),
    message(PHONE, { author: 'user', phase: 'requirement', body: '新任务', requirementId: 'req-new' }, 5_000, 'b'),
    message(PHONE, { author: 'user', phase: 'requirement', body: '中间任务', requirementId: 'req-mid' }, 3_000, 'c'),
  ]);
  assert.deepEqual(board.map((task) => task.id), ['req-new', 'req-mid', 'req-old']);
  assert.equal(buildTaskBoard([], 10).length, 0);
  assert.equal(buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '一', requirementId: 'r1' }, 1_000, 'a'),
    message(PHONE, { author: 'user', phase: 'requirement', body: '二', requirementId: 'r2' }, 2_000, 'b'),
  ], 1).length, 1);
});

test('看板：分组顺序是 等你回复 → 进行中 → 待接 → 已完成，空组不出现', () => {
  const board = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '待接的', requirementId: 'r-open' }, 1_000, 'a'),
    message(PHONE, { author: 'user', phase: 'requirement', body: '在做的', requirementId: 'r-run' }, 2_000, 'b'),
    message(OFFICE, { author: 'agent', phase: 'progress', body: '在改', requirementId: 'r-run' }, 2_100, 'c'),
    message(PHONE, { author: 'user', phase: 'requirement', body: '等回复的', requirementId: 'r-q' }, 3_000, 'd'),
    message(OFFICE, { author: 'agent', phase: 'question', body: '选哪个', requirementId: 'r-q' }, 3_100, 'e'),
  ]);
  const groups = groupTasksByStatus(board);
  assert.deepEqual(groups.map((group) => group.status), ['question', 'running', 'open']);
  assert.deepEqual(groups[0]?.tasks.map((task) => task.id), ['r-q']);
});

test('看板：没指派 / 没项目的旧消息也能正常成任务（向后兼容）', () => {
  const board = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '老版本发的需求', requirementId: 'r-legacy' }, 1_000, 'a'),
  ]);
  assert.equal(board.length, 1);
  assert.equal(board[0]?.assignee, '');
  assert.equal(board[0]?.project, '');
  assert.equal(board[0]?.status, 'open');
});

test('看板：需求因缺 API Key 未执行时是「未执行」，不能显示已完成', () => {
  const id = 'req-blocked';
  const board = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '改个按钮', requirementId: id }, 1_000, 'a'),
    message(OFFICE, { author: 'agent', phase: 'blocked', body: '电脑上的 agent 没有开始处理：请先为 DeepSeek 配置 API Key。', requirementId: id }, 2_000, 'b'),
  ]);
  assert.equal(board.length, 1);
  assert.equal(board[0]?.status, 'blocked');
  assert.match(board[0]!.lastLine, /API Key/);

  // 修好 Key 之后重新跑，状态要能往前走，不能永远卡在 blocked
  const resumed = buildTaskBoard([
    message(PHONE, { author: 'user', phase: 'requirement', body: '改个按钮', requirementId: id }, 1_000, 'a'),
    message(OFFICE, { author: 'agent', phase: 'blocked', body: '没配 Key', requirementId: id }, 2_000, 'b'),
    message(OFFICE, { author: 'agent', phase: 'progress', body: '开始改 Button.tsx', requirementId: id }, 3_000, 'c'),
  ]);
  assert.equal(resumed[0]?.status, 'running');
});