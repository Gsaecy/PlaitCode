/**
 * 团队群的**过程纪律**：让协作真的推进，而不是互相复述。
 *
 * 用户 2026-11-26（原话）：「团队群里面 agent 很没有逻辑，请查询网络成熟的项目推进工作方法，
 * 来约束行为，避免 agent 相互乱说，又没有逻辑，这里改一下，那里改一下，项目却没有丝毫推进。」
 *
 * 采用的做法（都是成熟方法论里**可机器校验**的那部分）：
 *  - **单件流 / WIP=1**（Kanban、Lean）：同时只允许一件事在「进行中」；
 *  - **目标条件 → 现状 → 下一个动作**（Toyota Kata / PDCA）：每条进展都要落到「现在做第几步」；
 *  - **Definition of Done**（Scrum）：说「完成」必须带证据（文件 / 命令 / 数字），否则只能算进展；
 *  - **不做无证据的状态播报**（incident comms）：重复同一句话不算推进；
 *  - **停线（Andon）**（Lean）：长时间没有进展就**停下来问人**，而不是继续空转。
 *
 * 这里只放纯判据，测试直接执行；真正的拦截点在 `LanSyncService.postGroup()`。
 */

/** 判定「重复」的相似度阈值：同一件事换个说法不算新信息。 */
export const POST_SIMILAR_RATIO = 0.86;
/** 只看最近这么多条 agent 发言判断重复。 */
export const RECENT_POST_WINDOW = 8;
/**
 * 连续这么多条 agent 发言**没有任何推进信号**（清单没变、阶段没变、没有新报告）就停线。
 *
 * 12 条 ≈ 两台各说 6 句。真人协作里这个量级还在正常讨论；超过就是在绕圈。
 */
export const STALE_POST_LIMIT = 12;
/** 停线后仍然没有进展，就把自动应答也关掉（真停，而不是再喊一遍）。 */
export const STALE_POST_HARD_LIMIT = 20;

