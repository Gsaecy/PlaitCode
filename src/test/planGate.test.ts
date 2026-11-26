import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { shouldAutoRespond } from '../sync/lanProtocol';
import { requirementPromptForLocal } from '../sync/lanProtocol';
import type { SyncPeer } from '../sync/lanProtocol';
import {
  allowsWriteTools,
  initialTeamPhase,
  looksLikePlanApproval,
  looksLikePlanRejection,
  nextPhaseAfterRun,
  planGateBlockReason,
  resolvePlanGate,
  resolveSyncReadOnly,
  teamPhaseLabel,
} from '../sync/planGate';

/**
 * 用户 2026-11-26（原话）：
 *
 * 「协作还有个大问题，agent 做事很莽撞，让他们沟通再做，他们会先做然后都在运行中导致不沟通。
 *  我希望他们先沟通，只读取各自设备上的文件，不修改，沟通好了必须出一份各自都同意且认为
 *  可行的方案给用户，用户确认了再动手修改文件。」
 *
 * 所以「先谈后做」必须是**代码级闸门**（工具清单里没有写能力），不能只靠提示词。
 */

const me: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 'test' };

/** 组提示词用的最小需求对象。 */
const requirementForGate = { id: 'r-2', from: me, title: '两端同步', detail: '看代码', createdAt: 1, project: 'app' };

test('阶段只约束**动作**，不收权限：写工具始终在，谈定之前调用会被拦', () => {
  assert.equal(initialTeamPhase(), 'negotiate');
  assert.equal(allowsWriteTools('negotiate'), false);
  assert.equal(allowsWriteTools('awaiting-approval'), false, '方案发出去了也不能自己动手');
  assert.equal(allowsWriteTools('implement'), true);

  // 用户 2026-11-26：「不要收权限，而是约束它们…没有统一方案不开工修改文件」。
  // 所以阶段不再让 `resolveSyncReadOnly` 收走工具清单 —— 只剩「两台项目不一致」这一档收。
  assert.equal(resolveSyncReadOnly({ phase: 'negotiate' }), false);
  assert.equal(resolveSyncReadOnly({ phase: 'awaiting-approval' }), false);
  assert.equal(resolveSyncReadOnly({ phase: 'implement' }), false);
  assert.equal(resolveSyncReadOnly({ phase: 'implement', projectMismatch: true }), true);

  // 拦的是具体动作：写 / 改 / 删 / 执行命令拦，读放行。
  for (const name of ['write_file', 'replace_in_file', 'delete_file', 'run_command']) {
    assert.ok(planGateBlockReason(name, 'negotiate'), `${name} 在谈判阶段必须拦`);
  }
  assert.equal(planGateBlockReason('read_file', 'negotiate'), undefined, '读工具必须放行');
  assert.equal(planGateBlockReason('team_sync', 'negotiate'), undefined, '沟通不是写操作');
  assert.equal(planGateBlockReason('write_file', 'implement'), undefined, '确认之后放行');
  assert.equal(planGateBlockReason('write_file', undefined), undefined, '非协作轮次不受影响');
});

test('谈完才落到「等确认」；没谈完 / 还在等队友就继续谈', () => {
  assert.equal(nextPhaseAfterRun({ phase: 'negotiate', done: true, pendingPeerAsks: 0 }), 'awaiting-approval');
  assert.equal(nextPhaseAfterRun({ phase: 'negotiate', done: true, pendingPeerAsks: 1 }), 'negotiate', '队友还没回话，别催甲方');
  assert.equal(nextPhaseAfterRun({ phase: 'negotiate', done: false, pendingPeerAsks: 0 }), 'negotiate');
  assert.equal(nextPhaseAfterRun({ phase: 'implement', done: true, pendingPeerAsks: 0 }), 'implement', '执行阶段不需要再谈');
});

