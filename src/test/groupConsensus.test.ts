import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { makeNote, answerPromptForLocal, requirementPromptForLocal, TEAM_GROUP_PROMPT, type SyncNote, type SyncPeer } from '../sync/lanProtocol';
import { outcomePhaseFor } from '../sync/groupIntent';
import { runTeamSync } from '../sync/lanTool';
import { planOutcomePost } from '../sync/outcomePlan';

/**
 * 用户实况（2026-11-25）：「每次我要求群里的 agent 互相沟通、达成一致的方案的时候，
 * 就会有 agent 单方面读取并发出结果。我并没有看到沟通，实际上其他 agent 还没有执行完。」
 *
 * 三件事必须都在**代码**里成立，不能只靠提示词：
 *   1. `ask` 真的等回答（有上限），并把回答交回模型；
 *   2. 问题没被回答时，收尾**不许自称结果**（降级成进度）；
 *   3. 对方回话时，问问题的那台会被叫醒去合并结论。
 */

const win: SyncPeer = { id: 'p-win', name: 'MagicBookV14', platform: 'win32', project: 'app', version: 't' };
const mac: SyncPeer = { id: 'p-mac', name: 'MacBook-Pro', platform: 'darwin', project: 'app', version: 't' };

test('收尾阶段：没跑完=问，跑完但还在等队友=进度，真正一致了才是结果', () => {
  assert.equal(outcomePhaseFor(false, 0), 'question');
  assert.equal(outcomePhaseFor(false, 2), 'question', '没跑完不管等不等人，都不是结果');
  assert.equal(outcomePhaseFor(true, 1), 'progress', '还在等队友回话时不能自称结果');
  assert.equal(outcomePhaseFor(true, 0), 'result');
});

interface FakeService {
  shareNote: (input: { body: string; topic?: string; replyTo?: string }) => Promise<{ ok: boolean; message: string; note?: SyncNote; delivered: boolean }>;
  waitForReply: (noteId: string, timeoutMs: number) => Promise<SyncNote[]>;
  noteAskSent: (note: SyncNote, requirementId: string, delivered?: boolean) => void;
  pendingAskPeers: (noteId: string) => string[];
  groupState: () => { peers: SyncPeer[] };
  state: () => { text: string };
  recentNotes: () => SyncNote[];
  requirementTitles: () => string[];
}

function fakeService(reply: SyncNote | undefined): {
  service: FakeService;
  asked: { note: SyncNote; requirementId: string }[];
  waits: { noteId: string; timeoutMs: number }[];
} {
  const asked: { note: SyncNote; requirementId: string }[] = [];
  const waits: { noteId: string; timeoutMs: number }[] = [];
  const service: FakeService = {
    // 回显输入：`send` / `ask` 的记账判据取决于正文本身，假服务不能写死一句话。
    shareNote: async (input) => ({
      ok: true,
      message: '已发给对端。',
      note: makeNote(win, { body: input.body, ...(input.topic ? { topic: input.topic } : {}) }, 1) as SyncNote,
      delivered: true,
    }),
    waitForReply: async (noteId, timeoutMs) => {
      waits.push({ noteId, timeoutMs });
      return reply ? [reply] : [];
    },
    noteAskSent: (note, requirementId) => { asked.push({ note, requirementId }); },
    pendingAskPeers: () => (reply ? [] : ['macOS · MacBook-Pro']),
    groupState: () => ({ peers: [win, mac] }),
    state: () => ({ text: '已连接' }),
    recentNotes: () => [],
    requirementTitles: () => [],
  };
  return { service, asked, waits };
}

test('ask 真的等回答：把队友的原话交回模型，并要求合并后再发结果', async () => {
  const reply = makeNote(mac, { body: '素材在 Resources/audio，别动 themes。', topic: 'sync' }, 2) as SyncNote;
  const { service, asked, waits } = fakeService(reply);

  const outcome = await runTeamSync(service as unknown as LanSyncService, {
    action: 'ask',
    message: '你那端的素材目录是哪个？',
    topic: 'sync',
  }, { requirementId: 'r1' });

  assert.equal(asked.length, 1, '要把「我在等这条回答」记下来');
  assert.equal(asked[0]!.requirementId, 'r1', '提问要挂在当前需求上，收尾才判得出能不能算结果');
  assert.equal(waits.length, 1, '发完提问必须等回答');
  assert.equal(waits[0]!.noteId, asked[0]!.note.id, '等的是刚发出去的那条');
  assert.match(outcome.content, /Resources\/audio/, '队友的回答要真的进到模型上下文');
  assert.match(outcome.content, /没谈拢|不一致/, '要给出「谈不拢怎么办」的判据');
  assert.match(outcome.summary, /已回答|已全部回答/);
});

