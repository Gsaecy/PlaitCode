import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildGroupTimeline } from '../views/groupPanel';
import {
  makeGroupMessage,
  makeReceipt,
  parseSyncMessage,
  type SyncPeer,
} from '../sync/lanProtocol';
import { requirementPromptForLocal } from '../sync/lanProtocol';

/**
 * 用户 2026-11-25 的两条要求：
 *  1.「让 @所有人和 @对应 agent 的消息像普通对话窗口那样，消息能打断正在进行的任务，
 *     然后将新消息加入综合分析后再更新任务再继续执行」；
 *  2.「我发 @所有人的消息，window 这个 agent 收到后，这个消息下面会显示 Windows 这个 agent 已读」。
 *
 * 这一组测试钉住三件事：回执过网、回执不变成气泡、打断后新消息带着「合并」指令跑。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
const GROUP = readFileSync('src/views/groupPanel.ts', 'utf8');
/** 群窗口界面脚本（真文件）；宿主侧仍在 groupPanel.ts。 */
const GROUP_SCRIPT = readFileSync('media/group.js', 'utf8');
const SYNC = readFileSync('src/sync/lanSync.ts', 'utf8');

const win: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 't' };
const mac: SyncPeer = { id: 'p-mac', name: 'Mac mini', platform: 'darwin', project: 'app', version: 't' };

test('已读回执能过网，而且旧版本收到也不会被当成发言', () => {
  const receipt = makeReceipt(win, ['m1', 'm2', 'm1'])!;
  assert.deepEqual(receipt.ids, ['m1', 'm2'], '去重');
  const parsed = parseSyncMessage(JSON.parse(JSON.stringify(receipt)));
  assert.ok(parsed && parsed.kind === 'receipt');
  assert.deepEqual((parsed as { ids: string[] }).ids, ['m1', 'm2']);
  assert.equal(parsed!.from.id, 'p-win');

  // 空回执不该产生消息（否则每次心跳都刷一条）。
  assert.equal(makeReceipt(win, []), undefined);
});

test('回执只记状态：不进群记录、不产生气泡、不触发执行', () => {
  const branch = SYNC.slice(
    SYNC.indexOf("} else if (message.kind === 'receipt')"),
    SYNC.indexOf("} else if (message.kind === 'note')"),
  );
  assert.match(branch, /markRead\(/, '要记下谁读了');
  assert.doesNotMatch(branch, /this\.group = \[/, '回执不能进群记录');
  assert.doesNotMatch(branch, /onGroupMessage/, '回执不能当发言推给面板');
  assert.doesNotMatch(branch, /runRequirement|runNote/, '回执不能触发执行');
});

test('收到甲方发言先回执再干活（正忙时甲方也能看到已读）', () => {
  const index = SYNC.indexOf('addressedToLocal(message)');
  assert.ok(index > 0, '只在说给本机时回执');
  const body = SYNC.slice(index, index + 600);
  assert.match(body, /ackGroup\(\[message\.id\]\)/);
  assert.ok(
    index < SYNC.indexOf('onGroupMessage?.(arrived)', index),
    '回执必须排在「通知面板」之前，否则正忙时要等很久才看到',
  );
});

test('气泡下面显示已读；没回执时显示「等待对方确认收到」', () => {
  const at = Date.UTC(2026, 10, 25, 1, 0);
  const read = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '都看一下' }, at, 'a')!;
  const unread = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '还有一条' }, at + 1000, 'b')!;
  const peerMsg = makeGroupMessage(mac, { author: 'agent', phase: 'analysis', body: '收到' }, at + 2000, 'c')!;
  const options = {
    roster: [win, mac],
    labelOf: (peer_: SyncPeer | undefined) => (peer_ ? peer_.name : ''),
    localId: win.id,
    labelForId: (id: string) => (id === 'p-mac' ? 'macOS · Mac mini' : 'Windows · MAGICBOOKV14'),
  };

  const lines = buildGroupTimeline([read, unread, peerMsg], [], {
    ...options,
    now: at + 3000,
    reads: { [read.id]: ['p-mac'] },
  });
  // 自己发的、说给所有人的消息：本机一定读到了（见 0.10.18），所以「已读」里有两台。
  assert.deepEqual([...lines[0]!.readBy!].sort(), ['Windows · MAGICBOOKV14（本机）', 'macOS · Mac mini'].sort());
  assert.equal(lines[0]!.unreadBy, undefined, '两台都读到了');
  assert.equal(lines[0]!.ackPending, false);
  assert.deepEqual(lines[1]!.readBy, ['Windows · MAGICBOOKV14（本机）'], '本机自己读到，对端还没回执');
  assert.deepEqual(lines[1]!.unreadBy, ['macOS · Mac mini'], '没回执的那台要显式说未读');
  assert.equal(lines[1]!.ackPending, false, '已经有人读到时不挂「等待确认」');
  /*
   * 用户 2026-11-26：「不管是 agent 还是用户的消息气泡下面都要显示已读状态，
   * 哪些 agent 已读了」。所以队友 agent 说的话现在也带已读信息 ——
   * 没有回执时说「未读：谁」，而不是整块留白。
   */
  assert.deepEqual(lines[2]!.readBy, [], '队友的发言也要给已读列表（空数组 = 还没人回执）');
  assert.deepEqual(lines[2]!.unreadBy, ['Windows · MAGICBOOKV14（本机）', 'macOS · Mac mini'], '点名在等谁');

  const [old] = buildGroupTimeline([read], [], { ...options, now: at + 60 * 60_000 });
  assert.equal(old!.ackPending, false, '一小时前的消息不再挂「等待确认」');

  const [alone] = buildGroupTimeline([read], [], { ...options, roster: [win], otherDeviceCount: 0, now: at + 3000 });
  assert.equal(alone!.ackPending, false, '群里只有自己时不该提示等别人确认');
});

