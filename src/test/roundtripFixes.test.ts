import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 这一轮四个反馈各自对应的不变量。
 *
 *  1. macOS 快、Windows 慢 → 回执里给出真实耗时（可核对，不靠感觉）
 *  2. agent 会读取对方给我的回复 → 提示词里明确「队友的结果只是背景，不要复述/致谢」
 *  3. 没法修改对方设备的项目 → `localPeer()` 工厂必须把 projects / projectRepos 带出去
 *  4. 群里的消息跑到主对话输入框 → 群 / 对端来源发送失败时**不能**回 sendRejected
 */
const SETUP = readFileSync('src/sync/lanSetup.ts', 'utf8');
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
const PROTOCOL = readFileSync('src/sync/lanProtocol.ts', 'utf8');

test('第 3 条：localPeer 工厂会带出 projects / projectRepos / login', () => {
  const start = SETUP.indexOf('export function localPeer(input: {');
  assert.ok(start > 0, '找不到 localPeer 工厂');
  // 取到函数体结束（这个文件是 CRLF，用固定长度更稳）。
  const body = SETUP.slice(start, start + 1_600);
  assert.match(body, /projects\?: readonly string\[\]/, '签名叫里要有 projects');
  assert.match(body, /projectRepos\?: readonly string\[\]/, '签名里要有 projectRepos');
  assert.match(body, /login\?: string/, '签名里要有 login');
  assert.match(body, /\.\.\.\(input\.projects\?\.length \? \{ projects: \[\.\.\.input\.projects\] \} : \{\}\)/, '要真的放进返回值');
  assert.match(body, /\.\.\.\(input\.projectRepos\?\.length/, 'projectRepos 要真的放进去');
});

test('第 4 条：群 / 对端来源发送失败时不回填主对话输入框', () => {
  const index = PANEL.lastIndexOf('sendRejected');
  assert.ok(index > 0);
  const body = PANEL.slice(Math.max(0, index - 900), index + 400);
  assert.match(body, /fromGroup/, '要先判断来源');
  assert.match(body, /options\?\.origin === 'group' \|\| options\?\.origin === 'sync'/, '群与对端两种来源都算');
  assert.match(body, /if \(!fromGroup\)/, '只有用户在主对话里发的时候才回填');
});

test('第 2 条：提示词要求区分「队友的结果是背景」和「必须主动分工」', () => {
  assert.match(PROTOCOL, /和另一台 agent 的分工（必须做，不是可选）/, '要有明确的分工章节');
  assert.match(PROTOCOL, /不要复述、不要致谢/, '不要复述客套');
  assert.match(PROTOCOL, /action=ask/, '需要核对事实时要能向队友提问');
  assert.match(PROTOCOL, /action=send/, '要让队友知道分工时要能发言');
  assert.match(PROTOCOL, /只回一次结论/, '限定只回一次，避免接龙');
});

test('第 1 条：回执里带真实耗时，没有开始时间就不编', () => {
  assert.match(PANEL, /syncRunStarted\.set\(requirement\.id, Date\.now\(\)\)/, '开始时要记时间');
  assert.match(PANEL, /const elapsed = startedAt \?/, '没开始时间时不显示耗时');
  assert.match(PANEL, /用时 \$\{elapsed\}s/, '回执里给出秒数');
});
