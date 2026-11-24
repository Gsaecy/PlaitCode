/**
 * 任务看板：把「团队群里的一串发言」折叠成「一条条任务」。
 *
 * 为什么从群消息推导，而不是另存一份任务表：
 * 群消息本来就是唯一的广播事实源（中继负责投递、每台设备各存一份），
 * 再维护一张任务表就会出现「任务说已完成、群记录还停在追问」的两份真相。
 * 推导是纯函数，频道里每台设备看到的看板必然一致，断线重连后也不会丢任务。
 *
 * 一条任务的边界就是 `requirementId`：甲方那条 `requirement` 是任务本身，
 * 之后所有带同一个 id 的解析 / 追问 / 进度 / 结果都算它的过程。
 */
import type { GroupPhase, SyncGroupMessage } from './lanProtocol';

/** 任务状态。`question` 单独拎出来，因为它卡在**甲方**身上，不是 agent 在忙。 */
export type WorkTaskStatus = 'open' | 'running' | 'question' | 'blocked' | 'done';

export interface WorkTask {
  /** 任务号（= 需求号）。 */
  id: string;
  /** 首行摘要，给看板用。 */
  title: string;
  /** 针对哪个项目；旧消息没这个字段时为空串。 */
  project: string;
  /** 指派给哪台设备（设备 id）；空串表示没指派，谁都能接。 */
  assignee: string;
  /** 提出人名字。 */
  requester: string;
  status: WorkTaskStatus;
  createdAt: number;
  updatedAt: number;
  /** 最近一条进展 / 结果的一行摘要。 */
  lastLine: string;
}

const TITLE_MAX = 60;
const LINE_MAX = 120;

/** 哪些阶段说明「agent 已经在干活了」。 */
const RUNNING_PHASES: ReadonlySet<GroupPhase> = new Set(['analysis', 'confirm', 'progress', 'answer']);

function firstLine(text: string): string {
  const line = text.split('\n').map((item) => item.trim()).find(Boolean) ?? '';
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line;
}

/**
 * 折叠成任务列表，**最新的在前**。
 *
 * @param messages 群消息（顺序不限，内部按时间排）
 * @param limit 最多返回多少条任务
 */
export function buildTaskBoard(messages: readonly SyncGroupMessage[], limit = 50): WorkTask[] {
  const byId = new Map<string, WorkTask>();
  const ordered = [...messages].sort((left, right) => left.at - right.at);

  for (const message of ordered) {
    const id = message.requirementId || message.id;
    if (!id) continue;

    if (message.author === 'user' && message.phase === 'requirement') {
      // 甲方亲口提的需求才算任务的开始；agent 自己开的头（解析）不算。
      const existing = byId.get(id);
      const task: WorkTask = existing ?? {
        id,
        title: firstLine(message.body) || '(无标题)',
        project: '',
        assignee: '',
        requester: message.from.name,
        status: 'open',
        createdAt: message.at,
        updatedAt: message.at,
        lastLine: '',
      };
      // 后到的同号需求（重发/补充）以最新的指派与项目为准
      if (message.project) task.project = message.project;
      if (message.assignee) task.assignee = message.assignee;
      task.updatedAt = Math.max(task.updatedAt, message.at);
      byId.set(id, task);
      continue;
    }

    const task = byId.get(id);
    if (!task) continue;

    if (message.phase === 'question') {
      task.status = 'question';
      task.lastLine = oneLine(message.body);
    } else if (message.phase === 'blocked') {
      // 需求到了但没开跑：既不是在做，也不能算完成，否则看板会说谎
      if (task.status !== 'done') task.status = 'blocked';
      task.lastLine = oneLine(message.body);
    } else if (message.phase === 'result') {
      task.status = 'done';
      task.lastLine = oneLine(message.body);
    } else if (RUNNING_PHASES.has(message.phase)) {
      // 已经 done 的任务不该被迟到的进度消息拉回进行中
      if (task.status !== 'done') task.status = 'running';
      task.lastLine = oneLine(message.body);
    }
    task.updatedAt = Math.max(task.updatedAt, message.at);
  }

  const tasks = [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  return limit > 0 ? tasks.slice(0, limit) : tasks;
}

/** 看板分组顺序：卡在甲方身上的排最前，然后在做、待接、未执行、已完成。 */
export const TASK_STATUS_ORDER: readonly WorkTaskStatus[] = ['question', 'blocked', 'running', 'open', 'done'];

export const TASK_STATUS_LABEL: Record<WorkTaskStatus, string> = {
  question: '等你回复',
  blocked: '未执行',
  running: '进行中',
  open: '待接',
  done: '已完成',
};

/** 按状态分组，空组不返回。 */
export function groupTasksByStatus(tasks: readonly WorkTask[]): Array<{ status: WorkTaskStatus; tasks: WorkTask[] }> {
  return TASK_STATUS_ORDER
    .map((status) => ({ status, tasks: tasks.filter((task) => task.status === status) }))
    .filter((group) => group.tasks.length > 0);
}
