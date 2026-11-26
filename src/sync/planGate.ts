/**
 * 团队协作的**阶段约束**：先谈、出方案、等甲方确认，再动手。
 *
 * 用户 2026-11-26（原话）：「协作还有个大问题，agent 做事很莽撞，让他们沟通再做，他们会先做
 * 然后都在运行中导致不沟通。我希望他们先沟通，只读取各自设备上的文件，不修改，沟通好了
 * 必须出一份各自都同意且认为可行的方案给用户，用户确认了再动手修改文件。」
 *
 * 用户随后又明确纠正了实现方式：「**不要收权限**，而是约束它们在涉及需要配合的工作时候，
 * 没有统一方案不开工修改文件。」
 *
 * 所以这里**不抽工具**：写文件的工具始终在模型手里（能力完整，也不会有「我没有写文件能力」
 * 这种误报）。约束落在**动作**上 —— 谈判 / 等确认阶段，写文件、执行命令这类调用会被
 * `planGateBlockReason()` 当场拒掉，并告诉它「先把方案发到群里」。
 *
 * 三个阶段：
 *  1. `negotiate`（谈）：读各自设备的文件，和队友交换事实，形成**一份**方案；
 *  2. `awaiting-approval`（等）：方案发到群里，等甲方一句话；
 *  3. `implement`（做）：甲方确认后，写操作才被放行。
 */
export type TeamPhase = 'negotiate' | 'awaiting-approval' | 'implement';

export const TEAM_PHASES: readonly TeamPhase[] = ['negotiate', 'awaiting-approval', 'implement'];

export function isTeamPhase(value: unknown): value is TeamPhase {
  return typeof value === 'string' && (TEAM_PHASES as readonly string[]).includes(value);
}

/** 每条新需求都从「谈」开始：这是用户明确要求的默认。 */
export function initialTeamPhase(): TeamPhase {
  return 'negotiate';
}

/**
 * 这一轮允许动手改文件 / 执行会改状态的命令吗。
 *
 * 只有 `implement` 放行。`negotiate` 与 `awaiting-approval` 一律禁止，
 * 不论模型多想动手、也不论甲方上一句是不是说了「你先做」。
 */
export function allowsWriteTools(phase: TeamPhase): boolean {
  return phase === 'implement';
}

/**
 * 这些工具会**改变磁盘 / 系统状态**，谈判阶段一律拦下。
 *
 * 与 `SYNC_READ_ONLY_PLAYBOOK.blocked` 同一份口径：只拦「动手」，不拦读。
 */
export const WRITE_TOOL_NAMES: readonly string[] = [
  'write_file',
  'replace_in_file',
  'rename_file',
  'delete_file',
  'run_command',
  'update_project_doc',
];

export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.includes(name);
}

/**
 * 谈判阶段模型真的动手时，回给它的话。
 *
 * 三件事必须一次说清（用户 2026-11-26：「为什么要把风险留给我，不提前处理掉？」）：
 *  1. 这是**流程约束**，不是权限不足 —— 写工具在它手里，只是现在不许用；
 *  2. 不许索取授权、不许说「没有写文件能力」、不许当成故障汇报；
 *  3. 该干什么：把方案发到群里等确认。
 */
export function planGateBlockReason(toolName: string, phase: TeamPhase | undefined): string | undefined {
  if (!phase || allowsWriteTools(phase)) return undefined;
  if (!isWriteTool(toolName)) return undefined;
  const waiting = phase === 'awaiting-approval';
  return `协作规则：这条需求${waiting ? '的方案还在等甲方确认' : '还没定下双方都同意的方案'}，现在**不许改文件 / 执行命令**`
    + `（${toolName} 被拦下）。`
    + '这是**流程约束**，不是权限不足、不是工具坏了 —— 写工具还在你手里，等方案确认后就会放行；'
    + '所以不要索取授权，不要说「本轮没有写文件能力」，也不要当成故障汇报。'
    + (waiting
      ? '现在只做两件事：等甲方确认；需要队友补充事实就用 team_sync action=ask。'
        + '如果甲方**已经**说过「确认 / 开工 / 按已确认的做」，那是阶段没同步 —— 请甲方在群里再发一句'
        + '「确认，开始做」，这一句会立刻解除限制（宿主认这句话，不靠模型判断）。'
      : '现在只做两件事：和队友把事实对齐，用 team_sync action=result 发出**一份**双方都同意的方案，'
        + '并写明「方案待甲方确认」。'
        + '如果甲方**已经**发过开工令（例如「不再谈方案，按已确认的动手」），请让他在群里补一句'
        + '「确认，开始做」——宿主认这句，会立刻放行写操作。');
}

/**
 * 这一轮究竟按哪个阶段约束写操作。
 *
 * 为什么要「在轮次内部再算一次」而不是只信调用方传进来的值：
 * 续跑（继续执行 / 重试 / 编辑后重发）都是另起的 `send()`，它们**没有**调用方的
 * `syncPlanGate`；只信入参等于给这些入口留了一个「绕过阶段约束写文件」的后门。
 * 所以：调用方给了就用它；没给但这一轮是团队轮次 → 用当前需求的阶段。
 */
