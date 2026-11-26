import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import {
  assignmentNotice,
  makeGroupMessage,
  peerGroupLineReason,
  type PeerLine,
  type SyncPeer,
} from '../sync/lanProtocol';
import { shouldRotateTeamConversation } from '../sync/teamRotation';

/**
 * 用户 2026-11-26（原话）：
 *
 * 「Windows的回复，macos能读取到，但是macos的消息，团队窗口Windows显示已读，
 *  但是Windows的团队任务对话框实际没有macos的新消息进去。而且macos端，不是说给它的，
 *  它能看到，但是会输出『这条活由另一台执行，这台只记录、不动手。』，而Windows就不会。
 *  是不是那边发起群里，两边的模式不一样呀？为什么差距这么大？」
 *
 * 用真实存档复核后确认：**跟操作系统无关，也不是「谁先发起」**，是三处通用缺陷：
 *  1. 收到队友消息（没有需求号）时，轮换判定走体量兜底 → 每收一条就换一条新对话，
 *     消息进的是新对话，人盯着的那条看起来就是「没进来」（30 分钟归档 8 条，每条 3–5 条消息）；
 *  2. 群发言（team_sync action=progress|result|…）只记群记录、只画群窗口，从不进对话；
 *     只有 send|ask（note）会进 —— 于是「谁用了哪种动作」决定对面能否看见；
 *  3. 「只记录、不动手」不点名被 @ 的是谁，甲方看到两台各说一套，误以为模式不同。
 */

const me: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 'test' };
const mac: SyncPeer = { id: 'p-mac', name: 'Mac mini', platform: 'darwin', project: 'app', version: 'test' };

test('队友消息绝不换对话：没有需求号就不是新需求（这条导致消息「进错对话」）', () => {
  // 真实体量：3 条消息 / 290 万 tokens，早就超过 24 条 / 4 万 tokens 的兜底阈值。
  const big = { messageCount: 352, totalTokens: 616_279_829 };
  assert.equal(shouldRotateTeamConversation({ summary: big, previousRequirementId: 'req-1' }), false,
    '队友消息没有需求号，以前会在这里换新对话');
  assert.equal(shouldRotateTeamConversation({ summary: big }), false, '连需求号都没有更不该换');
  // 真换了需求才换。
  assert.equal(shouldRotateTeamConversation({ summary: big, previousRequirementId: 'req-1', requirementId: 'req-2' }), true);
  assert.equal(shouldRotateTeamConversation({ summary: big, previousRequirementId: 'req-1', requirementId: 'req-1' }), false,
    '同一条需求的追问要继续用同一份上下文');
  // 小对话在换需求时也要换（省掉上一条的工具流水），行为不变。
  assert.equal(shouldRotateTeamConversation({
    summary: { messageCount: 3, totalTokens: 1000 },
    previousRequirementId: 'req-1',
    requirementId: 'req-2',
  }), true);
});

test('对端发言的可见性判据只有「谁说的 / 派给谁」，不看正文', () => {
  const base = { author: 'agent', from: { id: 'p-mac' } } as const;
  assert.equal(peerGroupLineReason(base, 'p-win'), 'agent-said', '对端 agent 说的，本机必须看得见');
  assert.equal(peerGroupLineReason(base, 'p-mac'), undefined, '自己说的不用再追加一遍');
  // 反过来一样成立：这条判据对两端对称，不存在「Windows 一种、macOS 另一种」。
  assert.equal(peerGroupLineReason({ author: 'agent', from: { id: 'p-win' } }, 'p-mac'), 'agent-said');

  assert.equal(peerGroupLineReason({ author: 'user', from: { id: 'p-mac' }, assignee: 'p-win' }, 'p-win'), undefined,
    '指派给本机的需求走执行路径，自己会写进对话，别追加两遍');
  assert.equal(peerGroupLineReason({ author: 'user', from: { id: 'p-mac' }, assignee: 'p-mac' }, 'p-win'), 'assigned-elsewhere',
    '指派给别人的需求，本机不执行，但需求本身要看得见');
  assert.equal(peerGroupLineReason({ author: 'user', from: { id: 'p-mac' } }, 'p-win'), undefined, '没指派 = 两台都做');
});

test('「只记录、不动手」必须点名被 @ 的是谁', () => {
  const notice = assignmentNotice({ targetLabel: 'Windows · MAGICBOOKV14', selfIsTarget: false });
  assert.match(notice, /@ 了「Windows · MAGICBOOKV14」/, '要说清是谁，否则看起来像两边模式不同');
  assert.match(notice, /@所有人/, '要给出「想让两台一起做」的办法');
  assert.doesNotMatch(notice, /另一台/, '不能再含糊成「另一台」');
});

