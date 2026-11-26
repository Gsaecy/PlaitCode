/**
 * `team_sync`：让 agent 像同事一样和对端设备的 agent 沟通。
 *
 * 用户的原话（2026-11-23）：
 *   「甚至两边设备的 agent 可以像一个团队的同事一样沟通交流项目的情况，互通有无」
 *
 * 工具刻意只有三个动作：
 *  - `send`：把一段话发给队友（例如「我把窗口标题栏改成自绘了，你那边边距要不要一起调」）；
 *  - `ask`：发一个**需要回答**的问题（对端会自动跑一轮来回答）；
 *  - `status`：看当前协作状态、最近消息、以及哪些需求还没对齐。
 *
 * 为什么不做成「自由聊天」：两个 agent 无限互发会把配额烧光。所以协议层有
 * `shouldAutoRespond`（只有真在问才触发对端自动运行），提示词层也明令禁止
 * 「收到 / 好的」这类空消息。
 */

import { deviceLabel, renderNotes, shouldAutoRespond, type GroupPhase } from './lanProtocol';
import type { LanSyncService } from './lanSync';
import type { ToolDefinition, ToolExecutionResult } from '../core/types';

/**
 * `ask` 最多等队友多久（毫秒）。
 *
 * 队友可能正在跑上一件事，几秒钟肯定不够；但等太久又会把整轮卡死 ——
 * 90 秒是「够它跑完一次回答、又不至于让用户以为界面卡住」的折中。
 * 超时不是失败：如实说「它还没回话」，并且**不许**把这一轮说成「已达成一致」。
 */
const ASK_REPLY_WAIT_MS = 90_000;

