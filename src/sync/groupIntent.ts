import type { ChatSettings } from '../core/types';
import type { DeepSeekClient } from '../providers/deepseekClient';

/**
 * 群消息的类型。
 *
 * 群聊是「大家一起说话的地方」，不是命令行。所以群里来一句话，要先判断它是什么：
 *
 *  - `chat`：问答、闲聊、算数、让你复述点什么 —— **只在群里回一句**，
 *            不进任何人的主对话，也不跑工具。
 *  - `task`：要改代码、要动手的活 —— 才走「解析 → 追问 → 确认 → 各自执行」。
 */
export type GroupIntent = 'chat' | 'task';

/**
 * 解析分类模型的回复。
 *
 * 只认明确的词，认不出来交给关键词兜底 —— 群消息分类错一次，
 * 要么该干的活没干，要么平白跑一轮把额度烧掉，所以宁可保守。
 */
export function parseGroupIntent(reply: string): GroupIntent | undefined {
  const text = (reply ?? '').toLocaleUpperCase();
  if (/\bCHAT\b/.test(text) || /\bQUESTION\b/.test(text) || /\bSMALLTALK\b/.test(text)) return 'chat';
  if (/\bTASK\b/.test(text) || /\bACTION\b/.test(text) || /\bDO\b/.test(text)) return 'task';
  return undefined;
}

/** 动词类关键词：出现这些基本就是要动手。 */
const TASK_WORDS = [
  '改', '加', '删', '修', '实现', '做', '替换', '调整', '优化', '重构', '新增', '补上', '去掉',
  '迁移', '升级', '修复', '接入', '拆分', '合并', '统一', '对齐', '导出', '生成',
  '写进', '写入', '记录', '保存', '提交', '推送', '部署', '打包', '上传',
  'add', 'fix', 'change', 'implement', 'refactor', 'update', 'remove', 'rename', 'migrate',
  'write', 'save', 'commit', 'push', 'deploy', 'build',
];

/** 只在群里回一句就够的信号：提问、算数、复述。 */
const CHAT_WORDS = ['几', '多少', '是什么', '为什么', '怎么读', '是谁', '报数', '念一遍', '算一下', '等于'];

/**
 * 关键词兜底（模型没给出可用答案时）。
 *
 * 顺序很重要：**先判断"是不是只是问一句"**。
 * 「报数」这类短句如果先撞上"做/改"之类的词，就会被误判成任务。
 */
export function fallbackGroupIntent(text: string): GroupIntent {
  const value = (text ?? '').trim();
  if (!value) return 'chat';
  const lower = value.toLocaleLowerCase();

  // 纯算数/极短问句：明显只是想让你回一句。
  if (/^[\d\s+\-*/×÷=()？?]+$/.test(value)) return 'chat';
  if (value.length <= 6 && !TASK_WORDS.some((word) => lower.includes(word))) return 'chat';
  const asksQuestion = /[？?]$/.test(value) && !TASK_WORDS.some((word) => lower.includes(word));
  if (asksQuestion) return 'chat';
  if (CHAT_WORDS.some((word) => value.includes(word)) && !TASK_WORDS.some((word) => lower.includes(word))) {
    return 'chat';
  }
  if (TASK_WORDS.some((word) => lower.includes(word))) return 'task';
  // 拿不准时按任务处理：漏做的代价比多问一轮大。
  return 'task';
}

/**
 * 「报数 / 报到 / 点名」这类口令：喊号，不是任务，也不该有正文。
 *
 * 用户 2026-11-25：「报数不是应该报 1、2、3、4 吗？为什么 agent 回复这么复杂」
 * —— 点名只回自己的序号，交给模型只会得到一篇项目汇报。
 *
 * 只在**整句就是一个口令**时才认（允许句末标点）；带别的内容照旧走 agent，
 * 例如「报数之后把结果写进 README」仍然是一个任务。
 */
export function isRollCallCommand(text: string): boolean {
  const value = (text ?? '').trim().replace(/[\s。.!！?？,，、~～]+$/g, '');
  return /^(报数|报到|点名|点名报数|roll\s*-?\s*call|count\s*off)$/i.test(value);
}

/**
 * 这句话是不是在回答「正在等甲方的那台」。
 *
 * 用户实况（2026-11-25）：Windows 有一条追问在等回答，甲方却在群里 @ 了
 * macOS 说新事情 —— 结果这句话被当成「回答 Windows 的追问」，Windows 开跑，
 * @ 的那台什么也没收到。
 *
 * 判据：甲方明确点名了另一台（`target` 非空且不是提问者）→ 这是新需求，
 * 不是回答；没点名 / 点的就是提问者 → 仍按回答处理。
 */
export function targetsOpenQuestion(target: string, askerId: string): boolean {
  return !target || !askerId || target === askerId;
}

