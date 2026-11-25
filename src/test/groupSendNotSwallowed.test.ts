import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 群消息在执行期间不能被吞（用户 2026-11-24）：
 *   「Windows 的团队任务对话框正在执行任务的时候，Windows 的团队群输入框的消息就发不出去，
 *     被吞掉了」
 *
 * 原因：`send()` 会等到整轮跑完才释放 `pendingSends`（key = 当前对话），
 * 群消息和普通消息共用这把锁，而且是在**发到群之前**就被判忙返回 —— 群里什么都看不到。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

test('群消息不受「一次只发一条」的锁限制', () => {
  const index = PANEL.indexOf('const isGroupSend = options?.origin === \'group\';');
  assert.ok(index > 0, '要显式区分群消息');
  const body = PANEL.slice(index, index + 1_600);
  assert.match(body, /if \(!isGroupSend\)/, '只有非群消息才判忙回执');
  assert.match(body, /this\.stop\(\)/, '群消息遇到忙要腾出位置（只执行最新的）');
});

test('实在腾不出来也要发进群并说明，绝不静默丢弃', () => {
  const index = PANEL.indexOf('const isGroupSend = options?.origin === \'group\';');
  const body = PANEL.slice(index, index + 1_600);
  assert.match(body, /postGroup\(\{[\s\S]{0,120}phase: 'requirement'/, '要先落进群');
  assert.match(body, /照样记进群里|记进群里了|结束后我立刻接着做/, '要说明会接着做');
  assert.match(body, /endPendingGroup/, '临时回显要收掉，否则一直挂着「发送中」');
});

test('普通消息判忙时仍然给回执（行为不变）', () => {
  const index = PANEL.indexOf('const isGroupSend = options?.origin === \'group\';');
  const body = PANEL.slice(index, index + 1_600);
  assert.match(body, /sendRejected/, '普通消息回执保留');
  assert.match(body, /notice\.busyRejected/, '原因不变');
});