test('群窗口把已读写进气泡，未收到时点名在等谁', () => {
  assert.match(GROUP_SCRIPT, /'已读：' \+ line\.readBy\.join/, '要画出已读的设备');
  assert.match(GROUP_SCRIPT, /' · 未读：' \+ line\.unreadBy\.join/, '没回执的设备也要列出来');
  assert.match(GROUP_SCRIPT, /'等待确认收到：'/, '一条回执都没有时点名在等谁');
  assert.match(GROUP, /reads: this\.service\.allReads\(\)/, '回执来自服务层');
});

test('新消息打断正在跑的那一轮，并带上「合并后继续」的指令', () => {
  const start = PANEL.indexOf('async runSyncRequirement(');
  assert.ok(start > 0);
  const body = PANEL.slice(start, start + 2_400);
  assert.match(body, /interruptForGroupMessage\(\)/, '要真的打断，而不是直接 return false');
  assert.match(body, /先停下手上这一轮/, '要在群里明说发生了什么');
  assert.match(body, /interrupted/, '要把「被打断」交给提示词');

  const prompt = requirementPromptForLocal(
    { kind: 'requirement' as const, id: 'r1', from: win, title: '继续', detail: '继续', createdAt: 1 },
    mac,
    [],
    { fromSelf: false, peers: [win], interrupted: true },
  );
  assert.match(prompt, /这条消息打断了上一轮执行/);
  assert.match(prompt, /更新清单/, '要更新任务清单再继续');
  assert.match(prompt, /不要从头重做/, '已完成的部分不能重做');
});

test('打断的是团队任务那一轮，不是「用户此刻正在看的对话」', () => {
  const start = PANEL.indexOf('private async interruptForGroupMessage()');
  assert.ok(start > 0);
  const body = PANEL.slice(start, PANEL.indexOf('async runSyncRequirement(', start));
  assert.match(body, /findTeamConversation\(\)/, '要定位团队任务对话');
  assert.match(body, /run\.controller\.abort\(\)/, '要真的中止');
  assert.match(body, /killRunProcesses/, '要连子进程一起停');
});
