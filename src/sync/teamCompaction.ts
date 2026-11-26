/**
 * 团队任务对话的**就地压缩**与**里程碑清缓存**。
 *
 * 用户 2026-11-26（原话）：「团队任务对话框里面如果对话长度达到 100%，因为这个对话是独立出来的，
 * 没法开新对话，就需要将已经完成的任务记录成一句话，细节都丢掉，没完成的也压缩，直到一个阶段任务，
 * 或者某项功能完成并同步了，就完全清除缓存。」
 *
 * 背景：这条对话是**只读执行窗口**，用户不能自己开新对话；而它又承载所有群里的活，
 * 所以涨满之后不能像普通对话那样「再开一个」，只能：
 *  1. **压**：已完成 → 每条一句话（细节全丢），未完成 → 保留但去掉细节；
 *  2. **清**：一个阶段任务 / 一项功能做完并且同步了 → 连压缩后的历史也不再带，彻底重来。
 *
 * 这里只放判定与摘要生成（纯函数，测试真的执行），面板负责把它拼进这一轮的请求。
 */

import type { TodoItem } from '../core/types';

/** 上下文占用到这个比例就开始压缩（百分比）。 */
export const TEAM_COMPACT_AT_PERCENT = 85;
/** 压缩后仍然保留的最近消息条数：再少模型就不知道「刚才在干什么」了。 */
export const TEAM_COMPACT_KEEP_MESSAGES = 6;
/** 每条已完成任务压成一句话的最大字数。 */
export const TEAM_COMPLETED_LINE_CHARS = 80;
/** 每项未完成任务保留的最大字数（去细节，但保留「还没做完的是什么」）。 */
export const TEAM_PENDING_LINE_CHARS = 120;

export type TeamCompactionMode =
  /** 还装得下：不动。 */
  | 'none'
  /** 涨满了：已完成压成一句话、未完成去细节，只留最近几条消息。 */
  | 'compact'
  /** 一个阶段 / 一项功能做完并同步了：连压缩历史都不带，彻底清空。 */
  | 'reset';

export interface TeamCompactionPlan {
  mode: TeamCompactionMode;
  /** 已按里程碑结算：所有清单项都完成（或早已归档），且这一轮是正常收尾。 */
  milestoneDone: boolean;
  /** 要拼进 system 的进度摘要（完成一句话 + 未完成清单）。 */
  digest: string;
  /** 压缩时要保留的最近消息条数（`reset` 时为 0）。 */
  keepMessages: number;
}

/** 一行摘要：去掉换行与多余空白，按字数截断。 */
export function oneLine(text: string, maxChars: number): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length <= maxChars ? flat : `${flat.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * 生成「进度摘要」：**已完成的一条一句话，未完成的保留但去细节**。
 *
 * 用户要的是「细节都丢掉」——所以已完成项只留标题那一句，不再带过程、文件、命令。
 */
export function renderProgressDigest(input: {
  todos?: readonly TodoItem[];
  /** 里里程碑之外的历史清单（归档过的一律算「已完成」）。 */
  archivedCount?: number;
}): string {
  const todos = input.todos ?? [];
  const done = todos.filter((todo) => todo.status === 'completed');
  const pending = todos.filter((todo) => todo.status !== 'completed');
  const lines: string[] = [];
  if (done.length) {
    lines.push(`## 已完成（每条一句话，细节不留）`);
    for (const todo of done) {
      const line = oneLine(todo.content, TEAM_COMPLETED_LINE_CHARS);
      if (line) lines.push(`- [x] ${line}`);
    }
  }
  if (input.archivedCount) {
    lines.push(`- [x] 更早的 ${input.archivedCount} 项任务已完成（已归档，细节不再保留）`);
  }
  if (pending.length) {
    lines.push('', '## 还没做完（保留目标，去掉过程细节）');
    for (const todo of pending) {
      const line = oneLine(todo.content, TEAM_PENDING_LINE_CHARS);
      if (line) lines.push(`- [ ] ${line}`);
    }
  }
  return lines.join('\n');
}

/**
 * 这个里程碑是不是真的「做完并且同步了」。
 *
 * 两处都要用同一条判据（`planTeamCompaction` 与面板收尾时的打标记），所以抽出来，别再各写一遍：
 *  - **做完**：清单全绿；或清单已经被收尾归档（`todos` 清空、进 `todoArchives`）；
 *  - **同步了**：这一轮正常收尾且结论已经发到群里。没同步就清缓存，队友那端还在等这份结论。
 */
export function teamMilestoneReached(input: {
  todos?: readonly TodoItem[];
  archivedCount?: number;
  done: boolean;
  synced: boolean;
}): boolean {
  if (!input.done || !input.synced) return false;
  const todos = input.todos ?? [];
  if (todos.length) return todos.every((todo) => todo.status === 'completed');
  // 清单已被归档：只剩「刚归档过一份」这一种情况算完成，空对话不算里程碑。
  return (input.archivedCount ?? 0) > 0;
}

/**
 * 这一轮该怎么处理团队对话的上下文。
 *
 * @param input.usedPercent 当前上下文占用（0–100+，来自 `contextLoad()`）
 * @param input.done 这一轮是否正常跑完
 * @param input.synced 这一轮是否**已经同步给群里的其它设备**（有回执 / 已广播）
 * @param input.todos 当前清单
 * @param input.archivedCount 已经归档的清单项数量
 */
export function planTeamCompaction(input: {
  usedPercent: number;
  done: boolean;
  synced: boolean;
  todos?: readonly TodoItem[];
  archivedCount?: number;
}): TeamCompactionPlan {
  const todos = input.todos ?? [];
  const milestoneDone = teamMilestoneReached(input);
  const digest = renderProgressDigest({
    todos,
    ...(input.archivedCount ? { archivedCount: input.archivedCount } : {}),
  });
  if (milestoneDone) {
    return { mode: 'reset', milestoneDone, digest, keepMessages: 0 };
  }
  if (input.usedPercent >= TEAM_COMPACT_AT_PERCENT) {
    return { mode: 'compact', milestoneDone, digest, keepMessages: TEAM_COMPACT_KEEP_MESSAGES };
  }
  return { mode: 'none', milestoneDone, digest, keepMessages: 0 };
}