/** 归一化：去掉标点/空白/大小写差异，只留下内容。 */
export function normalizePost(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s`*_>#\-—–·、，。！？；：""''（）()【】\[\]{}]+/g, '')
    .trim();
}

/** 两条发言是不是「同一件事换个说法」。用字符二元组的 Jaccard 相似度。 */
export function similarPost(left: string, right: string): boolean {
  const a = normalizePost(left);
  const b = normalizePost(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // 长度差太多基本不是重复（避免「一句话 vs 一整段」被误判）。
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.6) return false;
  const grams = (value: string): Set<string> => {
    const set = new Set<string>();
    for (let index = 0; index + 1 < value.length; index += 1) set.add(value.slice(index, index + 2));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return false;
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared += 1;
  return shared / (ga.size + gb.size - shared) >= POST_SIMILAR_RATIO;
}

/** 这条发言是不是在重复最近说过的话。 */
export function duplicatesRecent(body: string, recent: readonly string[]): boolean {
  return recent.slice(-RECENT_POST_WINDOW).some((item) => similarPost(body, item));
}

/**
 * **WIP = 1**：同一时刻只允许一件事「进行中」。
 *
 * 依据：Kanban/Lean 的 WIP 限制（「no one is multitasking」）与 Toyota Kata 的
 * 「一次只攻一个障碍」。多件同时进行中的可观测后果就是用户说的
 * 「这里改一下，那里改一下，项目却没有丝毫推进」——每件都开个头，没有一件被验证。
 *
 * 策略：保留**第一件**进行中（那通常正是手里这件），其余降回 pending。
 */
export function enforceSingleInProgress<T extends { content: string; status: string }>(
  todos: readonly T[],
): { todos: T[]; demoted: string[] } {
  const first = todos.findIndex((todo) => todo.status === 'in_progress');
  if (first < 0) return { todos: [...todos], demoted: [] };
  const demoted: string[] = [];
  const next = todos.map((todo, index) => {
    if (index === first || todo.status !== 'in_progress') return todo;
    demoted.push(todo.content);
    return { ...todo, status: 'pending' };
  });
  return { todos: next, demoted };
}

/**
 * 「结果」必须带证据。
 *
 * Definition of Done 的最低门槛：说做完了，就得能指出**改了什么 / 验证了什么 / 数字是多少**。
 * 纯口语的「已经处理好了」不算结果。
 */
export function hasEvidence(body: string): boolean {
  const text = String(body ?? '');
  // 文件 / 路径 / 命令 / 行号 / 数字，任一即可。
  if (/[A-Za-z0-9_\-/\\]+\.[A-Za-z0-9]{1,6}\b/.test(text)) return true;
  if (/\d/.test(text)) return true;
  if (/(?:行|line\s*\d+)/i.test(text)) return true;
  return false;
}

export interface PostCheckInput {
  body: string;
  phase: string;
  /** 最近若干条**本机** agent 发言（用于去重）。 */
  recent: readonly string[];
}

export interface PostCheckResult {
  action: 'accept' | 'reject';
  /** 拒绝时给模型看的话（要求它换个做法，而不是继续重说）。 */
  guidance?: string;
}

/**
 * 一条 agent 发言该不该发出去。
 *
 * 只拦两种**明确有害**的：
 *  1. 和最近说过的几乎一样（复述不产生信息，只会把看板刷满）；
 *  2. 说「结果」却没有任何可核对的东西（那就只能算进展）。
 *
 * 其它一律放行 —— 判断「有没有逻辑」是模型的事，这里只拒绝「确定没信息量」的。
 */
/**
 * 「结果」必须带证据 —— **但方案不算结果**。
 *
 * 方案天生没有「改了哪个文件」可写（还没动手），拿证据去卡它会直接卡死整条流程：
 * 真实后果（2026-11-26 自测发现）—— 方案发言被拦 → 阶段永远停在「沟通中」→
 * 甲方回「确认」也不认 → 写操作永远被拦。
 */
export function looksLikePlanPost(body: string): boolean {
  return /(?:方案|计划|步骤)\s*[:：]|待甲方确认|请甲方确认|等你确认|请确认方案/.test(String(body ?? ''));
}

export function checkTeamPost(input: PostCheckInput): PostCheckResult {
  if (!String(input.body ?? '').trim()) {
    return { action: 'reject', guidance: '空消息不要发。要么给事实，要么给下一步动作。' };
  }
  if (duplicatesRecent(input.body, input.recent)) {
    return {
      action: 'reject',
      guidance: '这条和刚才说过的几乎一样，重复一遍不会推进项目。'
        + '要么补**新的事实/数字/文件**，要么直接说「下一步我做哪一件、怎么验证」。',
    };
  }
  if (input.phase === 'result' && !looksLikePlanPost(input.body) && !hasEvidence(input.body)) {
    return {
      action: 'reject',
      guidance: '这条要当「结果」发，但里面没有任何可核对的东西（文件、命令、数字、行号）。'
        + '按 Definition of Done：说完成必须带证据；如果还没有证据，请用 phase=progress 发。',
    };
  }
  return { action: 'accept' };
}

export type StaleVerdict = 'ok' | 'nudge' | 'hold';

/**
 * 「连续多少条发言没有推进」→ 该怎么办。
 *
 * @param stalePosts 自上次真正推进（清单变化 / 阶段推进 / 收到报告 / 甲方发话）以来的 agent 发言条数
 */
export function staleWatchVerdict(stalePosts: number): StaleVerdict {
  if (stalePosts >= STALE_POST_HARD_LIMIT) return 'hold';
  if (stalePosts >= STALE_POST_LIMIT) return 'nudge';
  return 'ok';
}

/**
 * 写进群里的「停线」提示。
 *
 * 用 Toyota Kata 的三段式：现状 → 目标条件 → **只给一个**下一步动作。
 * 给三个选项让人一句话决定，而不是继续让两台互相解释。
 */
export function staleNudgeBody(stalePosts: number): string {
  return [
    `**暂停一下：这 ${stalePosts} 条发言里项目没有推进。**`,
    '',
    '- 现状：清单没变、代码没动、也没有新的事实或数字。',
    '- 目标条件：这一轮只推进**一件事**，并且能被验证。',
    '- 下一步：请只回答一件事 —— 谁来改哪个文件、改完用什么命令/步骤验证。',
    '',
    '（我会先停在讨论里；甲方定一句再继续。）',
  ].join('\n');
}

/**
 * 写进协议提示词的过程纪律。
 *
 * 与上面两条判据配套：判据负责「拦」，这段负责让模型**一开始就不这么干**。
 */
export const TEAM_DISCIPLINE_PROMPT = [
  '## 过程纪律（宿主强制的协作规则）',
  '',
  '甲方明确说过：**不要相互乱说、不要这里改一下那里改一下、项目要真的推进**。所以：',
  '',
  '1. **单件流**：同一时刻只允许**一件事**在「进行中」。清单里已经有 in_progress 时，',
  '   不要再开第二件；先把它做完或明确放弃。',
  '2. **每轮只推进一个动作**：读现状 → 选**一个**动作 → 做 → 验证 → 用一条消息汇报。',
  '   不要在一轮里同时改三个地方，也不要只描述「我打算怎么做」却不做。',
  '3. **用事实说话**：每条进展必须带至少一个可核对的东西（文件路径、命令、数字、行号）。',
  '   没有证据就写「还没验证」，不要写成结论。',
  '4. **不重复**：刚刚说过的结论不要再换一种说法发一遍；宿主会直接拒掉几乎相同的发言。',
  '5. **说「完成」要有证据**：phase=result 必须能指出改了什么、怎么验证的；否则用 progress。',
  '6. **绕圈就停**：如果连续几条都没有新事实，停下来问甲方一句（只问一件），不要继续互推。',
  '',
].join('\n');
