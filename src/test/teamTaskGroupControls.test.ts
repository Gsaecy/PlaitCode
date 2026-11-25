import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 「团队任务对话框里面的选择、决策、授权，都需要通过团队群来」（用户 2026-11-24）。
 *
 * 三件事都要成立：
 *  1. 团队任务的决策**不发卡片**，改成群里问（带编号选项）；
 *  2. 团队任务的授权**不发卡片**，改成群里【权限申请】；
 *  3. 群里回「1」「2」/ 选项名 → 结算选择；回「授权」「拒绝」→ 结算授权。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

test('团队任务的决策改到群里问，窗口里不再弹卡', () => {
  assert.match(PANEL, /const teamRun = this\.isTeamConversation\(run\.conversationId\)/, '要按对话判断');
  assert.match(PANEL, /【需要你选】/, '群里要有明确的提问');
  assert.match(PANEL, /在群里回数字（如「1」）/, '要告诉用户怎么回答');
  assert.match(PANEL, /this\.groupDecisions\.set/, '要登记这笔选择，等群里回答');
});

test('团队任务窗口：只显示 项目 + 任务简介 + 停止', () => {
  assert.match(PANEL, /id="teamTaskBar"/, '要有状态条容器');
  assert.match(PANEL, /id="teamTaskProject"/, '要显示当前项目');
  assert.match(PANEL, /id="teamTaskTitle"/, '要显示任务简介');
  assert.match(PANEL, /id="teamTaskStop"/, '要显示停止按钮');
  assert.match(PANEL, /teamTaskInfo: this\.isTeamConversation/, '宿主要把项目与任务给界面');
  assert.match(readFileSync('media/chat.css', 'utf8'), /body\.team-task #composer \{ display: none !important; \}/, '整个输入框要收掉');
  assert.match(readFileSync('media/chat.js', 'utf8'), /teamTaskStop'\)\?\.addEventListener\('click', \(\) => post\('stop'\)\)/, '停止要真的能用');
});

test('团队任务的授权改到群里问，窗口里不再弹卡', () => {
  assert.match(PANEL, /this\.groupApprovals\.set\(`team:\$\{requestId\}`, finish\)/, '团队任务授权登记到群里');
  assert.match(PANEL, /【权限申请】/, '群里要有权限申请文案');
});

test('群里回数字 / 选项名能结算选择', () => {
  const index = PANEL.indexOf('private settleGroupDecision');
  assert.ok(index > 0, '缺少 settleGroupDecision');
  const body = PANEL.slice(index, index + 1_400);
  assert.match(body, /digits/, '要能解析数字');
  assert.match(body, /decision\.resolve\(index\)/, '选中第 n 个');
  assert.match(body, /value\.includes\(option\)/, '也要能按选项名选中');
});

test('群分支先结算选择与授权，再走普通消息', () => {
  const index = PANEL.indexOf('settleGroupDecision(content)');
  const approval = PANEL.indexOf('settleGroupApproval(content)');
  assert.ok(index > 0 && approval > 0);
  assert.ok(index < approval, '选择应在授权之前处理（避免「1」被当成授权词）');
});