test('ask 超时：明确说「队友还没回话」，禁止把这一轮说成已达成一致', async () => {
  const { service } = fakeService(undefined);
  const outcome = await runTeamSync(service as unknown as LanSyncService, {
    action: 'ask',
    message: '你那端改了吗？',
  }, { requirementId: 'r2' });

  assert.match(outcome.content, /还没等到/);
  assert.match(outcome.content, /不要发结果/);
  assert.match(outcome.summary, /还没回话/);
});

test('send 不等回答：同步进展不该把一轮卡住', async () => {
  const { service, waits, asked } = fakeService(undefined);
  const outcome = await runTeamSync(service as unknown as LanSyncService, {
    action: 'send',
    message: '我先改窗口标题栏，你那部分别动。',
  }, { requirementId: 'r3' });

  assert.equal(waits.length, 0, 'send 是告知，不是提问');
  assert.equal(asked.length, 0);
  assert.match(outcome.content, /已发给对端/);
});

test('send 里真的在问队友：也要记账，回答没到之前不许自称一致', async () => {
  const { service, waits, asked } = fakeService(undefined);
  const outcome = await runTeamSync(service as unknown as LanSyncService, {
    action: 'send',
    message: '你那边的边距是多少？',
  }, { requirementId: 'r4' });

  assert.equal(waits.length, 0, 'send 不阻塞本轮');
  assert.equal(asked.length, 1, '但这是一句提问，必须记成「还在等回话」');
  assert.match(outcome.content, /不要发结果/);
});

async function makeService(runNote: (note: SyncNote) => Promise<boolean>): Promise<{ service: LanSyncService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-consensus-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => win,
    runRequirement: async () => true,
    runNote,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    localProjects: () => ['app'],
    localProjectRepos: () => ['github.com/acme/app'],
    log: () => undefined,
  }, { discoveryPort: 48_981 });
  await service.load();
  return { service, dir };
}

