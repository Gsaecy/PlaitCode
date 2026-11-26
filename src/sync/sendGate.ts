/**
 * 「面板正忙时，这条消息怎么办」。
 *
 * 用户实况（2026-11-24）：「Windows 的团队任务对话框正在执行任务的时候，
 * Windows 的团队群输入框的消息就发不出去，被吞掉了」。
 *
 * 原因：`send()` 用 `pendingSends` 做「一次只发一条」的锁，群消息和普通消息共用，
 * 而且是在**发到群之前**就被判忙返回 —— 群里什么都看不到。
 *
 * 结论抽成纯函数：普通消息照旧回执（行为不变），群消息必须先腾位置、实在腾不出来
 * 也要落进群里并说明「结束后接着做」，绝不静默丢弃。
 */

export type BusySendDecision =
  /** 没在忙：正常发。 */
  | 'send'
  /** 普通消息 + 正忙：给「稍后再说」的回执。 */
  | 'reject-busy'
  /** 群消息 + 正忙：先停掉手上那一轮，把新消息并进去。 */
  | 'interrupt-then-send'
  /** 群消息 + 实在腾不出位置：至少落进群里，并说明会接着做。 */
  | 'post-group-fallback';

export function decideWhenBusy(input: {
  busy: boolean;
  isGroupSend: boolean;
  /**
   * 停一轮是否成功。
   * `undefined` = **还没试**（结论：先去停）；`true` = 停下来了；`false` = 停不下来。
   */
  interrupted?: boolean;
}): BusySendDecision {
  if (!input.busy) return 'send';
  if (!input.isGroupSend) return 'reject-busy';
  if (input.interrupted === true) return 'send';
  if (input.interrupted === false) return 'post-group-fallback';
  return 'interrupt-then-send';
}

/**
 * 群消息在忙时的处理顺序（供面板按步执行）。
 *
 * 1. 先把这句话画到群里（`beginPendingGroup`）—— 停一轮要等收尾，这几秒不能空着；
 * 2. 再停那一轮（`interruptForGroupMessage`）；
 * 3. 停完仍拿不到锁 → `post-group-fallback`（落群 + 说明 + 收掉临时回显）。
 */
export const BUSY_GROUP_ORDER = ['beginPendingGroup', 'interrupt', 'wait', 'decide'] as const;
