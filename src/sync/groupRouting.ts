/**
 * 群里来了一句话，该怎么处理？—— **纯函数**，把所有分流规则集中在一处。
 *
 * 为什么单独成模块（2026-11-25 的真实故障，任何多设备群都会遇到）：
 * 以前这段判断散在 `chatPanel.send()` 的四个 `if` 里，只能靠读源码确认「顺序对不对」。
 * 结果出过一个谁都没预料到的组合：本机挂着一张「等你选」的卡，
 * 甲方在输入框里**明确选了执行设备**再发新需求，这句话先被「结算选择」接走 ——
 * 那条捷径只发一条 `phase=answer`，既不带 `assignee` 也不带 `to` 就 return。
 * 群里于是显示「没有 @ 任何人」，另一台当成说给所有人照跑，被指派的那台反而没执行。
 *
 * 变成纯函数之后，这些组合可以被**执行**验证（见 `groupRouting.test.ts`），
 * 而不是靠人肉读 `if` 的顺序。
 *
 * 分流优先级（与设备名、台数无关）：
 *   1. **显式指派** → 派活（先把它保住，后面所有捷径都不许抢）；
 *   2. 新鲜的「等你选」卡片 + 明确选项/自由回答 → 结算选择；
 *   3. 审批卡 + 授权/拒绝话术 → 结算审批；
 *   4. 上一条是「权限申请」+ 授权话术 → 放开完全访问；
 *   5. 有提问方 + 这句话是回答 → 定向回给提问那台；
 *   6. 其余 → 新需求（广播 / 按指派）。
 */

import { isAnswerToOpenQuestion, looksLikeOwnWordsAnswer } from './groupIntent';

/**
 * 群里「等你选」的卡片多久之后不再接管群消息。
 *
 * 不设期限的话，一张旧卡会让之后每句话都先被它试一遍（短句被吞成答案）。
 */
export const GROUP_DECISION_TTL_MS = 10 * 60_000;

/** 授权 / 拒绝话术。 */
export function approvalVerdict(text: string): 'allow' | 'deny' | undefined {
  const value = text ?? '';
  if (/拒绝|不同意|deny|reject/i.test(value)) return 'deny';
  if (/授权|同意|允许|批准|authori[sz]e|grant|allow/i.test(value)) return 'allow';
  return undefined;
}

/**
 * 「群里授权完全访问」这一类话术。
 *
 * 不能用 `\b(授权|同意)\b`：JS 的 `\b` 只认 `[A-Za-z0-9_]`，中文两侧都不算词边界，
 * 所以「授权」两个字**永远匹配不上** —— 这条 `if` 以前等于没生效（测试跑出来的）。
 */
export function looksLikeFullAccessGrant(text: string): boolean {
  return /(?:授权|同意|允许|批准)|authori[sz]e|grant/i.test(text ?? '');
}

/**
 * 这一轮该不该往团队群里回报（写账本 + 发结果）。
 *
 * 用户实况（2026-11-25，泄露事故）：「普通对话框的消息，agent 回复到了团队群的对话框里」。
 * 根因是回报逻辑只要 `lanSync` 存在就执行，需求号还会退回「群里最近一条需求」——
 * 于是随便一条普通对话跑完，它的回复都被当成那条群需求的结果发进团队群，
 * 既泄露内容，也把账本写脏。
 *
 * 规则：**只有团队自己的那一轮**才回群。
 *  - `groupRun`：起跑时就定下来的（群消息 / 对端需求 / 团队任务对话）；
 *  - 或这一轮带着真实需求号（`syncRequirementId`）。
 * 普通对话两者都没有 → 一个字都不往群里发。
 */
export function shouldReportToGroup(input: {
  groupRun?: boolean;
  syncRequirementId?: string;
  conversationId?: string;
  groupConversationId?: string;
}): boolean {
  if (input.syncRequirementId) return true;
  if (input.groupRun === true) return true;
  return Boolean(input.groupConversationId) && input.conversationId === input.groupConversationId;
}

/**
 * 这一轮要不要带 `team_sync` 工具。
 *
 * 同一个泄露事故的第二条通道：工具清单里只要有 `team_sync`，模型就可能在一轮
 * **普通对话**里把内容当「结果」发进团队群。普通对话根本不需要群工具 ——
 * 想跟群里说话就去团队群说。
 */
export function syncToolAllowed(input: { isTeamRun: boolean; syncRequirementId?: string }): boolean {
  return input.isTeamRun || Boolean(input.syncRequirementId);
}

/**
 * 只结算**最近一张**卡。
 *
 * 用户实况（2026-11-24）：「连说两句不该把后面的卡一起放掉」。
 * 群里回一句「授权」只能放行这一次；把一批卡都 resolve(true) 等于一次授权放掉一串操作。
 * Map 的插入顺序就是先后顺序，所以取最后一条。
 */