export function teamSyncToolDefinition(enabled: boolean): ToolDefinition | undefined {
  if (!enabled) return undefined;
  return {
    type: 'function',
    function: {
      name: 'team_sync',
      description: [
        '与同一 WiFi 下另一台设备的 agent 沟通（同一个 app 的另一个平台版本）。',
        'action=send 发一条进展或决定；action=ask 向队友提问（对方会跑一轮来回答，本机当场等它的回答，最多 90 秒）；action=status 查看协作状态与待对齐项。',
        '甲方要求「你们先沟通、达成一致」时：先用 ask 问清对方那一端的事实，拿到回答合并后再发结果；回答没到就不要宣布结论。',
        '只在确有必要时使用：不要发「收到」「好的」这类空消息，也不要为了保证同步而重复发同样内容。',
      ].join(''),
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['analysis', 'question', 'confirm', 'progress', 'result', 'send', 'ask', 'status'],
            description: 'analysis/question/confirm/progress/result 是发到团队群的发言；send/ask 是点对点找队友；status 查状态。',
          },
          message: { type: 'string', description: '要发的内容（除 status 外都必填）' },
          topic: { type: 'string', description: '可选主题，便于把同一件事的往来归组' },
          replyTo: { type: 'string', description: '可选：回复哪一条消息的 id' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'action=question 时可点的选项（2-4 个，一句话一个）',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  };
}

export interface TeamSyncResult {
  status: 'success' | 'denied';
  summary: string;
  content: string;
}

/** 执行一次 `team_sync`。同步未启用时明确拒绝，而不是假装成功。 */
export async function runTeamSync(
  service: LanSyncService | undefined,
  args: Record<string, unknown>,
  options?: { requirementId?: string },
): Promise<TeamSyncResult> {
  if (!service) {
    return {
      status: 'denied',
      summary: '局域网同步未启用',
      content: '局域网同步没有启用，无法联系队友。需要用户在 HWChat 里启动「局域网同步」后再试。',
    };
  }
  const action = typeof args.action === 'string' ? args.action : 'status';
  if (action === 'status') {
    const state = service.state();
    const notes = renderNotes(service.recentNotes(8), 8);
    const requirements = service.requirementTitles(6);
    return {
      status: 'success',
      summary: state.text,
      content: [
        state.text,
        requirements.length ? `最近需求：\n- ${requirements.join('\n- ')}` : '最近需求：（无）',
        notes.length ? `最近消息：\n- ${notes.join('\n- ')}` : '最近消息：（无）',
      ].join('\n\n'),
    };
  }
  const message = typeof args.message === 'string' ? args.message.trim() : '';
  if (!message) {
    return { status: 'denied', summary: '缺少消息内容', content: '除了 action=status，都必须提供 message。' };
  }
  /*
   * 发到**团队群**的发言（解析 / 追问 / 确认 / 进度 / 结果）。
   *
   * 提示词一直让模型用 `action=analysis|question|confirm|progress|result`，但旧实现
   * 只认 send / ask / status —— 其余一律当成「给队友发消息」，于是模型以为
   * 「我已经在群里报了结果」，群里却什么也没有。这里按阶段真发进群。
   */
  const phases: Record<string, GroupPhase> = {
    analysis: 'analysis',
    question: 'question',
    confirm: 'confirm',
    progress: 'progress',
    result: 'result',
    blocked: 'blocked',
  };
  const phase = phases[action];
  if (phase) {
    const requirementId = options?.requirementId
      || service.openQuestionRequirement()
      || service.latestRequirementId()
      || '';
    /*
     * 「结果」不放过闸：还有问出去的事没被回答时不发 result。
     * 这是 2026-11-25 用户实况的核心 —— 不许单方面宣布一致。
     */
    const waiting = phase === 'result' ? service.pendingAsksFor(requirementId) : [];
    const finalPhase: GroupPhase = waiting.length ? 'progress' : phase;
    const who = [...new Set(waiting.map((item) => item.label))].join('、');
    const body = waiting.length
      ? [message, `还在等「${who}」回话 —— 这条**还不是最终结果**。等它回答后我再合并两边结论。`].join('\n\n')
      : message;
    const options2 = phase === 'question'
      ? (Array.isArray(args.options) ? args.options : [])
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0 && item.length <= 40)
        .slice(0, 4)
      : [];
    const posted = await service.postGroup({
      author: 'agent',
      phase: finalPhase,
      body,
      ...(requirementId ? { requirementId } : {}),
      ...(options2.length ? { options: options2 } : {}),
    });
    return {
      status: posted.ok ? 'success' : 'denied',
      summary: waiting.length ? '已发进度（还在等队友回话）' : `已发到团队群（${finalPhase}）`,
      content: waiting.length
        ? `${posted.message}\n这一轮**不算结果**：等「${who}」回话后你会被重新叫起来合并结论。`
        : posted.message,
    };
  }
  const question = action === 'ask';
  const result = await service.shareNote({
    body: question ? `${message}` : message,
    topic: typeof args.topic === 'string' ? args.topic : '',
    replyTo: typeof args.replyTo === 'string' ? args.replyTo : '',
  });
  if (!question) {
    /*
     * 即使是 `send`，只要正文真的在问队友（`shouldAutoRespond` 为真），也要记账：
     * 问出去的问题没被回答之前，这一轮同样不能自称「已达成一致」。
     */
    if (result.note && shouldAutoRespond(result.note)) {
      service.noteAskSent(result.note, options?.requirementId ?? '');
      return {
        status: result.ok ? 'success' : 'denied',
        summary: '已向队友提问',
        content: [
          result.message,
          '',
          '这条是在问队友，它会被触发跑一轮来回答。**回答到达之前不要发结果**：',
          '只说明你在等哪一点；它回话后你会被叫起来合并结论。',
        ].join('\n'),
      };
    }
    return {
      status: result.ok ? 'success' : 'denied',
      summary: '已发送给队友',
      content: result.message,
    };
  }
  /*
   * `ask` 必须**真的等到回话**（有上限），不能发完就说「问过了」。
   *
   * 用户实况（2026-11-25）：「要求群里的 agent 互相沟通、达成一致，就会有 agent
   * 单方面读取并发出结果。我并没有看到沟通，实际上其他 agent 还没有执行完。」
   * 根因之一：旧实现发完提问就立刻返回，模型于是把「问过了」当成「谈好了」。
   */
  if (result.note) service.noteAskSent(result.note, options?.requirementId ?? '', result.delivered);
  /*
   * 没真的发出去时没有人会回答，等 90 秒纯粹是卡界面：直接如实说「没人在问」。
   */
  const canWait = result.delivered && service.groupState().peers.length > 1;
  const replies = result.note && canWait
    ? await service.waitForReply(result.note.id, ASK_REPLY_WAIT_MS)
    : [];
  const missing = result.note ? service.pendingAskPeers(result.note.id) : [];
  if (replies.length) {
    const roster = service.groupState().peers;
    return {
      status: 'success',
      summary: missing.length ? '部分队友已回答' : '队友已全部回答',
      content: [
        result.message,
        '',
        ...replies.flatMap((reply) => [`队友（${deviceLabel(reply.from, roster)}）的回答：`, reply.body, '']),
        missing.length
          ? `还在等「${missing.join('、')}」回话 —— 这一轮**还不能算结果**；收到后你会被叫起来合并。`
          : '所有收件人都回话了。把回答合并进结论再动下一步。',
        '两边**没谈拢**（它说的和你的方案不一致）时，不要发「结果」，先在群里说清分歧在哪、你打算按谁的来，等对方或甲方定。',
      ].join('\n'),
    };
  }
  return {
    status: 'success',
    summary: '已提问，队友还没回话',
    content: [
      result.message,
      '',
      canWait
        ? (missing.length ? `还没等到「${missing.join('、')}」回话：先别下结论。` : '还没等到回话：先别下结论。')
        : '群里现在只有这一台设备（或刚才没发出去），没有队友会回答。',
      '**现在不要发结果、也不要自称「已达成一致」**：只说明你在等它回答哪一点。',
      canWait
        ? '它回话后你会被重新叫起来合并结论 —— 到时候再给最终结果。'
        : '等其它设备进群后再问，或者直接按现有信息说明结论与前提。',
    ].join('\n'),
  };
}