test('确认 / 否决的判定：只认明确的话，宁可漏判也不错判', () => {
  for (const text of ['确认', '同意', '确认，按方案做', '按这个方案做', '可以', '开工吧', 'LGTM', 'go ahead']) {
    assert.equal(looksLikePlanApproval(text), true, `应当算确认：${text}`);
  }
  for (const text of ['不同意', '先别动手', '方案不行，重来', '第 2 步改一下', '为什么这么做？', '确认一下这个字段叫什么']) {
    assert.equal(looksLikePlanApproval(text), false, `不该算确认：${text}`);
  }
  assert.equal(looksLikePlanRejection('不同意'), true);
  assert.equal(looksLikePlanRejection('先别动手'), true);
  assert.equal(looksLikePlanRejection('确认'), false);
});

test('阶段说法：三个状态各有中文标签（界面直接用）', () => {
  assert.match(teamPhaseLabel('negotiate'), /不动手/, '不是「只读」：权限没收，约束的是动作');
  assert.match(teamPhaseLabel('awaiting-approval'), /确认/);
  assert.match(teamPhaseLabel('implement'), /执行/);
});

test('服务层：阶段默认只读，确认后进入执行，否决后退回谈判', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-gate-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    runRequirement: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  try {
    const shared = await service.shareRequirement('让两端数据能同步', undefined, []);
    assert.ok(shared.requirement);
    const id = shared.requirement.id;

    // 新需求：谈。阶段只约束动作，不收权限。
    assert.equal(service.phaseOf(id), 'negotiate');
    assert.equal(allowsWriteTools(service.phaseOf(id)), false);
    assert.ok(planGateBlockReason('write_file', service.phaseOf(id)));

    // 还没出方案时，一句「确认」不该解锁任何东西。
    assert.equal(service.applyPlanDecision('确认'), undefined, '没有待确认的方案就不该被这句话影响');

    // 方案谈完 → 等确认。
    service.setPhase(id, 'awaiting-approval');
    assert.equal(service.phaseOf(id), 'awaiting-approval');

    // 甲方说「改一下」→ 退回谈判（继续禁止动手）。
    assert.deepEqual(service.applyPlanDecision('不同意，第 2 步改一下'), { requirementId: id, phase: 'negotiate' });
    assert.equal(service.phaseOf(id), 'negotiate');
    assert.ok(planGateBlockReason('write_file', service.phaseOf(id)));

    // 再谈完 → 甲方确认 → 进入执行，写操作才放行。
    service.setPhase(id, 'awaiting-approval');
    assert.deepEqual(service.applyPlanDecision('确认，按方案做'), { requirementId: id, phase: 'implement' });
    assert.equal(service.phaseOf(id), 'implement');
    assert.equal(planGateBlockReason('write_file', service.phaseOf(id)), undefined);

    // 阶段也要给到界面（群窗口 / 手机顶部都要显示）。
    assert.equal(service.groupState().phase, 'implement');
    assert.equal(service.mobileState().phase, 'implement');
    assert.match(String(service.mobileState().phaseLabel), /执行/);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 谈判阶段的两个提示词必须在（模型要知道「为什么没有写工具」）。
 *
 * 只关工具不解释，agent 会在群里抱怨「本轮没给我写文件能力」——那正是 2026-11-25 的现场。
 */
test('自主迭代模式：谈成即开工（不再等甲方确认），但谈判阶段照样只读', () => {
  /* 用户 2026-11-26：「增加一个自主迭代模式…agent 相互沟通好都确认没问题不需要用户确认，然后开始执行」。 */
  assert.equal(
    nextPhaseAfterRun({ phase: 'negotiate', done: true, pendingPeerAsks: 0, autonomous: true }),
    'implement',
    '谈成即开工',
  );
  assert.equal(
    nextPhaseAfterRun({ phase: 'negotiate', done: true, pendingPeerAsks: 2, autonomous: true }),
    'negotiate',
    '还有队友没回话就不算谈成，自主迭代也不许抢跑',
  );
  assert.equal(
    nextPhaseAfterRun({ phase: 'negotiate', done: false, pendingPeerAsks: 0, autonomous: true }),
    'negotiate',
    '这一轮没跑完也不能开工',
  );
  // 谈判阶段同样不许动手 —— 但收的是动作，不是权限。
  assert.equal(allowsWriteTools('negotiate'), false);
  assert.ok(planGateBlockReason('write_file', 'negotiate'));
});

test('谈判 / 执行两段提示词都写清「这一轮能做什么」', async () => {
  const { requirementPromptForLocal } = await import('../sync/lanProtocol.js');
  const requirement = {
    id: 'r-1',
    from: me,
    title: '两端同步',
    detail: '让两台看到同一份数据',
    createdAt: 1,
    project: 'app',
  };
  const negotiate = requirementPromptForLocal(requirement as never, me, [], { planPhase: 'negotiate' });
  assert.match(negotiate, /只读谈判/, '要说清这一轮是谈判');
  assert.match(negotiate, /绝不修改任何文件/, '要明确禁止修改');
  assert.match(negotiate, /方案待甲方确认/, '要要求把方案发出来等确认');

  const implement = requirementPromptForLocal(requirement as never, me, [], { planPhase: 'implement' });
  assert.match(implement, /甲方已确认方案/, '执行阶段要说明已获确认');
  assert.match(implement, /严格按已确认的方案做/);

  const autonomous = requirementPromptForLocal(requirement as never, me, [], {
    planPhase: 'negotiate',
    autonomous: true,
  });
  assert.match(autonomous, /自主迭代模式已开启/, '自主迭代要告诉 agent 不用等甲方');
  assert.match(autonomous, /双方都同意/, '但「必须真的谈成」不能放松');
});

/**
 * 用户 2026-11-26：
 *
 * 「它会发现没有写工具（甚至会说明「本轮没有写文件能力」），为什么要把风险留给我，不提前处理掉？」
 * 「不要收权限，而是约束它们在涉及需要配合的工作时候，没有统一方案不开工修改文件。」
 *
 * 所以谈判阶段**不抽工具**，只拦动作，并且拦下时一次说清原因。
 */
test('谈判阶段不缺权限：拦的是动作，且文案说明「不是权限不足、别索权」', async () => {
  const negotiation = requirementPromptForLocal(requirementForGate as never, me, [], { planPhase: 'negotiate' });
  assert.match(negotiation, /写工具还在你手里/, '要让 agent 知道权限没被收走');
  assert.match(negotiation, /不许用/, '约束的是动作');

  const negotiate = planGateBlockReason('write_file', 'negotiate');
  assert.ok(negotiate);
  assert.match(negotiate, /流程约束/, '要说清这是流程');
  assert.match(negotiate, /不是权限不足/, '要提前否认「权限坏了」');
  assert.match(negotiate, /写工具还在你手里/, '工具没被收走，别让它以为没有能力');
  assert.match(negotiate, /不要索取授权/);
  assert.match(negotiate, /没有写文件能力/, '要明确禁止把它当故障汇报');
  assert.match(negotiate, /方案待甲方确认/, '要告诉它现在该干什么');

  const waiting = planGateBlockReason('run_command', 'awaiting-approval');
  assert.ok(waiting);
  assert.match(waiting, /等甲方确认/, '等确认阶段要它别动手、等甲方');

  // 只读档（两台项目不一致）仍然收工具 —— 那不是流程，是写错地方。
  const project = requirementPromptForLocal(requirementForGate as never, me, [], { readOnly: true });
  assert.match(project, /不是同一个/, '项目不一致这一档要说明原因');
  assert.match(project, /切到需求所属项目/, '并给出真正的解锁办法');
});

test('拦在调用那一刻：面板在执行工具前先过阶段判定，且不收窄工具清单', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  const guard = panel.indexOf('planGateBlockReason(call.function.name');
  assert.ok(guard > 0, '写操作必须经阶段判定');
  assert.ok(
    guard < panel.indexOf('blockedToolReason(call.function.name'),
    '阶段判定要在工具真正执行之前（而且是第一道）',
  );
  assert.match(panel, /syncPlanGate: phase/, '阶段要随这一轮传下去');
  assert.match(panel, /planGateBlockReason\(call\.function\.name, planGate\)/, '拦的是内部算出来的阶段（续跑也不放过）');
  assert.doesNotMatch(
    panel,
    /options\?\.syncReadOnly \|\| [^\n]*allowsWriteTools/,
    '阶段不许再拿收窄工具清单当闸门',
  );
});

test('群里的活与队友消息同样受阶段约束（不是只拦对端需求）', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  // 群里直接说的话、队友发来的消息，都要带上当前需求的阶段。
  const wired = panel.match(/syncPlanGate: active\.phase/g) ?? [];
  assert.equal(wired.length, 2, '群消息与队友消息都要带阶段');
  assert.match(panel, /activePhase\(\)/);
});

