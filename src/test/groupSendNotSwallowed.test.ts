import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BUSY_GROUP_ORDER, decideWhenBusy } from '../sync/sendGate';

/**
 * 群消息在执行期间不能被吞（用户 2026-11-24）：
 *   「Windows 的团队任务对话框正在执行任务的时候，Windows 的团队群输入框的消息就发不出去，
 *     被吞掉了」
 *
 * 原因：`send()` 用一把「一次只发一条」的锁，群消息和普通消息共用，
 * 而且在**发到群之前**就被判忙返回 —— 群里什么都看不到。
 *
 * 结论由纯函数给出，这里真的执行它（以前只能读源码 + 正则）。
 */

test('普通消息正忙 → 给回执（行为不变）', () => {
  assert.equal(decideWhenBusy({ busy: true, isGroupSend: false }), 'reject-busy');
});

test('群消息正忙 → 先腾位置，而不是判忙返回', () => {
  assert.equal(decideWhenBusy({ busy: true, isGroupSend: true }), 'interrupt-then-send');
  // 腾出位置之后就当正常发送处理。
  assert.equal(decideWhenBusy({ busy: true, isGroupSend: true, interrupted: true }), 'send');
});

test('实在腾不出来 → 也要落进群里并说明，绝不静默丢弃', () => {
  assert.equal(decideWhenBusy({ busy: true, isGroupSend: true, interrupted: false }), 'post-group-fallback');
});

test('没在忙时一律正常发送（群消息与普通消息都一样）', () => {
  assert.equal(decideWhenBusy({ busy: false, isGroupSend: true }), 'send');
  assert.equal(decideWhenBusy({ busy: false, isGroupSend: false }), 'send');
});

test('处理顺序：先上屏 → 再停 → 再等 → 再定', () => {
  assert.deepEqual([...BUSY_GROUP_ORDER], ['beginPendingGroup', 'interrupt', 'wait', 'decide']);
});

test('面板按这个结论执行（含兜底那条真的发进群）', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /const decision = decideWhenBusy\(\{ busy: true, isGroupSend \}\)/, '判忙要问纯函数');
  assert.match(panel, /decision === 'reject-busy'/, '普通消息走回执');
  assert.match(panel, /decideWhenBusy\(\{ busy: this\.pendingSends\.has\(sendKey\), isGroupSend, interrupted: false \}\) === 'post-group-fallback'/, '等完仍拿不到锁要走兜底');
  // 兜底必须真的落进群，并说明会接着做，且收掉临时回显。
  const index = panel.indexOf("=== 'post-group-fallback'");
  const body = panel.slice(index, index + 900);
  assert.match(body, /phase: 'requirement'/, '先落进群');
  assert.match(body, /记进群里了/, '说明会接着做');
  assert.match(body, /endPendingGroup/, '临时回显要收掉，否则一直挂着「发送中」');
});
