/**
 * 「团队任务」这一轮用什么模式跑、哪些输入要拒。
 *
 * 用户实况（2026-11-25）：「本轮会话只给了我读代码和跑命令两样，没有写文件那一项」。
 * 写工具能被两条独立机制悄悄拿掉：
 *  1. 团队任务对话落在**计划模式**（plan）—— 只下发只读工具；
 *  2. 群里的活没有强制成执行模式。
 *
 * 这些判断以前散在 8.9k 行的面板里，测试只能「读源码 + 正则」。抽成纯函数之后，
 * 每条规则都能被**真的执行**一遍：给一组输入，看结论对不对。
 */

import { resolveActiveMode } from '../core/modes';
import type { ConversationMode } from '../core/types';

/**
 * 团队任务对话**永远**是执行模式。
 *
 * 计划模式只下发只读工具，而团队任务是「工单」不是「问答」——按界面默认模式建对话，
 * 用户默认模式是计划时这条对话就永远改不了文件。
 */
export const TEAM_CONVERSATION_MODE: ConversationMode = 'agent';

/** 存档里的团队任务对话要不要修回执行模式（已经是 agent 就不动，避免每轮写盘）。 */
export function needsTeamModeHeal(mode: string | undefined): boolean {
  return mode !== TEAM_CONVERSATION_MODE;
}

/**
 * 这一轮用什么模式。
 *
 * - 群里的活（`origin` 是 group / sync）→ 执行模式；
 * - 其余按对话存档 / 界面草稿 / 默认模式的既有优先级。
 */
export function resolveModeForSend(input: {
  origin?: 'group' | 'sync';
  conversationMode?: ConversationMode;
  draftMode?: ConversationMode;
  defaultMode: ConversationMode;
}): ConversationMode {
  if (input.origin === 'group' || input.origin === 'sync') return TEAM_CONVERSATION_MODE;
  return resolveActiveMode({
    conversationMode: input.conversationMode,
    draftOverride: input.draftMode,
    defaultMode: input.defaultMode,
  });
}

export type TeamControlKind = 'send' | 'setPermissionPreset' | 'setAgentMaxSteps' | 'setReasoningEffort';

export const TEAM_CONTROL_REJECT_REASON: Record<TeamControlKind, string> = {
  send: 'sync.teamTaskReadOnly',
  setPermissionPreset: 'sync.teamTaskReadOnly',
  setAgentMaxSteps: 'sync.teamTaskReadOnly',
  setReasoningEffort: 'sync.teamTaskReadOnly',
};

/**
 * 这条对话里的这个操作要不要拒。
 *
 * 用户要求：「删掉不只是 UI 层面，还是功能层面，避免再出现干扰的情况」——
 * 界面收掉输入框只是第一层，**功能层面**也必须拒，否则队列、续跑、快捷键
 * 这些入口照样能把指令塞进团队任务窗口。
 */
export function rejectsTeamControl(kind: TeamControlKind, isTeamConversation: boolean): boolean {
  return isTeamConversation;
}

/**
 * `send()` 开头那道闸：团队任务对话不接受**用户直接输入**（群里派下来的活例外）。
 *
 * `origin` 有值表示这条消息来自群 / 对端需求，不是用户在窗口里敲的。
 */
export function rejectsComposerInput(input: { isTeamConversation: boolean; hasOrigin: boolean }): boolean {
  return input.isTeamConversation && !input.hasOrigin;
}

/** 决策 / 授权弹在哪里：团队任务一律走群（窗口里不弹卡）。 */
export function teamPromptChannel(isTeamConversation: boolean): 'group' | 'card' {
  return isTeamConversation ? 'group' : 'card';
}