test('队友回话后：等待被唤醒、提问不再是「还在等」，并叫醒本机合并结论', async () => {
  const woken: SyncNote[] = [];
  const { service, dir } = await makeService(async (note) => { woken.push(note); return true; });
  try {
    const ask = makeNote(win, { body: '你那端的素材目录是哪个？', topic: 'sync' }, 10) as SyncNote;
    service.noteAskSent(ask, 'r1', true, [mac]);
    assert.equal(service.pendingAsksFor('r1').length, 1);

    const waiting = service.waitForReply(ask.id, 5_000);
    const reply = makeNote(mac, { body: 'Resources/audio', topic: 'sync', replyTo: ask.id }, 11) as SyncNote;
    await service.ingestRelayMessage(reply);

    const got = await waiting;
    assert.deepEqual(got.map((note) => note.id), [reply.id], '等待中的那一轮要拿到回答');
    assert.equal(service.pendingAsksFor('r1').length, 0, '回答到了就不再算「还在等」');
    assert.equal(woken.length, 0, '这一轮还活着，不必再叫醒一轮');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('没人等在提问时：回答到了要叫醒本机（否则它已经收工发过结果了）', async () => {
  const woken: SyncNote[] = [];
  const { service, dir } = await makeService(async (note) => { woken.push(note); return true; });
  try {
    const ask = makeNote(win, { body: '你那端的素材目录是哪个？', topic: 'sync' }, 10) as SyncNote;
    service.noteAskSent(ask, 'r1', true, [mac]);
    const reply = makeNote(mac, { body: 'Resources/audio', topic: 'sync', replyTo: ask.id }, 11) as SyncNote;
    await service.ingestRelayMessage(reply);

    assert.equal(service.pendingAsksFor('r1').length, 0);
    assert.deepEqual(woken.map((note) => note.id), [reply.id], '队友的回答必须把本机叫起来合并结论');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('无关进展不算回答：还在等的那个问题不能被「客气话」结算掉', async () => {
  const { service, dir } = await makeService(async () => true);
  try {
    const ask = makeNote(win, { body: '素材目录定了吗？', topic: 'assets' }, 10) as SyncNote;
    service.noteAskSent(ask, 'r1', true, [mac]);
    const chitChat = makeNote(mac, { body: '我这边在跑测试，稍等。', topic: 'tests' }, 11) as SyncNote;
    await service.ingestRelayMessage(chitChat);

    assert.equal(service.pendingAsksFor('r1').length, 1, '别的主题不该把「还在等」变假');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('三台以上：要等**每一台**回话，只回一台不算谈成', async () => {
  /*
   * 普适性：协作群不只有两台。旧实现只记「第一台」，于是第二台的回答永远
   * 被当成「还没回话」，收尾一直被降级；反过来只要第一台回话就当成已谈成。
   */
  const woken: SyncNote[] = [];
  const { service, dir } = await makeService(async (note) => { woken.push(note); return true; });
  const linux: SyncPeer = { id: 'p-linux', name: 'Linux', platform: 'linux', project: 'app', version: 't' };
  try {
    const ask = makeNote(win, { body: '各端素材目录分别是什么？', topic: 'assets' }, 10) as SyncNote;
    service.noteAskSent(ask, 'r1', true, [mac, linux]);
    assert.deepEqual(
      service.pendingAsksFor('r1').map((item) => item.toId).sort(),
      [mac.id, linux.id].sort(),
      '两台都要在等待名单里',
    );

    const first = makeNote(mac, { body: 'Resources/audio', topic: 'assets', replyTo: ask.id }, 11) as SyncNote;
    await service.ingestRelayMessage(first);
    assert.deepEqual(
      service.pendingAsksFor('r1').map((item) => item.toId),
      [linux.id],
      '只回了一台：还在等另一台，且只列出还没回的那台',
    );
    /*
     * 用户 2026-11-26：「让 agent 的消息也像用户消息一样，能被相互看见，
     * 唯一约束看不看得见的是 @某个 agent 的行为」。
     *
     * 所以第一台回话**也要交付**给本机 agent（它得看到队友说了什么）；
     * 但「谈成了没有」仍按事实算 —— 还有一台没回，`pendingAsks` 继续挂着，
     * 收尾只能发进度，不能宣布结果。
     */
    assert.deepEqual(woken.map((note) => note.id), [first.id], '第一台的回话也要让本机看见');
    assert.equal(service.pendingAsksFor('r1').length, 1, '但还不算谈成：仍等另一台');

    const second = makeNote(linux, { body: 'assets/audio', topic: 'assets', replyTo: ask.id }, 12) as SyncNote;
    await service.ingestRelayMessage(second);
    assert.deepEqual(service.pendingAsksFor('r1'), [], '都回话了才算谈成');
    assert.deepEqual(woken.map((note) => note.id), [first.id, second.id], '两台的回话都要送进本机 agent');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('甲方回答追问：后台带上下文（谁说的 / 哪条需求 / 怎么收尾），明文只有原话', () => {
  const requirement = {
    kind: 'requirement' as const,
    id: 'r-42',
    from: mac,
    title: '把四象限卡片加进卡片中心',
    detail: '把四象限卡片加进卡片中心',
    createdAt: 1,
    project: 'Personal-Workstation-OS',
  };
  const prompt = answerPromptForLocal({
    answer: '就按第二种，先做 Windows 端',
    requirement,
    askerLabel: 'Windows · MAGICBOOKV14',
    local: win,
    projectRoot: 'd:\\AI projects\\Personal-Workstation-OS',
    projectName: 'Personal-Workstation-OS',
  });

  // 后台要判断的东西：谁说的、说给谁、哪条需求、哪个项目。
  assert.match(prompt, /说话人：甲方（用户）/);
  assert.match(prompt, /这条说给：本机（Windows · MagicBookV14）/);
  assert.match(prompt, /需求号：r-42/);
  assert.match(prompt, /项目：Personal-Workstation-OS/);
  assert.match(prompt, /接着那条需求继续/);
  assert.match(prompt, /还在等队友回话，只发进度/, '收尾规则也要在');

  // 明文：甲方那句话必须原样在最后，并且整段被标成「后台上下文」。
  assert.match(prompt, /甲方这次的原话：\n就按第二种，先做 Windows 端$/);
  assert.match(prompt, /【后台上下文（不显示在群里，也不进气泡/);
});

test('chatPanel：回答追问的这条也把原话单独留给界面（不是整段提示词）', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /const userAnswer = content;/, '换正文前先存原话');
  assert.match(panel, /content = answerPromptForLocal\(\{/, '回答也要带后台上下文');
  assert.match(panel, /displayText: userAnswer,/, '界面只显示原话');
  assert.match(panel, /syncRequirementId: answerTo\.requirementId,/, '回答要挂回原需求，收尾才对得上');
});

test('群里只有本机：问队友不会挡住收尾，也不会白等 90 秒', async () => {
  const waits: string[] = [];
  const solo = {
    shareNote: async (input: { body: string }) => ({
      ok: true,
      message: '已记录，当前没有其它设备加入。',
      note: makeNote(win, { body: input.body }, 1) as SyncNote,
      // 关键：没有真的发出去。
      delivered: false,
    }),
    waitForReply: async () => [],
    noteAskSent: () => undefined,
    pendingAskPeers: () => ['macOS · MacBook-Pro'],
    groupState: () => ({ peers: [win] }),
    state: () => ({ text: '未连接' }),
    recentNotes: () => [],
    requirementTitles: () => [],
  };
  const outcome = await runTeamSync(solo as unknown as LanSyncService, {
    action: 'ask',
    message: '你那端改了吗？',
  }, { requirementId: 'r5' });

  assert.equal(waits.length, 0, '没人在群里就不该等');
  assert.match(outcome.content, /只有这一台|没发出去/, '要如实说没有队友会回答');
});

test('lanSync：没真的发出去的提问不算「还在等回话」（否则单机任务永远交不出结果）', async () => {
  const { service, dir } = await makeService(async () => true);
  try {
    const ask = makeNote(win, { body: '你这端改了吗？', topic: 'x' }, 10) as SyncNote;
    service.noteAskSent(ask, 'r6', false);
    assert.equal(service.pendingAsksFor('r6').length, 0, '没发出去 → 没人会回答 → 不算在等');

    // 反面：真的发出去了就要记，收尾才会降级。
    service.noteAskSent(ask, 'r7', true, [mac]);
    assert.equal(service.pendingAsksFor('r7').length, 1);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('账本状态跟群里说的话一致：还在等队友时标 in_progress，不是 done', () => {
  // 规则在纯函数里（`groupOutcomeReceipt.test.ts` 执行验证），这里只确认面板没有第二份判断。
  const plan = planOutcomePost({
    outcome: 'completed',
    text: '本端这半边做完了。',
    files: [],
    requirementId: 'req-1',
    waitingTeammates: ['MacBook-Pro'],
    alreadyReported: false,
    superseded: false,
  });
  assert.equal(plan.ledger?.status, 'in_progress', '群里说「还在等」时账本不能打已完成');
  assert.match(plan.ledger!.note, /还没达成一致/, '账本备注要说清在等谁');
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /await this\.lanSync\.report\(\{ requirementId, \.\.\.plan\.ledger, files \}\)/, '面板照抄结论，不自己再判一遍');
});

test('模型直接发「结果」也要过闸：还有队友没回话就降级成进度', async () => {
  /*
   * 提示词一直让模型用 action=result 报结果，但旧实现把不认识的 action 当成「给队友
   * 发消息」——模型以为报了，群里其实什么都没有。现在按阶段真发进群，并且
   * **结果必须过同一道闸**。
   */
  const posted: { phase: string; body: string; requirementId?: string; options?: readonly string[] }[] = [];
  const service = {
    shareNote: async () => ({ ok: true, message: '', delivered: false }),
    waitForReply: async () => undefined,
    noteAskSent: () => undefined,
    groupState: () => ({ peers: [win] }),
    state: () => ({ text: '' }),
    recentNotes: () => [],
    requirementTitles: () => [],
    openQuestionRequirement: () => 'r-9',
    latestRequirementId: () => 'r-9',
    pendingAsksFor: () => [{ toId: mac.id, label: 'macOS · MacBook-Pro', at: Date.now() }],
    postGroup: async (input: { phase: string; body: string; requirementId?: string; options?: readonly string[] }) => {
      posted.push(input);
      return { ok: true, message: '已发到群里。' };
    },
  };

  const outcome = await runTeamSync(service as unknown as LanSyncService, {
    action: 'result',
    message: '我的结论：两类都要同步。',
  }, { requirementId: 'r-9' });

  assert.equal(posted.length, 1, '要真的发进群');
  assert.equal(posted[0]!.phase, 'progress', '没等到回话就不是结果');
  assert.match(posted[0]!.body, /还不是最终结果/);
  assert.match(posted[0]!.body, /MacBook-Pro/);
  assert.equal(posted[0]!.requirementId, 'r-9');
  assert.match(outcome.content, /不算结果/);
});

test('模型发「结果」且没有待回答的提问：正常发 result，选项只在追问里保留', async () => {
  const posted: { phase: string; options?: readonly string[] }[] = [];
  const service = {
    shareNote: async () => ({ ok: true, message: '', delivered: false }),
    waitForReply: async () => undefined,
    noteAskSent: () => undefined,
    groupState: () => ({ peers: [win] }),
    state: () => ({ text: '' }),
    recentNotes: () => [],
    requirementTitles: () => [],
    openQuestionRequirement: () => undefined,
    latestRequirementId: () => 'r-1',
    pendingAsksFor: () => [],
    postGroup: async (input: { phase: string; options?: readonly string[] }) => {
      posted.push(input);
      return { ok: true, message: '已发到群里。' };
    },
  };

  await runTeamSync(service as unknown as LanSyncService, {
    action: 'analysis',
    message: '我的理解：你要两类都同步。',
    options: ['不该出现在解析里'],
  }, { requirementId: 'r-1' });
  await runTeamSync(service as unknown as LanSyncService, {
    action: 'question',
    message: '先同步哪一类？',
    options: ['便签', '素材', '全部', '多出来的第5个'],
  }, { requirementId: 'r-1' });

  assert.deepEqual(posted.map((item) => item.phase), ['analysis', 'question']);
  assert.equal(posted[0]!.options, undefined, '只有追问才带选项');
  assert.deepEqual(posted[1]!.options, ['便签', '素材', '全部', '多出来的第5个'].slice(0, 4));
});

test('本机发到群里的需求，自己也记一次已读（截图里本机「消失」的根因）', async () => {
  /*
   * 用户 2026-11-25：「我发的消息没有 @ 任何 agent，默认是所有人都收到消息，
   * 但是显示只有『已读：macOS …』」——以前只有收到别人消息才回执，
   * 自己那条永远没有自己的回执，界面就把本机漏掉了。
   */
  const { service, dir } = await makeService(async () => true);
  try {
    const posted = await service.postGroup({ author: 'user', phase: 'requirement', body: '四象限卡片要保留大规格尺寸' });
    assert.ok(posted.group, '要真的进群');
    assert.ok(service.readsOf(posted.group!.id).includes(win.id), '本机也算收到（它就在本机的群记录里）');

    // 指名给别人的消息，本机不是收件人，不该给自己记已读。
    const directed = await service.postGroup({ author: 'user', phase: 'requirement', body: '只给 mac', to: mac.id });
    assert.equal(
      service.readsOf(directed.group!.id).includes(win.id),
      false,
      '点名别人的消息不给自己记已读',
    );
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('提示词不写死「另一台 / 两台」：三台以上也说得清、等得齐', () => {
  /*
   * 用户要求（2026-11-25）：「不要只针对我优化，需要做成普适性功能」。
   * 协作群可以是 2 台、3 台、更多台，提示词里的「另一台」会让模型以为只有一位队友。
   */
  assert.match(TEAM_GROUP_PROMPT, /other devices/, '英文提示词也要能应付多台设备');
  assert.doesNotMatch(TEAM_GROUP_PROMPT, /two product managers/, '不要再写死「两个产品经理」');
  assert.doesNotMatch(TEAM_GROUP_PROMPT, /the other device are your teammate/, '不要再把队友说成「那一台」');

  const linux: SyncPeer = { id: 'p-linux', name: 'Linux', platform: 'linux', project: 'app', version: 't' };
  const requirement = {
    kind: 'requirement' as const,
    id: 'r-1',
    from: mac,
    title: '同步方案',
    detail: '同步方案',
    createdAt: 1,
  };
  const prompt = requirementPromptForLocal(requirement, win, [], { peers: [mac, linux] });
  assert.match(prompt, /队友\*\*：.*MacBook-Pro.*Linux/, '要把每一台队友都点名');
  assert.match(prompt, /可能不止一台/, '身分章节也要说明可能多台');
  assert.match(prompt, /等它们\*\*都\*\*回话/, '多台时要等齐再下结论');
  assert.match(prompt, /和队友的分工/, '分工章节不该再写「另一台」');
});

test('群窗口收尾按事实判断：有未回答的提问就只能发进度', () => {
  // 规则在纯函数里执行验证（见 `groupOutcomeReceipt.test.ts`）。
  const plan = planOutcomePost({
    outcome: 'completed',
    text: '我这边做完了。',
    files: [],
    requirementId: 'req-1',
    waitingTeammates: ['MacBook-Pro'],
    alreadyReported: false,
    superseded: false,
  });
  assert.equal(plan.post?.phase, 'progress', '有未回答的提问就只能发进度');
  assert.match(plan.post!.body, /不是最终结果/, '要明说不是最终结果');
  assert.equal(plan.askedUser, false, '等的是队友，不是甲方');

  // 提问消息本身要挂在当前需求上（协议层字段，面板不能漏）。
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /requirementId: run\.syncRequirementId \?\? ''/, '提问要挂在当前需求上');
});
