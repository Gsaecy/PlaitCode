import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskBoard } from '../sync/tasks';
import { makeGroupMessage, makeRequirement, type SyncPeer } from '../sync/lanProtocol';

/**
 * 看板「待接 / 未指派」的根因（用户 2026-11-24）：
 * 「报数，我直接发，两个 agent 都回复了，但是待接那里却显示未指派」。
 *
 * 原因是发消息与建需求的顺序反了：`postGroup` 在需求还不存在时拿不到需求号，
 * 退回消息自己的 id，于是甲方那条和 agent 的回复挂在两个号上，看板永远配不上。
 */

const win: SyncPeer = { id: 'p-win', name: 'MagicBookV14 · win32', platform: 'win32', project: 'app', version: 't' };

/** 模拟修复后的顺序：先建需求，再发群消息，并且都带同一个号。 */
function conversation(assignee = ''): ReturnType<typeof buildTaskBoard> {
  const requirement = makeRequirement(win, '报数', 1000, 's')!;
  if (assignee) requirement.assignee = assignee;
  const userMessage = makeGroupMessage(win, {
    author: 'user',
    phase: 'requirement',
    body: '报数',
    requirementId: requirement.id,
    ...(assignee ? { assignee } : {}),
  }, 1001, 'a')!;
  const reply = makeGroupMessage(win, {
    author: 'agent',
    phase: 'result',
    body: '报到：我在 MagicBookV14 上。',
    requirementId: requirement.id,
  }, 1002, 'b')!;
  const progress = makeGroupMessage(win, {
    author: 'agent',
    phase: 'progress',
    body: '开始执行',
    requirementId: requirement.id,
  }, 1003, 'c')!;
  return buildTaskBoard([userMessage, progress, reply]);
}

test('甲方那条和 agent 的回复在同一个需求号上，看板能配对', () => {
  const board = conversation();
  assert.equal(board.length, 1, '一条需求只该出现一张卡');
  assert.equal(board[0]!.title, '报数');
  assert.equal(board[0]!.status, 'done', 'agent 报了结果，看板就该是已完成，不能停在待接');
});

test('没指派任何人时，卡上不该是「未指派」这种误导状态', () => {
  const board = conversation();
  assert.equal(board[0]!.assignee, '', '没指派就是空，由界面显示成「全部设备」');
});

test('指派给别人时看板带指派信息', () => {
  const board = conversation('p-mac');
  assert.equal(board[0]!.assignee, 'p-mac');
});

test('需求号对不上的旧卡不会永远挂在「待接」', () => {
  const requirement = makeRequirement(win, '报数', 1000, 's')!;
  const orphan = makeGroupMessage(win, {
    author: 'user',
    phase: 'requirement',
    body: '报数',
    // 关键：没有带需求号 → makeGroupMessage 会退回消息自己的 id
  }, 1001, 'x')!;
  const reply = makeGroupMessage(win, {
    author: 'agent',
    phase: 'result',
    body: '做完了',
    requirementId: requirement.id,
  }, 1002, 'y')!;

  // 刚发出时还是一条「待接」（正常：确实没人接）。
  const fresh = buildTaskBoard([orphan, reply]);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0]!.status, 'open');

  // 群里继续有人说话、时间过了 TTL：这条没人接的旧卡从看板消失。
  const later = makeGroupMessage(win, {
    author: 'user',
    phase: 'analysis',
    body: '别的问题',
  }, 1001 + 11 * 60_000, 'z')!;
  const stale = buildTaskBoard([orphan, reply, later]);
  assert.equal(stale.length, 0, '过期的待接不该再显示');

  // 两台设备算出来的看板必须一致：靠消息时间判断，不依赖各自的本机时钟。
  const a = buildTaskBoard([orphan, reply, later]);
  const b = buildTaskBoard([...([orphan, reply, later])].reverse());
  assert.deepEqual(a.map((task) => task.id), b.map((task) => task.id), '输入顺序不同也该得到同一张看板');
});
