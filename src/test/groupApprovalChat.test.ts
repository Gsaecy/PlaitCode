import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 「授权也在群里说」（用户 2026-11-24）：
 * 「参考 open claw 的模式，agent 很智能的，回答问题、执行任务、需要授权等等都会在群里说」
 *
 * 这条盯住三件事，防止以后又被改回「只在自己的对话框里弹卡」：
 *  1. 需要授权时，群里也会出现一条【权限申请】；
 *  2. 群里回「授权」就直接放行，不用切回对话框点按钮；
 *  3. 只结算最近一张卡 —— 连说两句不该把后面的卡一起放掉。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

test('需要授权时群里也会说一句', () => {
  const start = PANEL.indexOf('private async askDesktopApproval');
  assert.ok(start > 0, '找不到 askDesktopApproval');
  const nextMethod = PANEL.indexOf('\n  private ', start + 10);
  const body = PANEL.slice(start, nextMethod > start ? nextMethod : start + 8_000);
  assert.match(body, /【权限申请】/, '群里要有【权限申请】这样的明文提示');
  assert.match(body, /phase: 'question'/, '要走群里的追问通道');
  assert.match(body, /this\.groupApprovals\.set/, '要记下这张卡，群里回话时才能结算');
});

test('群里回「授权」就放行，回「拒绝」就停下', () => {
  const index = PANEL.indexOf('private settleGroupApproval');
  assert.ok(index > 0, '找不到 settleGroupApproval');
  const body = PANEL.slice(index, index + 900);
  assert.match(body, /授权\|同意\|允许\|批准/, '要认这几句授权的话');
  assert.match(body, /拒绝\|不同意/, '要能拒绝');
  assert.match(body, /settle\(allow\)/, '按用户的回答结算');
});

test('只结算最近一张卡，避免一次授权放掉一批', () => {
  const index = PANEL.indexOf('private settleGroupApproval');
  const body = PANEL.slice(index, index + 900);
  assert.match(body, /entries\[entries\.length - 1\]/, '只取最后一张');
});

test('卡结束后从群里那张表里撤掉，不会点到过期的卡', () => {
  const index = PANEL.indexOf('const finish = (allowed: boolean): void => {');
  assert.ok(index > 0);
  const body = PANEL.slice(index, index + 700);
  assert.match(body, /this\.groupApprovals\.delete\(key\)/, '结算后要清掉群里对应的那张卡');
});
