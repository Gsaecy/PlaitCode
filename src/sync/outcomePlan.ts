/**
 * 团队一轮跑完，**群里说什么 / 账本怎么写**。
 *
 * 用户实况（2026-11-24 / 11-25，三次）：
 *  - 「执行完任务后没有回答我消息」—— 只写账本、群里静悄悄；
 *  - 「每次我要求群里 agent 互相沟通…就会有 agent 单方面发出结果」—— 队友还没回话就发 result；
 *  - 「我看到的是程序或者提示词设置好的程序」—— 正文里拼【项目 X】之类的机器标签。
 *
 * 这三条以前写在 8.9k 行的面板里，测试只能读源码。现在结论由这个纯函数给出，
 * 面板只负责执行（发账本 / 发群消息）—— 于是每条规则都能被真的跑一遍。
 */

import type { TodoRunOutcome } from '../core/todoArchives';

export interface OutcomeMeta {
  project?: string;
  seconds?: number;
  files?: string[];
  stopped?: boolean;
}

export interface OutcomePostPlan {
  /** 账本：有需求号时才写，状态必须和群里说的话一致。 */
  ledger?: { status: 'done' | 'in_progress'; summary: string; note: string };
  /**
   * 群消息。`undefined` 表示这一轮**不发群**（被顶掉 / 本机已经报过）。
   * 注意：账本仍会写，所以「这轮被中断」照样有据可查。
   */
  post?: {
    phase: 'result' | 'progress' | 'question';
    body: string;
    options?: string[];
    meta: OutcomeMeta;
  };
  /** 指示灯语义：true = 在等甲方（黄闪）。 */
  askedUser: boolean;
}

/** 没跑完时给甲方的三个可选动作（界面画成按钮）。 */
export const OUTCOME_OPTIONS = ['接着做', '换个做法', '让另一台先做'] as const;

/** agent 什么都没说时的兜底正文（宁可少说，也不编内容）。 */
const EMPTY_BODY = '这一轮没有产生结论：我还需要一点信息才能继续。';

export function planOutcomePost(input: {
  outcome: TodoRunOutcome;
  /** agent 自己最后一轮的正文（气泡里给甲方看的就是它）。 */
  text: string;
  files: readonly string[];
  /** 群里最近一条需求号；空表示没有可挂的需求。 */
  requirementId: string;
  project?: string;
  /** 真实耗时（秒）；没有开始时间时传 undefined —— 绝不编一个。 */
  seconds?: number;
  /** 本机问出去、队友还没回话的人名。 */
  waitingTeammates: readonly string[];
  /** 本机已经在这条需求下发过 result / blocked。 */
  alreadyReported: boolean;
  /** 这一轮被更新的消息顶掉（甲方刚说了下一步）。 */
  superseded: boolean;
}): OutcomePostPlan {
  const done = input.outcome === 'completed';
  const teammates = [...new Set(input.waitingTeammates.filter(Boolean))];
  const text = input.text.trim();
  const meta: OutcomeMeta = {
    ...(input.project ? { project: input.project } : {}),
    ...(input.seconds !== undefined ? { seconds: input.seconds } : {}),
    ...(input.files.length ? { files: [...input.files] } : {}),
  };

  /*
   * 账本：有需求号才写。状态与群里说的话必须一致 ——
   * 旧写法只看 outcome，于是群里写「还在等回话」，看板已经打了「已完成」。
   *
   * 被新消息顶掉的那一轮也按「未完成」记：它的活已经被更新的那条接走了，
   * 记成 done 会让看板说「这条做完了」，而甲方看到的恰恰是「做了一半被打断」。
   */
  const ledgerStatus: 'done' | 'in_progress' = done && teammates.length === 0 && !input.superseded
    ? 'done'
    : 'in_progress';
  const ledger = input.requirementId
    ? {
      status: ledgerStatus,
      summary: text.replace(/\s+/g, ' ').slice(0, 400),
      note: ledgerStatus === 'done'
        ? ''
        : input.superseded
          ? '这一轮被甲方的新消息顶掉了，按未完成计：那条新消息会接着做。'
          : teammates.length
            ? `本端这一轮做完了这半边，还在等「${teammates.join('、')}」回话，还没达成一致。`
            : '本端这一轮没有跑完（被停止或出错），可以接着做。',
    }
    : undefined;

  /*
   * 被顶掉的那一轮**不弹「等你回答」**：甲方刚说完下一步，再挂一个「需要你决定」
   * 只会让人以为新消息没生效。已经报过 result 的也不重复发（否则群里刷屏）。
   */
  if (input.superseded || input.alreadyReported) return { ...(ledger ? { ledger } : {}), askedUser: false };

  // 没跑完：用 question（群里算「等你回复」，甲方下一句就接在这条需求上）。
  if (!done) {
    return {
      ...(ledger ? { ledger } : {}),
      post: {
        phase: 'question',
        body: text || EMPTY_BODY,
        options: [...OUTCOME_OPTIONS],
        meta: { ...meta, stopped: true },
      },
      askedUser: true,
    };
  }

  // 跑完了但队友还没回话：按事实只能发进度，别单方面宣布一致。
  if (teammates.length) {
    return {
      ...(ledger ? { ledger } : {}),
      post: {
        phase: 'progress',
        body: [text, `还在等「${teammates.join('、')}」回话 —— 这条**还不是最终结果**。等它回答后我再合并两边结论。`]
          .filter(Boolean).join('\n\n'),
        meta,
      },
      askedUser: false,
    };
  }

  return {
    ...(ledger ? { ledger } : {}),
    post: { phase: 'result', body: text || '这一轮做完了。', meta },
    askedUser: false,
  };
}

/**
 * 这条需求是不是「刚被本机报过 result / blocked」。
 *
 * 群里的消息是唯一事实来源：模型可能自己用 `team_sync` 报过一次，
 * 收尾时再报一次就是刷屏。
 */
export function alreadyReportedBySelf(input: {
  requirementId: string;
  selfId: string;
  group: ReadonlyArray<{ author: string; phase: string; requirementId?: string; from: { id: string } }>;
}): boolean {
  if (!input.requirementId) return false;
  return input.group.some((item) => item.requirementId === input.requirementId
    && item.author === 'agent'
    && item.from.id === input.selfId
    && (item.phase === 'result' || item.phase === 'blocked'));
}