/** 「接着做 / 换个做法」这类可直接结算追问的短回答。 */
const SHORT_ANSWERS = ['接着做', '继续', '好', '好的', '可以', '行', '同意', '拒绝', '不用', '停', '停下', '换做法', '换个做法', '让另一台先做'];

/**
 * 这一轮收尾该往群里发哪个阶段。
 *
 * 用户实况（2026-11-25）：「每次我要求群里的 agent 互相沟通、达成一致的方案的时候，
 * 就会有 agent 单方面读取并发出结果。我并没有看到沟通，实际上其他 agent 还没有执行完。」
 *
 * 所以「结果」不是「我跑完了一轮」的同义词：
 *  - 这一轮没跑完 → `question`（等甲方 / 等讨论）；
 *  - 跑完了但还有问队友的问题没被回答 → `progress`（**不是结果**，还在等对方）；
 *  - 跑完了且没有等人 → `result`。
 */
export function outcomePhaseFor(
  done: boolean,
  pendingPeerAsks: number,
): 'result' | 'progress' | 'question' {
  if (!done) return 'question';
  return pendingPeerAsks > 0 ? 'progress' : 'result';
}

/**
 * 甲方这句话是不是在**回答**正在等的追问。
 *
 * 用户实况（2026-11-25）：「我没 @ 谁，直接发的消息却显示 @windows，导致 macOS 没收到」——
 * 以前只要有追问在等，下一句话就被当成回答，只发给提问的那台；可那往往是
 * 一条**新的、要两台一起做**的指令。
 *
 * 所以现在只有两种情况算回答：
 *  - 甲方**明确 @ 了**提问的那台；
 *  - 没点名，但内容就是一句短回答（追问给的选项，或「接着做 / 好 / 拒绝」这类词）。
 * 其余一律当作**新需求**广播给所有人。
 */
/**
 * 这句话像不像「甲方自己说的做法」（自由回答），而不是一句普通的群消息。
 *
 * 为什么需要（2026-11-25 的真实故障，任何多设备群都会遇到）：
 * 只要本机还挂着一张「等你选」的决策卡，旧逻辑会把**任何 ≤60 字**的发言
 * 都当成「你自己说怎么做」并立刻结算掉那张卡 —— 于是甲方发来的新需求
 * 被当成答案吞了：群里没有 @、谁都不执行，看起来像消息丢了。
 *
 * 现在的门槛：要么开头就是「你自己 / 我 / 按…」这类自由回答的口气，
 * 要么明确说了「你决定 / 按你说的」。普通的陈述句一律不接管。
 */
export function looksLikeOwnWordsAnswer(text: string): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  if (/^(?:你自己|你决定|你定|随便|随意|都行|按你说的|就按|就用|我选|我要|我想|我这里|我这边)/.test(value)) return true;
  return /(?:你自己(?:定|决定|看着办)|你决定|按你说的(?:做|办)|就按这个)/.test(value);
}

/**
 * 甲方这句话是不是在回答某台设备的追问。
 *
 * @param input.target 甲方**明确点名的设备**（@ 或「由谁执行」选的）。非空时以它为准：
 *   点名的不是提问那台 → 这是派活；点名的就是提问那台 → 就是回答。
 *   这条规则对任意台数都成立，不依赖设备名或顺序。
 */
export function isAnswerToOpenQuestion(input: {
  text: string;
  /** 甲方明确点名的设备 id（@ 或者「由谁执行」选的），没有就是空。 */
  target?: string;
  askerId: string;
  options?: readonly string[];
}): boolean {
  const target = (input.target ?? '').trim();
  // 点名了别的设备：这是派活，不是回答。
  if (target && target !== input.askerId) return false;
  // 明确 @ 了提问那台：就是回答。
  if (target && target === input.askerId) return true;
  const text = (input.text ?? '').trim();
  if (!text || text.length > 24) return false;
  const normalized = text.replace(/[\s。.!！?？,，、~～]+$/g, '');
  const options = (input.options ?? []).map((option) => option.trim()).filter(Boolean);
  if (options.some((option) => normalized === option || normalized.includes(option))) return true;
  return SHORT_ANSWERS.some((word) => normalized === word || normalized.startsWith(word));
}

/**
 * 这台在群里喊第几号。
 *
 * 按设备 id 排序而不是连接 / 发言顺序：两台设备各自算，号必须一样，
 * 否则群里会同时出现两个「1」。
 */
export function rollCallNumber(deviceId: string, roster: readonly { id: string }[]): number {
  const ids = [...new Set(roster.map((item) => item.id).filter(Boolean))].sort();
  const index = ids.indexOf(deviceId);
  return index >= 0 ? index + 1 : 1;
}

export interface GroupIntentResult {
  intent: GroupIntent;
  /** 判定依据：`model` 表示模型给的，`keyword` 表示关键词兜底。写进日志便于事后查。 */
  reason: string;
}

