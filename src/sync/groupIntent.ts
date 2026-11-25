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
