import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 团队任务对话过大要自动换新（用户 2026-11-24）：
 *   「macOS 那边只花 12 秒就回复了… Windows 却要接近十分钟确认一个当前项目的问题。
 *     难道在哪个项目 hwchat 很难读取吗」
 *
 * 实测证据：Windows 那条团队任务对话 19 条消息 / 544KB（≈27 万字符），
 * mac 那条只有 4k tokens。原因是我把所有群任务都固定堆进同一条对话，
 * 模型每一步都要重读整段历史 —— 与「读项目」无关。
 *
 * 所以必须有体积上限 + 轮换，否则越用越慢，且只影响跑得最多的那台。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

test('团队任务对话有体量上限', () => {
  assert.match(PANEL, /TEAM_CONVERSATION_MAX_MESSAGES = \d+/, '要有消息数上限');
  assert.match(PANEL, /TEAM_CONVERSATION_MAX_TOKENS = \d[\d_]*/, '要有 token 上限');
});

test('超限时换新，而不是继续往同一条里堆', () => {
  const index = PANEL.indexOf('private async ensureGroupConversation');
  assert.ok(index > 0);
  const body = PANEL.slice(index, index + 1_200);
  assert.match(body, /teamConversationTooLarge\(alive\)/, '要检查体量');
  assert.match(body, /rotateTeamConversation\(alive\)/, '超限就轮换');
});

test('轮换会归档旧对话并留下交接摘要（人翻历史能看懂）', () => {
  const index = PANEL.indexOf('private async rotateTeamConversation');
  assert.ok(index > 0);
  const body = PANEL.slice(index, index + 1_600);
  assert.match(body, /appendMessage/, '要往旧对话写说明');
  assert.match(body, /setArchived\(previous\.id, true\)/, '要归档旧的');
  assert.match(body, /交接：项目/, '摘要要点出项目与最近任务');
  assert.match(body, /需要重新授权一次/, '要提醒完全访问需重新授权');
});

test('新对话仍然是自动权限 + 无限步数（轮换不改变权限模型）', () => {
  assert.match(PANEL, /TEAM_TASK_CONTROLS/, '仍然用团队任务的默认设置');
});