export function resolvePlanGate(input: {
  /** 调用方显式传进来的阶段（对端需求 / 群消息 / 队友消息都会传）。 */
  fromCaller?: TeamPhase;
  /** 当前需求的阶段（`LanSyncService.activePhase()`）。 */
  activePhase?: TeamPhase;
  /** 这一轮是不是团队轮次（来自群 / 对端，或跑在团队任务对话里）。 */
  teamRun: boolean;
}): TeamPhase | undefined {
  if (input.fromCaller) return input.fromCaller;
  if (!input.teamRun) return undefined;
  return input.activePhase;
}

/**
 * 这一轮是否**只读**（连写都不该试）。
 *
 * 现在只剩一种情况：两台当前选的项目不一致 —— 那不是「流程还没到」，是**写错地方**，
 * 所以照样把写工具收走（`SYNC_READ_ONLY_PLAYBOOK`）。阶段推进不再收权限。
 */
export function resolveSyncReadOnly(input: { phase?: TeamPhase; projectMismatch?: boolean }): boolean {
  return Boolean(input.projectMismatch);
}

/** 谈判阶段必须写进提示词的那段规则（直接拼在协议提示词里）。 */
export const NEGOTIATION_PROMPT = [
  '## 这一轮是「只读谈判」阶段（甲方定的规矩，不能跳）',
  '',
  '甲方要求：**先把方案谈好再动手**——「让他们先沟通，只读取各自设备上的文件，不修改，',
  '沟通好了必须出一份各自都同意且认为可行的方案给用户，用户确认了再动手修改文件。」',
  '',
  '所以这一轮你：',
  '1. **只读**：可以读代码、跑只读命令、查日志，用来搞清事实；',
  '   **绝不修改任何文件、绝不执行会改变状态的命令**（写工具还在你手里，但现在会被协作规则拦下）。',
  '2. **先和队友对齐事实**：需要队友那端的信息就用 `team_sync action=ask` 问，',
  '   拿到回答再下结论；队友说的话要当作事实核对过再用。',
  '3. **只出一份方案**：双方都同意、都认为可行的那一份，写清：',
  '   要做哪几件事、各在哪一端做、先后顺序、风险与回滚、怎么验收。',
  '4. 用 `team_sync action=result` 把这份方案发到群里，并在正文最后单独一行写：',
  '   `方案待甲方确认：确认后我再开始改文件。`',
  '5. 甲方确认之前，**不要开始改**；如果甲方提了修改意见，回到第 1 步重新对齐。',
  '',
  '**关于工具**：写文件 / 执行命令的工具**仍然在你手里**（权限没有被收走），这一轮只是',
  '**不许用** —— 没定下统一方案就改文件，就是甲方最烦的那种「先做再说」。',
  '所以不要索取授权、不要说「本轮没有写文件能力」、也不要停下来汇报这件事：',
  '按只读流程把方案谈出来，方案确认后程序会自动放行写操作。',
  '',
].join('\n');

/** 甲方确认方案之后、真正动手那一轮的开场规则。 */
export const APPROVED_PROMPT = [
  '## 甲方已确认方案：现在开始执行',
  '',
  '甲方在群里确认了你们谈定的方案。这一轮可以改文件了，但：',
  '1. **严格按已确认的方案做**，不要顺手改方案外的东西；',
  '2. 方案里写的是「两端各自做什么」，只做你这一端的部分；',
  '3. 中途发现方案不可行，**立刻停下**，在群里说清哪里不成立、建议怎么改，等甲方再定；',
  '4. 收尾时逐条对方案给证据（改了哪些文件、怎么验证的）。',
  '',
].join('\n');

/** 甲方是不是在**确认方案**。 */
const APPROVE_PATTERNS: readonly RegExp[] = [
  /^(?:同意|确认|批准|可以|行|好|好的|没问题|就这么办|按方案做|按这个方案做|照做|开始吧|开工|开工吧)[。！!，,\s]*$/,
  /(?:确认|同意|批准)(?:这个|这份|该)?方案/,
  /按(?:这个|这份|上述)?方案(?:开始)?(?:做|改|执行|实施|动手)/,
  /(?:方案)?(?:没)?问题[，,]?\s*(?:可以|开始|动手|照做)/,
  /^(?:ok|okay|go|approve|approved|lgtm)[.!\s]*$/i,
  /(?:yes|confirm|approved|go ahead|proceed)[.!\s]*$/i,
];
/**
 * 「已经确认过」+「去做」同时出现 → 就是批准，**不看句子长度**。
 *
 * 用户实况（2026-11-26）：甲方在群里说的是
 * 「不再谈方案，macOS 这台按已确认的内容动手开工」——意思非常明确，
 * 但旧判据要求句子 ≤40 字且必须出现「按…方案…动手」，于是**没认出来**：
 * 阶段停在「沟通中」，写文件的闸一直关着，两台 agent 只能继续互相解释。
 * 那是「聊了一整天、项目没动」的直接原因之一。
 */