export function latestEntry<T>(entries: ReadonlyArray<{ key: string; value: T }>): { key: string; value: T } | undefined {
  return entries.length ? entries[entries.length - 1] : undefined;
}

export type GroupRoute =
  | { kind: 'decision'; index: number }
  | { kind: 'decision-custom'; answer: string }
  | { kind: 'approval'; allow: boolean }
  | { kind: 'authorize' }
  | { kind: 'answer'; to: string }
  | { kind: 'requirement'; assignee: string };

export interface GroupRouteInput {
  text: string;
  /** 甲方在界面上选的 / @ 到的执行设备 id（空 = 没指派）。 */
  explicitAssignee?: string;
  /** 本机挂着的一张「等你选」卡片（没有就是 undefined）。 */
  pendingDecision?: { options: readonly string[]; at: number };
  /** 本机挂着一张审批卡。 */
  pendingApproval?: boolean;
  /** 群里最近一条 agent 追问是「权限申请」（放开完全访问的前提）。 */
  permissionRequestOpen?: boolean;
  /** 正在等回答的那台设备 id（没有/空串 = 没有可回答的追问）。 */
  openAskerId?: string;
  /** 追问的可选项（用来判断「回答的是哪一个」）。 */
  openQuestionOptions?: readonly string[];
  now?: number;
}

export function routeGroupMessage(input: GroupRouteInput): GroupRoute {
  const text = (input.text ?? '').trim();
  const assignee = (input.explicitAssignee ?? '').trim();
  const now = input.now ?? Date.now();

  /*
   * 1. 显式指派 = 派活，谁都不许抢。
   *
   * 这一步必须在所有「回答 / 结算」之前：用户实况就是在这里丢的指派。
   */
  if (assignee) return { kind: 'requirement', assignee };

  // 2. 新鲜的「等你选」卡片。
  const decision = input.pendingDecision;
  if (decision && text && now - decision.at <= GROUP_DECISION_TTL_MS) {
    const digits = text.match(/^(?:选|选择|选项)?\s*([1-9])\s*$/);
    if (digits) {
      const index = Number(digits[1]) - 1;
      if (index >= 0 && index < decision.options.length) return { kind: 'decision', index };
    }
    /*
     * 选项名必须**是这句话的主体**才算选择。
     *
     * 用 `text.includes(option)` 的话，「先修 A 那个文案，B 下周再说」里带了「先修 A」，
     * 就被结算成「选了第 1 项」—— 后面那半句指令直接消失（既不执行、也不进群）。
     * 这和上面那条「≤60 字就当成答案」是同一类黑洞。
     */
    const answerish = text.replace(/[。．.!！?？~～\s]+$/g, '').trim();
    const hit = decision.options.findIndex((option) => {
      const name = option.trim();
      if (!name) return false;
      if (answerish === name) return true;
      // 允许「就选 X 吧」这类短句；长句里顺带提到选项不算选择。
      return answerish.length <= name.length + 6 && answerish.includes(name);
    });
    if (hit >= 0) return { kind: 'decision', index: hit };
    /*
     * 自由回答的门槛：**必须真的像回答**。
     * 以前只要求「≤60 字」，于是「1.实测…；2.但是…」这种新需求被当成答案结算掉，
     * 那张卡就成了黑洞：消息既不执行、也不带指派地发进群。
     */
    if (text.length <= 60 && looksLikeOwnWordsAnswer(text)) return { kind: 'decision-custom', answer: text };
  }

  // 3. 审批卡。
  if (input.pendingApproval) {
    const verdict = approvalVerdict(text);
    if (verdict) return { kind: 'approval', allow: verdict === 'allow' };
  }

  // 4. 群里授权「完全访问」。
  if (input.permissionRequestOpen && looksLikeFullAccessGrant(text)) return { kind: 'authorize' };

  /*
   * 5. 回答追问：只有**有真实提问方**才定向。
   *
   * 提问方为空时若仍然走「回答」，发出去的就是一条没有 `to` 的广播 ——
   * 群里看着「没 @ 谁」，所有设备都当说给自己，提问方反而被跳过。
   */
  const asker = (input.openAskerId ?? '').trim();
  if (asker && isAnswerToOpenQuestion({
    text,
    askerId: asker,
    ...(input.openQuestionOptions ? { options: input.openQuestionOptions } : {}),
  })) {
    return { kind: 'answer', to: asker };
  }

  // 6. 新需求（没指派 → 广播给所有设备）。
  return { kind: 'requirement', assignee: '' };
}