export interface GroupChatContext {
  /** 本机在做的项目名（文件夹名）。 */
  projectName?: string;
  /** 项目唯一 ID：GitHub 仓库地址。 */
  projectRepo?: string;
  /** 本机项目的绝对路径（agent 据此知道「项目在哪」）。 */
  projectPath?: string;
  /** 群里有几台设备、分别是谁。 */
  members?: readonly string[];
}

/**
 * 直接在群里回一句（不跑工具、不动任何文件）。
 *
 * 这是「驻留群里的机器人」的核心体验：你问「1+1 等于几」，
 * 它就在群里答一句，而不是把它当任务开一轮。
 *
 * **必须带上项目上下文** —— 否则用户问「现在在哪个项目下」，
 * agent 只能回答「我只知道自己运行在某个 IP 上」，等于没答。
 */
export async function answerGroupChat(
  client: DeepSeekClient,
  settings: ChatSettings,
  message: string,
  signal: AbortSignal,
  recent: readonly string[] = [],
  deviceName = '',
  context: GroupChatContext = {},
): Promise<string> {
  let content = '';
  const facts = [
    deviceName ? `你在设备「${deviceName}」上。` : '',
    context.projectName ? `当前项目：${context.projectName}。` : '',
    context.projectRepo ? `项目仓库：${context.projectRepo}（这是两台设备判断"同一个项目"的唯一依据）。` : '',
    context.projectPath ? `本机项目目录：${context.projectPath}。` : '',
    context.members?.length ? `群里的设备：${context.members.join('、')}。` : '',
  ].filter(Boolean).join('\n');

  try {
    const result = await client.streamChat(
      { ...settings, temperature: 0.3, maxTokens: 400 },
      [
        {
          role: 'system',
          content: [
            'You are one of the coding agents sitting in a team chat with a non-technical client and other agents on other computers.',
            'Answer ONLY what was asked, in the client\'s language, in 1-3 short sentences.',
            'Use the facts below. Never claim you cannot see the project: the facts are given to you.',
            'Do not describe tools or plans. Do not ask for confirmation. Do not offer to change code.',
            'If asked to actually change something, say briefly that you will treat it as a task.',
            facts ? `FACTS:\n${facts}` : '',
          ].filter(Boolean).join(' '),
        },
        {
          role: 'user',
          content: [
            recent.length ? `RECENT GROUP MESSAGES:\n${recent.slice(-5).join('\n')}` : '',
            `MESSAGE:\n${message}`,
          ].filter(Boolean).join('\n\n'),
        },
      ],
      { signal, onDelta: (delta) => { content += delta.content ?? ''; } },
    );
    const answer = (content || result.content || '').trim();
    if (answer) return answer.slice(0, 2_000);
  } catch {
    // 答不出来也要有个交代，不能让群里一片空白。
  }
  return '（这条我没法在群里直接回答，可以换个说法，或者明确告诉我要改什么。）';
}


/**
 * 判断一条群消息该「回一句」还是「动手做」。
 *
 * 用一次**不带工具**的极短请求（32 token、temperature 0）：
 * 比让主 agent 先跑一轮再判断便宜得多，也不会污染主对话。
 */
export async function classifyGroupIntent(
  client: DeepSeekClient,
  settings: ChatSettings,
  message: string,
  signal: AbortSignal,
  /** 群里最近几条发言：上下文能区分「报数」是闲聊还是在推进某个任务。 */
  recent: readonly string[] = [],
): Promise<GroupIntentResult> {
  let content = '';
  try {
    const result = await client.streamChat(
      { ...settings, temperature: 0, maxTokens: 16, reasoningEffort: 'none' },
      [
        {
          role: 'system',
          content: [
            'You classify messages posted in a team chat between a non-technical client and coding agents.',
            'Reply with exactly one word: CHAT or TASK.',
            'CHAT: the message only needs a short answer in the group. Counting, arithmetic, definitions, small talk, asking what you can do, repeating something back.',
            'TASK: the message asks the agents to change code, files, UI, behaviour, or configuration in their own project.',
            'When the message is a plain question with no change requested, answer CHAT.',
            'When a concrete change is requested, answer TASK.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            recent.length ? `RECENT GROUP MESSAGES:\n${recent.slice(-5).join('\n')}` : '',
            `MESSAGE:\n${message}`,
          ].filter(Boolean).join('\n\n'),
        },
      ],
      { signal, onDelta: (delta) => { content += delta.content ?? ''; } },
    );
    const parsed = parseGroupIntent(`${content}\n${result.content}`);
    if (parsed) return { intent: parsed, reason: 'model' };
  } catch {
    // 分类失败不能挡住用户发言：走关键词兜底。
  }
  return { intent: fallbackGroupIntent(message), reason: 'keyword' };
}