const APPROVE_CONFIRMED_IMPERATIVE: readonly RegExp[] = [
  /(?:已确认|确认过|确认了|就按|不用再谈|不再谈|别谈了|已定|定稿)/,
];
const APPROVE_IMPERATIVE: readonly RegExp[] = [
  /(?:动手|开工|开始做|开始改|开始执行|去做|去改|照做|执行吧)/,
];

/** 甲方是不是在**否决 / 要求改方案**。 */
const REJECT_PATTERNS: readonly RegExp[] = [
  /不(?:同意|确认|批准)/,
  /(?:方案)?(?:不行|不可以|不同意|重来|再改|改一下|有问题)/,
  /先(?:别|不要)(?:做|改|动手)/,
];

/**
 * 这句话是不是在确认方案。
 *
 * 宁可漏判也不要错判：错判会把「改一下第 2 步」当成批准，agent 就带着半成品方案动手了。
 * 所以只认明确的短句，或者「已确认 + 去做」这种不含歧义的组合（见
 * `APPROVE_CONFIRMED_IMPERATIVE`；这一档不看句子长度 —— 甲方写长句很常见）。
 */
export function looksLikePlanApproval(text: string): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  if (looksLikePlanRejection(value)) return false;
  /*
   * 「已确认 / 就按 / 不用再谈」+「动手 / 开工 / 开始做」同时出现 = 批准。
   * 不设长度上限：甲方的指令经常是一整段（2026-11-26 的实况就是一整段带分工的指令）。
   */
  if (APPROVE_CONFIRMED_IMPERATIVE.some((pattern) => pattern.test(value))
    && APPROVE_IMPERATIVE.some((pattern) => pattern.test(value))) {
    return true;
  }
  if (value.length > 40) return false;
  return APPROVE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * 「已确认 + 去做」这种**强**批准（不看长度）。
 *
 * 用途：阶段停在「沟通中」时，用这条判断甲方是不是已经下了开工令 ——
 * 短句「确认」仍然要求群里确实有方案，但一整段指令不会再被长度限制吞掉。
 */
export function looksLikeExplicitGoAhead(text: string): boolean {
  const value = (text ?? '').trim();
  if (!value || looksLikePlanRejection(value)) return false;
  return APPROVE_CONFIRMED_IMPERATIVE.some((pattern) => pattern.test(value))
    && APPROVE_IMPERATIVE.some((pattern) => pattern.test(value));
}

/** 这句话是不是在否决 / 要求改方案（这时必须回到谈判阶段）。 */
export function looksLikePlanRejection(text: string): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  return REJECT_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * 阶段的中文说法（群窗口 / 手机 / 日志共用）。
 *
 * `negotiate` 不用「只读」：权限没有被收走，被约束的是「没谈定不许动手」这个动作。
 */
export function teamPhaseLabel(phase: TeamPhase): string {
  if (phase === 'negotiate') return '沟通中（不动手）';
  if (phase === 'awaiting-approval') return '方案待确认';
  return '已确认，执行中';
}

/**
 * 这一轮收尾该怎么写。
 *
 * 谈判阶段**不许**自称「结果」：它交出来的是一份**待确认的方案**，
 * 所以阶段直接落到 `awaiting-approval`（等甲方一句话）。
 *
 * `autonomous`（用户 2026-11-26 追加的「自主迭代模式」）：「agent 相互沟通好、都确认没问题，
 * 不需要用户确认，然后开始执行，适合自主迭代项目」。这时谈完直接进入执行 ——
 * 但**谈判阶段照样只读**，只有真正谈成才放开写工具。
 */
export function nextPhaseAfterRun(input: {
  phase: TeamPhase;
  done: boolean;
  pendingPeerAsks: number;
  /** 自主迭代模式：谈定就开工，不等甲方确认。 */
  autonomous?: boolean;
}): TeamPhase {
  if (input.phase === 'implement') return 'implement';
  /* 还没跑完 / 还在等队友回话：继续谈，别催甲方确认一份还没谈完的方案。 */
  if (!input.done || input.pendingPeerAsks > 0) return 'negotiate';
  return input.autonomous ? 'implement' : 'awaiting-approval';
}

/** 自主迭代模式写进提示词的那一段。 */
export const AUTONOMY_PROMPT = [
  '## 自主迭代模式已开启',
  '',
  '甲方开启了「自主迭代」：**你们自己谈定就开工，不需要等甲方确认**。但要求更严：',
  '1. 仍然**先谈**（只读）：写工具在你手里，但没谈定之前会被协作规则拦下，别硬试；',
  '2. 必须真的等到队友回话、并且对方明确表示可以按这个做法做；',
  '3. 只有「双方都同意」时才进入执行；有一方提出异议就继续谈，别硬推；',
  '4. 开工后严格按谈定的方案做，发现方案不成立就停下来重新对齐；',
  '5. 收尾要在群里说清：做了什么、验证了什么、下一步建议。',
  '',
].join('\n');
