import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NEW_CONVERSATION_CONTROLS,
  TEAM_TASK_CONTROLS,
  resolveConversationControls,
} from '../core/conversationControls';
import { DEFAULT_PERMISSION_PRESET } from '../core/permissions';
import { DEFAULT_AGENT_MAX_STEPS } from '../core/agentLimits';
import { normalizeAgentMaxSteps } from '../core/settings';

/**
 * 权限隔离（用户 2026-11-24）：
 * 「隔离权限，避免团队任务对话框权限和普通对话框权限污染」。
 *
 * 两件事必须同时成立：
 *  1. 普通新对话仍然从最严格开始 —— 团队任务那套默认值不能漏过来；
 *  2. 团队任务对话的放宽（自动权限 / 完全访问）不能写进任何别的对话。
 */

test('普通新对话不受团队任务默认值影响', () => {
  assert.equal(NEW_CONVERSATION_CONTROLS.permissionPreset, DEFAULT_PERMISSION_PRESET);
  assert.equal(NEW_CONVERSATION_CONTROLS.permissionPreset, 'askAll', '普通新对话必须是最严格那一档');
  assert.equal(NEW_CONVERSATION_CONTROLS.agentMaxSteps, DEFAULT_AGENT_MAX_STEPS);
  assert.notEqual(
    NEW_CONVERSATION_CONTROLS.permissionPreset,
    TEAM_TASK_CONTROLS.permissionPreset,
    '两套默认值必须不同，否则「团队任务」这个区别没有意义',
  );
});

test('团队任务对话：自动权限 + 无限步数，但**不是**完全访问', () => {
  assert.equal(TEAM_TASK_CONTROLS.permissionPreset, 'autopilot', '默认自动权限，不是每次都问');
  assert.equal(TEAM_TASK_CONTROLS.agentMaxSteps, 0, '0 = 工具条上的「无限制」');
  assert.equal(normalizeAgentMaxSteps(TEAM_TASK_CONTROLS.agentMaxSteps), 0, '0 必须被当成合法值，不能退回默认步数');
  assert.notEqual(TEAM_TASK_CONTROLS.permissionPreset, 'full', '完全访问必须由群里授权后才放开，不能是默认');
});

test('按对话解析：两条对话各自的权限互不覆盖', () => {
  // 团队任务已授权到完全访问。
  const team = resolveConversationControls(NEW_CONVERSATION_CONTROLS, {
    permissionPreset: 'full',
    agentMaxSteps: 0,
  });
  // 普通对话仍然是「每次询问 / 默认步数」。
  const normal = resolveConversationControls(NEW_CONVERSATION_CONTROLS, {});
  assert.equal(team.permissionPreset, 'full');
  assert.equal(team.agentMaxSteps, 0);
  assert.equal(normal.permissionPreset, DEFAULT_PERMISSION_PRESET, '团队对话的完全访问不能漏到普通对话');
  assert.equal(normal.agentMaxSteps, DEFAULT_AGENT_MAX_STEPS);

  // 反向：普通对话改严格，也不影响团队对话已经放开的那一档。
  const normalTightened = resolveConversationControls(NEW_CONVERSATION_CONTROLS, { permissionPreset: 'askAll' });
  assert.equal(normalTightened.permissionPreset, 'askAll');
  assert.equal(team.permissionPreset, 'full', '普通对话改权限不该把团队对话的授权改掉');
});

test('脏值不会把两条对话的权限混在一起', () => {
  // 存档里出现不认识的值：退回各自的安全值，而不是沿用「另一个对话」的值。
  const dirty = resolveConversationControls(NEW_CONVERSATION_CONTROLS, {
    permissionPreset: 'autopilot-please',
    agentMaxSteps: -5,
  });
  assert.equal(dirty.permissionPreset, DEFAULT_PERMISSION_PRESET);
  assert.equal(dirty.agentMaxSteps, DEFAULT_AGENT_MAX_STEPS);
});
