/**
 * 团队任务对话的**体量上限与轮换交接**。
 *
 * 用户实况（2026-11-24）：「macOS 那边只花 12 秒就回复了… Windows 却要接近十分钟」。
 * 实测原因是 Windows 那条团队任务对话 19 条消息 / 544KB（≈27 万字符），
 * 而所有群任务都固定堆进同一条 —— 模型每一步都要重读整段历史。
 *
 * 规则抽成纯函数：阈值、判定、交接摘要都能被**执行**验证，
 * 面板只负责写盘（归档旧对话 + 建新对话）。
 */

/** 消息数上限：到这条就换新。 */
export const TEAM_CONVERSATION_MAX_MESSAGES = 24;
/** token 上限：与消息数上限取「或」，任一超了都换新。 */
export const TEAM_CONVERSATION_MAX_TOKENS = 40_000;

/** 这条团队任务对话是不是太大了，该换一条。 */
export function teamConversationTooLarge(
  summary: { messageCount?: number; totalTokens?: number } | undefined,
): boolean {
  if (!summary) return false;
  return (summary.messageCount ?? 0) >= TEAM_CONVERSATION_MAX_MESSAGES
    || (summary.totalTokens ?? 0) >= TEAM_CONVERSATION_MAX_TOKENS;
}

/**
 * 这一轮该不该换一条新的团队任务对话。
 *
 * 2026-11-26 的真实故障：轮换**从来没生效过**。判定确实每次都命中了
 * （一条团队任务对话里留了 76 条「已换一条新的继续」的交接），但换新之后
 * 找对话时用的 `listConversations()` **把归档的也算进来了**，于是当场把刚归档的
 * 那条解除归档、原样接着用 —— 结果那条对话长到 299 条消息 / 5.6 亿 tokens / 32.8 MB，
 * 每一步都重读一遍。所以判定要能被执行验证，别只靠读代码。
 *
 * 判据（按优先级）：
 *  1. `keepFor` 命中上一个需求：这一轮是「打断后继续」，**必须留住上下文**；
 *  2. 上一个需求号 ≠ 本需求号：新需求就该从干净的上下文开始
 *     （上一条的结论由群记录里的摘要承担，不必把它的工具流水再读一遍）；
 *  3. 否则按体量兜底（同一需求内跑得太久）。
 */
export function shouldRotateTeamConversation(input: {
  summary: { messageCount?: number; totalTokens?: number } | undefined;
  /** 这条对话里最后一次开跑的需求号（读不到就是空串）。 */
  previousRequirementId?: string;
  /** 这一轮要跑的需求号（普通群聊 / 非需求场景为空）。 */
  requirementId?: string;
  /** 这一轮必须保留上下文的需求号（打断后续跑时传被打断的那条）。 */
  keepFor?: string;
  /**
   * 上一个里程碑（阶段任务 / 某项功能）已经完成**并同步给群里**了。
   *
   * 用户 2026-11-26：「直到一个阶段任务，或者某项功能完成并同步了，就完全清除缓存」——
   * 这一档即使还挂在同一个需求号上也要换新上下文：那条需求已经交付完，
   * 接着聊的是下一件事，把上一轮几百次工具流水继续背着没有任何收益。
   */
  milestoneDone?: boolean;
}): boolean {
  if (!input.summary) return false;
  if ((input.summary.messageCount ?? 0) <= 0) return false;
  const previous = (input.previousRequirementId ?? '').trim();
  const keepFor = (input.keepFor ?? '').trim();
  if (keepFor && previous === keepFor) return false;
  // 里程碑完成并同步：上下文整体作废（结论已经写进群记录和旧对话末尾的交接说明）。
  if (input.milestoneDone) return true;
  const current = (input.requirementId ?? '').trim();
  /*
   * **没有需求号 = 这不是「新需求」**，一律不换上下文。
   *
   * 2026-11-26 的真实现场：Windows 在 30 分钟里被归档了 8 条「团队任务（xx:xx 归档）」，
   * 每条只有 3–5 条消息 —— 因为每收到一条**队友消息**（`runSyncNote` 走的就是没有需求号的
   * 这一轮）都会走到下面的体量兜底，而体量阈值（24 条 / 4 万 tokens）早就超了。
   * 于是：消息确实进了「团队任务」对话，但进的是**刚新建的那一条**，
   * 用户盯着的是刚被改名归档的那一条 —— 看起来就是「对面回了、已读、但我的对话里没有」。
   *
   * 换新的意义只有两个：换了需求（省掉上一条的工具流水）、里程碑交付完（清缓存）。
   * 两者都必须有**明确的需求号**做依据；队友消息 / 追问补充 / 回声都不是新需求。
   */
  if (!current) return false;
  /*
   * 还是同一条需求（甲方的追问 / 回答 / 打断续跑）：**一律不换**。
   *
   * 不能在这里按体量换 —— 一条需求的追问本来就要接着上一轮的工具上下文，
   * 换掉它就等于让 agent 从头再查一遍，省下的 token 又花回去。
   * 同一需求内的体量由 `pruneToolPayloads` 的硬折叠负责（单轮请求体不再线性膨胀）。
   */
  if (previous && previous === current) return false;
  if (previous) return true;
  /*
   * 从没跑过需求的对话（previous 为空、现在有了需求号）：不换，直接用它。
   *
   * 以前这里还有一道「按体量兜底」—— 结果在**没有需求号的轮次**上（队友消息、
   * 群回声）天天命中，30 分钟归档 8 条对话、每条 3–5 条消息，消息全落进刚新建的那条，
   * 用户盯着的那条看起来就是「对面回了、已读、但我这里没有」。
   *
   * 体量本身不靠换对话来控制：请求体由 `planTeamCompaction` 在 85% 时压缩，
   * 里程碑交付后用 `milestoneDone` 整体清空。换对话的唯一依据是「换了需求」。
   */
  return false;
}