/**
 * 走到**真实的 agent 循环**里验证一次（不是只测纯函数）：
 * 谈判阶段模型伸手写文件 → 工具根本不会被执行，模型收到的是「流程约束」那句话。
 *
 * 这里用的是面板里同一套组合：`planGateBlockReason()` 决定拦不拦，
 * 拦下来就把这段话当成工具结果回给模型（面板里多一层 `tt()` 摘要，不影响判定）。
 * `implement` 阶段同样的调用必须真的落到工具执行器 —— 否则「确认后就能动手」也是假的。
 */
test('真实 agent 循环：谈判阶段写工具不执行，确认后才执行', async () => {
  const { AgentRunner } = await import('../agent/agentRunner.js');
  const settings = {
    internetReference: false,
    apiProfiles: [{ id: 'default', name: 'Test', baseUrl: 'https://example.invalid', models: ['deepseek-chat'], requestHeaders: {} }],
    activeApiProfileId: 'default',
    baseUrl: 'https://example.invalid', model: 'deepseek-chat', temperature: 0, maxTokens: 0,
    systemPrompt: '', sendOnEnter: true, historyRetentionDays: 30, taskCacheRetentionHours: 24,
    cacheBudgetMB: 100, cleanupIntervalMinutes: 10, maxMessagesInContext: 20, requestHeaders: {},
    requestTimeoutSeconds: 30, proxy: '', defaultMode: 'agent', agentMaxSteps: 4, reasoningEffort: 'default',
    permissionPreset: 'review', fileReadPolicy: 'allow', fileWritePolicy: 'ask', commandPolicy: 'ask',
    dangerousCommandPolicy: 'ask', sensitiveFilePolicy: 'deny', maxReadBytes: 512_000, maxToolOutputBytes: 200_000,
    maxCommandSeconds: 120, auditRetentionDays: 30, language: 'auto',
  };

  const runOnce = async (phase: 'negotiate' | 'implement') => {
    let round = 0;
    const toolMessages: string[] = [];
    const client = {
      async streamChat(_settings: unknown, messages: Array<{ role: string; content: unknown }>) {
        round += 1;
        if (round === 1) {
          return {
            content: '', reasoning: '', usage: undefined, finishReason: 'tool_calls',
            toolCalls: [{
              id: 'call_write', type: 'function' as const,
              function: { name: 'write_file', arguments: '{"path":"src/a.ts","content":"x"}' },
            }],
          };
        }
        const last = messages.at(-1);
        if (last?.role === 'tool') toolMessages.push(String(last.content ?? ''));
        return { content: '好了。', reasoning: '', usage: undefined, finishReason: 'stop', toolCalls: [] };
      },
    };
    let executed = 0;
    const tools = {
      definitions: () => [{ type: 'function' as const, function: { name: 'write_file', description: 'write', parameters: {} } }],
      execute: async () => {
        executed += 1;
        return { status: 'success' as const, summary: '写入', content: 'ok', approval: 'approved' as const };
      },
    };
    const runner = new AgentRunner(client as never, tools as never);
    await runner.run({
      settings: settings as never,
      messages: [{ role: 'user', content: '改一下' }],
      mode: 'agent',
      signal: new AbortController().signal,
      conversationId: `conversation-${phase}`,
      callbacks: { onDelta: () => undefined, onToolsChanged: () => undefined, requestApproval: async () => true },
      // 与面板里 `executeExtraTool` 同一套组合。
      executeExtraTool: async (call: { function: { name: string } }) => {
        const denied = planGateBlockReason(call.function.name, phase);
        if (!denied) return undefined;
        return {
          result: {
            status: 'denied' as const,
            summary: '方案还没定，先别改文件',
            content: denied,
            approval: 'not-required' as const,
          },
        };
      },
    });
    return { executed, toolMessages };
  };

  const negotiating = await runOnce('negotiate');
  assert.equal(negotiating.executed, 0, '谈判阶段写文件必须真的没发生');
  assert.ok(negotiating.toolMessages.some((text) => /流程约束/.test(text)), '模型要被明确告知原因');
  assert.ok(negotiating.toolMessages.some((text) => /写工具还在你手里/.test(text)), '不能说成权限问题');

  const approved = await runOnce('implement');
  assert.equal(approved.executed, 1, '确认之后同一个调用必须真的执行');
});