test('面板侧：appendPeerLine 真的把对端发言写进团队对话，且不跑模型', async () => {
  const { readFileSync } = await import('node:fs');
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  /*
   * 这一段是**接线**级的验证：`appendPeerLine` 必须
   *  1. 拿团队对话（`ensureGroupConversation`）—— 不能插到用户正在看的普通对话里；
   *  2. 存成 `user` 角色 —— 不能存成 assistant，否则模型会把它当成自己说过的话；
   *  3. 走 `storage.appendMessage`，**不调用** `send()` —— 显示不等于开跑。
   */
  const start = panel.indexOf('async appendPeerLine(');
  assert.ok(start > 0, 'appendPeerLine 必须存在（否则对端发言根本进不了对话）');
  const body = panel.slice(start, start + 2_600);
  assert.match(body, /ensureGroupConversation\(/, '要落到团队对话');
  assert.match(body, /peerLinesShown/, '按 id 去重');
  assert.match(body, /role: 'user'/, '外部进来的话存成 user 角色');
  assert.match(body, /storage\.appendMessage/, '要真的写进对话存档');
  assert.doesNotMatch(body, /this\.send\(/, '只显示，不开跑（否则两个 agent 会互相接龙）');

  // 服务层的接线也要在：lanSetup 把 onPeerLine 接到面板。
  const setup = readFileSync('src/sync/lanSetup.ts', 'utf8');
  assert.match(setup, /async onPeerLine\(line\)[\s\S]{0,200}chat\.appendPeerLine\(line\)/, '服务层发言要接到面板');
});

test('服务层：对端 agent 的群发言真的会交给面板显示进对话（且不触发运行）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-peerline-'));
  const lines: PeerLine[] = [];
  let runs = 0;
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    async runRequirement() { runs += 1; return true; },
    async runNote() { runs += 1; return true; },
    async onPeerLine(line) { lines.push(line); },
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  try {
    const shared = await service.shareRequirement('两端同步', undefined, []);
    const requirementId = shared.requirement!.id;

    // 对端 agent 发进群的一条进度（`team_sync action=progress` 走的就是这条路）。
    const progress = makeGroupMessage(mac, {
      author: 'agent',
      phase: 'progress',
      body: '我这边查完了：files 段单文件 4MB、总量 8MB。',
      requirementId,
    });
    assert.ok(progress);
    await service.ingestRelayMessage(progress);

    assert.equal(lines.length, 1, '对端 agent 的发言必须交给面板（以前只画群窗口）');
    assert.equal(lines[0]!.id, progress.id);
    assert.equal(lines[0]!.reason, 'agent-said');
    assert.match(lines[0]!.speaker, /Mac mini/, '要给人看的名字，不是设备 id');
    assert.match(lines[0]!.body, /files 段单文件 4MB/);
    assert.equal(runs, 0, '群发言不是执行触发器：显示可以，绝不能因此再跑一轮（否则互相接龙）');

    // 自己发的不会再显示一遍。
    const mine = makeGroupMessage(me, { author: 'agent', phase: 'result', body: '我这边也查完了', requirementId });
    assert.ok(mine);
    await service.ingestRelayMessage(mine);
    assert.equal(lines.length, 1, '自己说的话已经在自己对话里，不该重复追加');

    // 重复投递同一条（断线重连）：服务层按 id 去重，不会再交一次。
    await service.ingestRelayMessage(progress);
    assert.equal(lines.length, 1, '重复投递不能重复显示');

    // 指派给对端的需求：本机不执行，但需求本身要能看见，并且群里点名被 @ 的是谁。
    const assigned = makeGroupMessage(mac, {
      author: 'user',
      phase: 'requirement',
      body: '只让 mac 那边改',
      assignee: 'p-mac',
    });
    assert.ok(assigned);
    await service.ingestRelayMessage(assigned);
    const assignedLine = lines.find((line) => line.id === assigned.id);
    assert.ok(assignedLine, '指派给别人的需求也要进本机对话');
    assert.equal(assignedLine.reason, 'assigned-elsewhere');
    const notice = service.recentGroup(5).find((message) => message.body.includes('只记录、不动手'));
    assert.ok(notice, '群里要有一条「我只记录」的说明');
    assert.match(notice.body, /@ 了「/, '说明必须点名被 @ 的设备');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