/**
 * 从一轮的提示词里认出「这是哪个需求」。
 *
 * 需求号写在协议提示词的括号里（`（需求号 req-xxx）`）。用它而不是再加一个存档字段：
 * 冷启动 / 重载之后内存是空的，而提示词就在消息里，重新读一遍就能还原。
 */
export function requirementIdOfPrompt(text: string | undefined): string {
  const match = /需求号\s*([A-Za-z0-9_-]{4,64})/.exec(text ?? '');
  return match?.[1] ?? '';
}

/**
 * 轮换时给旧对话改的名字。
 *
 * 为什么要改：找「团队任务」对话是按标题精确匹配的。归档后标题不变，
 * 关群再开群时又会把它找回来自动解除归档 —— 那正是「轮换等于没换」的另一半。
 * 加了时间戳之后，活动中的那条永远只有一条，历史也仍然好认。
 */
export function rotatedTeamTitle(title: string, at: string): string {
  return `${title}（${at} 归档）`;
}

/**
 * 里程碑清缓存时写进旧对话末尾的**一句话记录**。
 *
 * 用户 2026-11-26：「将已经完成的任务记录成一句话，细节都丢掉…直到一个阶段任务，
 * 或者某项功能完成并同步了，就完全清除缓存」。所以这里只留「做了什么」，不留过程、文件、命令。
 */
export function teamMilestoneNotice(input: {
  /** 已完成的清单项（每项压成一句话）。 */
  completed: readonly string[];
  project?: string;
  /** 清缓存的时刻（已格式化，例如 `21:40`）。 */
  at: string;
}): string {
  const lines = input.completed
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => `- ${item.length > 60 ? `${item.slice(0, 59)}…` : item}`);
  return [
    `【阶段完成并已同步群里的其它设备，${input.at} 清空上下文缓存】`,
    `项目：${input.project || '（未命名）'}`,
    lines.length ? '完成的事（只留一句话，细节已丢弃）：' : '这一阶段没有登记清单项。',
    ...lines,
  ].join('\n');
}

/**
 * 轮换时写进旧对话末尾的说明。
 *
 * 为什么要有它：人翻历史时得看懂「为什么这里断了」，以及换过去之后权限是怎么重来的。
 */
export function teamRotationNotice(input: {
  messageCount?: number;
  totalTokens?: number;
  project?: string;
  title?: string;
  /** 换新的时刻（已格式化，例如 `21:40`）。 */
  at: string;
}): string {
  return [
    `【这一条对话太长了（${input.messageCount ?? '?'} 条消息 / 约 ${input.totalTokens ?? 0} tokens），已换一条新的继续】`,
    '原因：历史越长每一步越慢。',
    `交接：项目 ${input.project || '（未命名）'}，最近任务「${input.title || '（无）'}」，${input.at} 换新。`,
    '新对话从「自动权限 + 无限步数」开始；如果之前群里授权过完全访问，需要重新授权一次。',
  ].join('\n');
}