/**
 * 复查发现的**两个真实缺口**（不是靠读代码，是靠跑服务验出来的）：
 *
 * 1. 阶段只在内存里 → 重载窗口 / 重启 VS Code 就退回「谈」，甲方确认过的需求又不动手；
 * 2. 阶段不跟着消息过网 → 甲方在哪台点「确认」，另一台永远停在「沟通中」，看着就像确认没用。
 */
test('阶段要落盘：重建服务后仍然记得「甲方确认过」', async () => {
  const { LanSyncService } = await import('../sync/lanSync.js');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-phase-'));
  const path = join(dir, 'state.json');
  const peer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32' as const, project: 'app', version: 'test' };
  const make = () => new LanSyncService(path, {
    peer: () => peer,
    runRequirement: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  const first = make();
  await first.load();
  try {
    const shared = await first.shareRequirement('改一个文件', undefined, []);
    const id = shared.requirement!.id;
    assert.equal(first.phaseOf(id), 'negotiate');
    first.setPhase(id, 'implement');
    // `setPhase` 里是后台落盘：等它写完再模拟重载。
    await new Promise((resolve) => setTimeout(resolve, 60));

    const reloaded = make();
    await reloaded.load();
    try {
      assert.equal(reloaded.phaseOf(id), 'implement', '重载后必须还是「已确认」，否则确认看起来没生效');
      assert.equal(planGateBlockReason('write_file', reloaded.activePhase()?.phase), undefined, '并且写操作要放行');
    } finally {
      reloaded.dispose();
    }
  } finally {
    first.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('阶段随群消息过网：对端收到确认后也能放开写操作', async () => {
  const { parseSyncMessage, makeGroupMessage } = await import('../sync/lanProtocol.js');
  const wire = {
    kind: 'group',
    id: 'g-1',
    from: { id: 'p-mac', name: 'Mac mini', platform: 'darwin', project: 'app', version: 'test' },
    author: 'agent',
    phase: 'confirm',
    body: '收到，按方案开始执行。',
    requirementId: 'req-1',
    at: 1,
    meta: { planPhase: 'implement' },
  };
  const parsed = parseSyncMessage(JSON.stringify(wire));
  assert.ok(parsed && parsed.kind === 'group');
  assert.equal(parsed.meta?.planPhase, 'implement', '阶段不能在过网时被丢掉（丢了就成了假实现）');

  // 不认识的阶段名不许塞进来当真相。
  const bogus = parseSyncMessage(JSON.stringify({ ...wire, meta: { planPhase: 'whatever' } }));
  assert.equal(bogus && bogus.kind === 'group' ? bogus.meta?.planPhase : 'x', undefined);

  /*
   * 光能解析还不够：**真的投递一遍给服务**，看对面那台的阶段有没有跟着变。
   * 这才是「甲方在哪台确认，两台都放行」的验证。
   */
  const { LanSyncService } = await import('../sync/lanSync.js');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-phase-wire-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    runRequirement: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  try {
    const shared = await service.shareRequirement('改一个文件', undefined, []);
    const id = shared.requirement!.id;
    assert.equal(service.phaseOf(id), 'negotiate');
    const remote = { id: 'p-mac', name: 'Mac mini', platform: 'darwin' as const, project: 'app', version: 'test' };
    const confirm = makeGroupMessage(remote, {
      author: 'agent',
      phase: 'confirm',
      body: '收到，按方案开始执行。',
      requirementId: id,
      meta: { planPhase: 'implement' },
    });
    assert.ok(confirm);
    await service.ingestRelayMessage(confirm);
    assert.equal(service.phaseOf(id), 'implement', '收到对端的确认必须同样放开写操作');
    assert.equal(planGateBlockReason('write_file', service.phaseOf(id)), undefined);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('阶段卡在「谈」时，甲方一句「确认」也能解锁（群里确实有方案才认）', async () => {
  const { LanSyncService } = await import('../sync/lanSync.js');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-approve-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    runRequirement: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  try {
    const shared = await service.shareRequirement('改一个文件', undefined, []);
    const id = shared.requirement!.id;

    // 群里**没有**方案 → 一句「确认」不该解锁任何东西。
    assert.equal(service.applyPlanDecision('确认'), undefined, '没有方案时不能被这句话解锁');
    assert.equal(service.phaseOf(id), 'negotiate');

    // 方案发出来了（阶段推进那一步万一没跑到，也要认）→ 确认就必须生效。
    await service.postGroup({
      author: 'agent',
      phase: 'result',
      body: '方案：改 A → 改 B。\n方案待甲方确认：确认后我再开始改文件。',
      requirementId: id,
    });
    assert.equal(service.phaseOf(id), 'negotiate', '发方案本身不该偷偷改阶段');
    assert.deepEqual(service.applyPlanDecision('确认，按方案做'), { requirementId: id, phase: 'implement' });
    assert.equal(planGateBlockReason('write_file', service.phaseOf(id)), undefined, '确认之后写操作要放行');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('续跑不放过闸门：没有调用方阶段时，按当前需求的阶段兜底', () => {
  // 对端需求 / 群消息 / 队友消息 → 调用方显式给阶段。
  assert.equal(resolvePlanGate({ fromCaller: 'implement', activePhase: 'negotiate', teamRun: true }), 'implement');
  assert.equal(resolvePlanGate({ fromCaller: 'negotiate', teamRun: true }), 'negotiate');
  // 续跑（继续执行 / 重试 / 编辑后重发）没有调用方阶段 → 用当前需求的阶段。
  assert.equal(resolvePlanGate({ activePhase: 'awaiting-approval', teamRun: true }), 'awaiting-approval');
  // 普通对话不受影响。
  assert.equal(resolvePlanGate({ activePhase: 'negotiate', teamRun: false }), undefined);
  assert.equal(resolvePlanGate({ teamRun: true }), undefined, '还没有任何需求时不拦');
});

test('模型真的伸手写时，只读档的拒绝文案不能是半个句子', async () => {
  const { blockedToolReason, SYNC_READ_ONLY_PLAYBOOK } = await import('../agent/toolPlaybooks.js');
  const reason = blockedToolReason('write_file', [SYNC_READ_ONLY_PLAYBOOK], true);
  assert.ok(reason);
  assert.match(reason, /不是权限不足/);
  assert.match(reason, /没有写文件能力/, '要明确禁止把它当故障汇报');
  assert.doesNotMatch(reason, /请改用\s*。/, '只读档 preferred 为空，不能拼出半截话');
});
