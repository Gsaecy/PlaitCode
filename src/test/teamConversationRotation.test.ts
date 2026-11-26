import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEAM_CONVERSATION_MAX_MESSAGES,
  TEAM_CONVERSATION_MAX_TOKENS,
  teamConversationTooLarge,
  teamRotationNotice,
} from '../sync/teamRotation';

/**
 * 团队任务对话过大要自动换新（用户 2026-11-24）：
 *   「macOS 那边只花 12 秒就回复了… Windows 却要接近十分钟确认一个当前项目的问题。」
 *
 * 实测：Windows 那条团队任务对话 19 条消息 / 544KB（≈27 万字符），
 * 所有群任务都堆进同一条 —— 模型每一步都要重读整段历史。
 *
 * 阈值与交接说明现在都是纯函数，这里**真的执行**它们（以前只能读源码 + 正则）。
 */

test('体量上限：消息数或 token 任一超了就要换新', () => {
  assert.equal(teamConversationTooLarge(undefined), false, '没有摘要（新对话）不换');
  assert.equal(teamConversationTooLarge({}), false);
  assert.equal(teamConversationTooLarge({ messageCount: TEAM_CONVERSATION_MAX_MESSAGES - 1 }), false);
  assert.equal(teamConversationTooLarge({ messageCount: TEAM_CONVERSATION_MAX_MESSAGES }), true, '到上限就换');
  assert.equal(teamConversationTooLarge({ totalTokens: TEAM_CONVERSATION_MAX_TOKENS }), true, 'token 到上限也换');
  assert.equal(teamConversationTooLarge({ messageCount: 3, totalTokens: 1_000 }), false);
  // 真实故障现场：19 条消息、27 万字符 ≈ 十几万 token —— 必须命中。
  assert.equal(teamConversationTooLarge({ messageCount: 19, totalTokens: 270_000 }), true);
});

test('交接说明：点出项目、最近任务、换新时间，并提醒重新授权', () => {
  const notice = teamRotationNotice({
    messageCount: 19,
    totalTokens: 270_000,
    project: 'Personal Workstation OS',
    title: '修中英文切换',
    at: '21:40',
  });
  assert.match(notice, /19 条消息/);
  assert.match(notice, /270000 tokens/);
  assert.match(notice, /交接：项目 Personal Workstation OS/);
  assert.match(notice, /最近任务「修中英文切换」/);
  assert.match(notice, /21:40 换新/);
  assert.match(notice, /需要重新授权一次/, '完全访问要重新授权，否则用户会以为权限没了');
});

test('交接说明：项目 / 任务为空时也不写空白，给可读占位', () => {
  const notice = teamRotationNotice({ at: '09:00' });
  assert.match(notice, /项目 （未命名）/);
  assert.match(notice, /（无）/);
});
