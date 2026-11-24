import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService, makeInviteCode, normalizeHubAddress, normalizeInviteCode, parseInviteText, yieldDecision } from '../sync/lanSync';
import type { SyncNote, SyncPeer, SyncRequirement } from '../sync/lanProtocol';

/**
 * 端到端：真的起两个监听取件，验证「配对 → 广播需求 → 对端执行 → 对端回报 → 主机落账」。
 *
 * 这是这个功能最容易「看起来写完了其实不通」的地方（第一版就把加入方的地址算成了
 * 主机自己，需求永远送不到对端）。所以这里不打桩，用真实 HTTP + 真实端口。
 */

/** 测试专用发现端口：避开真实运行中的扩展（它占 47821）。 */
const ISOLATED_DISCOVERY_PORT = 48_960;

const HUB_PORT = 48_321;
const PEER_PORT = 48_322;

const winPeer: SyncPeer = { id: 'p-win', name: 'PC · Windows', platform: 'win32', project: 'app-win', version: 'test' };
const macPeer: SyncPeer = { id: 'p-mac', name: 'Mac · macOS', platform: 'darwin', project: 'app-mac', version: 'test' };

async function makeService(peer: SyncPeer, options: {
  onRequirement?: (requirement: SyncRequirement) => Promise<boolean>;
  onNote?: (note: SyncNote) => Promise<boolean>;
  onGroupMessage?: (message: any) => Promise<void>;
  /** 测试与真实运行中的扩展隔离：真实实例会占用 47821 广播。 */
  discoveryPort?: number;
} = {}): Promise<{ service: LanSyncService; dir: string; ledgers: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-sync-'));
  const ledgers: string[] = [];
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => peer,
    runRequirement: options.onRequirement ?? (async () => true),
    runNote: options.onNote ?? (async () => true),
    ...(options.onGroupMessage ? { onGroupMessage: options.onGroupMessage } : {}),
    writeLedger: async (markdown) => { ledgers.push(markdown); },
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: options.discoveryPort ?? 48_900 });
  await service.load();
  return { service, dir, ledgers };
}

/**
 * 用户反复卡住的那一步：**群里发的话，另一台到底收没收到**。
 *
 * 以前 `chatPanel.setLanSync()` 从没被调用，群消息整个分支被跳过 ——
 * 群窗口一片空白，只有本机主对话在跑。这条测的就是那条链真的通不通。
 */
test('端到端：群里发的发言，另一台真的收到（双向）', async () => {
  const HUB_PORT = 48_341;
  const PEER_PORT = 48_342;

  const hubGot: string[] = [];
  const peerGot: string[] = [];

  const hub = await makeService(winPeer, {
    onGroupMessage: async (message) => { hubGot.push(String(message.body)); },
  });
  const peer = await makeService(macPeer, {
    onGroupMessage: async (message) => { peerGot.push(String(message.body)); },
  });

  await hub.service.setPairingCode('TEST-CODE');
  await peer.service.setPairingCode('TEST-CODE');

  try {
    const started = await hub.service.startHub(HUB_PORT);
    assert.equal(started.ok, true, started.message);

    const joined = await peer.service.joinHub(`http://127.0.0.1:${HUB_PORT}`, PEER_PORT);
    assert.equal(joined.ok, true, joined.message);

    // 主机 → 从机
    const fromHub = await hub.service.postGroup({
      author: 'user',
      phase: 'requirement',
      body: '主机发的一条需求',
    });
    assert.equal(fromHub.ok, true, fromHub.message);
    assert.ok(peerGot.includes('主机发的一条需求'), '从机必须收到主机在群里说的话');

    // 从机 → 主机（转发经由主机）
    const fromPeer = await peer.service.postGroup({
      author: 'user',
      phase: 'requirement',
      body: '从机发的一条需求',
    });
    assert.equal(fromPeer.ok, true, fromPeer.message);
    assert.ok(hubGot.includes('从机发的一条需求'), '主机必须收到从机在群里说的话');

    // 本机自己也要留下记录（群窗口不能空白）
    assert.deepEqual(
      hub.service.recentGroup().map((item) => item.body),
      ['主机发的一条需求', '从机发的一条需求'],
    );
    assert.deepEqual(
      peer.service.recentGroup().map((item) => item.body),
      ['主机发的一条需求', '从机发的一条需求'],
    );
  } finally {
    hub.service.dispose();
    peer.service.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peer.dir, { recursive: true, force: true });
  }
});

test('端到端：配对后主机发需求，对端真的收到并执行；对端回报后主机账本更新', async () => {
  const hub = await makeService(winPeer);
  const peer = await makeService(macPeer);

  // 两边用同一个配对码（真实流程里由用户填）。
  await hub.service.setPairingCode('TEST-CODE');
  await peer.service.setPairingCode('TEST-CODE');

  const received: SyncRequirement[] = [];
  // 对端收到需求：记录一下（真实环境里这里会开跑一轮 agent）。
  const peerWithHook = new LanSyncService(join(peer.dir, 'state2.json'), {
    peer: () => macPeer,
    runRequirement: async (requirement) => { received.push(requirement); return true; },
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await peerWithHook.load();
  await peerWithHook.setPairingCode('TEST-CODE');
  // 项目对齐：新版本要求「同一个项目」才执行，否则会先追问。
  await peerWithHook.setCollabProject('app-win');

  try {
    const started = await hub.service.startHub(HUB_PORT);
    assert.equal(started.ok, true, started.message);
    const joined = await peerWithHook.joinHub(`http://127.0.0.1:${HUB_PORT}`, PEER_PORT);
    assert.equal(joined.ok, true, joined.message);

    const shared = await hub.service.shareRequirement('加一个托盘图标，点击恢复窗口');
    assert.equal(shared.ok, true, shared.message);
    assert.ok(shared.requirement);

    // 对端应当收到同一条需求（等一小会儿让网络请求完成）。
    await waitFor(() => received.length > 0, 3_000);
    assert.equal(received[0]?.id, shared.requirement!.id, '两端必须用同一个需求号');
    assert.match(received[0]!.detail, /托盘图标/);

    // 对端回报 done，主机的账本要出现这一行。
    await peerWithHook.report({
      requirementId: shared.requirement!.id,
      status: 'done',
      summary: '已用 NSStatusBar 实现',
      files: ['Sources/App/Tray.swift'],
    });
    await waitFor(() => hub.ledgers.length > 0 && hub.ledgers[hub.ledgers.length - 1]!.includes('NSStatusBar'), 3_000);
    const ledger = hub.ledgers[hub.ledgers.length - 1]!;
    assert.match(ledger, /托盘图标/, '账本要有这条需求');
    assert.match(ledger, /macOS/, '账本要标出是哪个平台完成的');
  } finally {
    hub.service.dispose();
    peerWithHook.dispose();
    peer.service.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peer.dir, { recursive: true, force: true });
  }
});

test('端到端：配对码不一致时加入失败，需求不会外泄', async () => {
  const hub = await makeService(winPeer);
  const peer = await makeService(macPeer);
  await hub.service.setPairingCode('RIGHT-CODE');
  await peer.service.setPairingCode('WRONG-CODE');
  const received: SyncRequirement[] = [];
  const spy = new LanSyncService(join(peer.dir, 'spy.json'), {
    peer: () => macPeer,
    runRequirement: async (requirement) => { received.push(requirement); return true; },
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await spy.load();
  await spy.setPairingCode('WRONG-CODE');

  try {
    assert.equal((await hub.service.startHub(HUB_PORT + 10)).ok, true);
    const joined = await spy.joinHub(`http://127.0.0.1:${HUB_PORT + 10}`, PEER_PORT + 10);
    assert.equal(joined.ok, false, '配对码不同必须拒绝');
    assert.match(joined.message, /配对码|无响应/);
    await hub.service.shareRequirement('不该被看到的机密需求');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(received.length, 0, '没配对的设备不该收到需求');
  } finally {
    hub.service.dispose();
    spy.dispose();
    peer.service.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peer.dir, { recursive: true, force: true });
  }
});

test('协作消息：主机发一条，对端 agent 收到；纯陈述不触发自动开跑', async () => {
  const hub = await makeService(winPeer);
  const notes: SyncNote[] = [];
  const statements: SyncNote[] = [];
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-sync-note-'));
  const peer = new LanSyncService(join(dir, 'state.json'), {
    peer: () => macPeer,
    runRequirement: async () => true,
    runNote: async (note) => { notes.push(note); return true; },
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await peer.load();
  await hub.service.setPairingCode('NOTE-CODE');
  await peer.setPairingCode('NOTE-CODE');

  try {
    assert.equal((await hub.service.startHub(HUB_PORT + 20)).ok, true);
    assert.equal((await peer.joinHub(`http://127.0.0.1:${HUB_PORT + 20}`, PEER_PORT + 20)).ok, true);

    // 纯陈述：记录但不自动跑。
    await hub.service.shareNote({ body: '我把标题栏改成自绘了', topic: '窗口' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(notes.length, 0, '纯陈述不该让对端开跑（防接龙）');
    assert.equal(peer.recentNotes(5).length, 1, '但必须记录下来，status 能看到');

    // 提问：触发对端自动跑一轮来回答。
    await hub.service.shareNote({ body: '你那边的窗口边距是多少？', topic: '窗口' });
    await waitFor(() => notes.length > 0, 3_000);
    assert.match(notes[0]!.body, /窗口边距/);
    statements.push(...peer.recentNotes(5));
    assert.equal(statements.length, 2, '两条都要在本地留存');
  } finally {
    hub.service.dispose();
    peer.dispose();
    await rm(dir, { recursive: true, force: true });
    await rm(hub.dir, { recursive: true, force: true });
  }
});

test('一键连接：陌生设备弹一次「允许」即可加入，之后重连不再询问', async () => {
  /*
   * 这是「傻瓜式」的核心：用户不抄配对码，只在弹窗上点一次「允许」。
   * 允许之后这台设备被记住，重连不再打扰。
   */
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-sync-approve-'));
  const dir2 = await mkdtemp(join(tmpdir(), 'hwchat-sync-approve2-'));
  const asked: string[] = [];
  const hub = new LanSyncService(join(dir, 'state.json'), {
    peer: () => winPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
    approvePeer: async (peer) => { asked.push(peer.id); return true; },
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await hub.load();
  await hub.setPairingCode('HUB-ONLY-CODE');

  const strangerA = new LanSyncService(join(dir2, 'a.json'), {
    peer: () => macPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await strangerA.load();
  await strangerA.setPairingCode('DIFFERENT-CODE');

  try {
    const started = await hub.startHub(HUB_PORT + 30);
    assert.equal(started.ok, true, started.message);

    const first = await strangerA.joinHub(`http://127.0.0.1:${HUB_PORT + 30}`, PEER_PORT + 30);
    assert.equal(first.ok, true, `点「允许」之后必须能加入：${first.message}`);
    assert.deepEqual(asked, [macPeer.id], '主机应该只问一次');

    // 记住之后再连：不再弹窗。
    strangerA.stop();
    const again = await strangerA.joinHub(`http://127.0.0.1:${HUB_PORT + 30}`, PEER_PORT + 30);
    assert.equal(again.ok, true);
    assert.equal(asked.length, 1, '允许过的设备重连不该再打扰用户');
  } finally {
    hub.dispose();
    strangerA.dispose();
    await rm(dir, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

test('一键连接：用户点「拒绝」时连不进来', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-sync-reject-'));
  const dir2 = await mkdtemp(join(tmpdir(), 'hwchat-sync-reject2-'));
  const hub = new LanSyncService(join(dir, 'state.json'), {
    peer: () => winPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
    approvePeer: async () => false,
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await hub.load();
  await hub.setPairingCode('HUB-CODE');
  const stranger = new LanSyncService(join(dir2, 'a.json'), {
    peer: () => macPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await stranger.load();
  await stranger.setPairingCode('OTHER');
  try {
    assert.equal((await hub.startHub(HUB_PORT + 40)).ok, true);
    const joined = await stranger.joinHub(`http://127.0.0.1:${HUB_PORT + 40}`, PEER_PORT + 40);
    assert.equal(joined.ok, false, '用户拒绝就必须连不上');
  } finally {
    hub.dispose();
    stranger.dispose();
    await rm(dir, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('等待超时：预期的情况没有发生');
}

test('中继需求按指派门控：指名别人时本机不跑，指名本机才跑，没指派全都跑', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-assign-'));
  try {
    const ran: string[] = [];
    const service = new LanSyncService(join(dir, 'state.json'), {
      peer: () => macPeer,
      runRequirement: async () => true,
      runNote: async () => true,
      onRelayUserMessage: (text) => { ran.push(text); },
      writeLedger: async () => undefined,
      writeTranscript: async () => undefined,
      log: () => undefined,
    }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
    await service.load();

    const requirement = (id: string, body: string, assignee?: string) => ({
      kind: 'group' as const,
      id,
      requirementId: id,
      from: winPeer,
      author: 'user' as const,
      phase: 'requirement' as const,
      body,
      at: Date.now(),
      ...(assignee ? { assignee } : {}),
    });

    await service.ingestRelayMessage(requirement('g1', '给别的设备做', 'p-other'));
    assert.deepEqual(ran, [], '指派给别人时本机不该开跑');

    await service.ingestRelayMessage(requirement('g2', '给本机做', 'p-mac'));
    assert.deepEqual(ran, ['给本机做'], '指派给本机才跑');

    await service.ingestRelayMessage(requirement('g3', '没指派'));
    assert.deepEqual(ran, ['给本机做', '没指派'], '没指派时保持旧行为：本机也跑');

    // 同一条消息重复投递（断线重连）只跑一次
    await service.ingestRelayMessage(requirement('g2', '给本机做', 'p-mac'));
    assert.equal(ran.length, 2);

    // 自己发的消息不触发本机再跑一遍
    await service.ingestRelayMessage({ ...requirement('g4', '我自己发的', 'p-mac'), from: macPeer });
    assert.equal(ran.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('两台都成主机时，只有 id 大的让位（不会两边同时让步）', () => {
  // 新版对新版：id 大的让，id 小的留。方向必须相反，不能两边都让或都不让。
  assert.equal(yieldDecision('p-b', 'p-a'), 'yield');
  assert.equal(yieldDecision('p-a', 'p-b'), 'stay');
  // 自己收到自己的广播：不能让，否则把自己拆了。
  assert.equal(yieldDecision('p-a', 'p-a'), 'stay');
  // 旧版广播没有 peer 字段，且旧版不会让位 —— 只能本机让，否则两边永远待命。
  assert.equal(yieldDecision('p-a', undefined), 'yield');
  assert.equal(yieldDecision('p-a', ''), 'yield');
  assert.equal(yieldDecision('p-a', 42), 'yield');
});

test('邀请码：6 位、只含易辨认字符、可规范化', () => {
  const code = makeInviteCode();
  assert.equal(code.length, 6);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/, `不能出现易混字符（0/O/1/I），实际：${code}`);

  // 每个位置都落在字符集内（不是恰好好看）。
  for (const ch of code) assert.ok('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.includes(ch));

  // 用户抄写常带小写、空格、连字符。
  assert.equal(normalizeInviteCode(' k7m2qx '), 'K7M2QX');
  assert.equal(normalizeInviteCode('K7M-2QX'), 'K7M2QX');
  assert.equal(normalizeInviteCode('  '), '');

  // 同一随机源必须给出同一码（可测、可复现）。
  const fixed = () => 0.5;
  assert.equal(makeInviteCode(fixed), makeInviteCode(fixed));
});

test('填码进群：码对才进得来，同一设备重复加入不会变成两台', async () => {
  const HUB_PORT = 48_351;
  const PEER_PORT = 48_352;

  const hub = await makeService(winPeer);
  const peer = await makeService(macPeer);

  try {
    const started = await hub.service.startGroup(HUB_PORT);
    assert.equal(started.ok, true, started.message);
    const code = started.code ?? '';
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);

    // 错的码：必须明确说「没找到」/「邀请码不对」，不能假装连上。
    const wrong = await peer.service.joinGroup('ZZZZZZ', PEER_PORT, `http://127.0.0.1:${HUB_PORT}`);
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /邀请码不对|没找到邀请码/);

    // 对的码：小写 + 空格也要认。
    const joined = await peer.service.joinGroup(` ${code.toLowerCase()} `, PEER_PORT, `http://127.0.0.1:${HUB_PORT}`);
    assert.equal(joined.ok, true, joined.message);
    assert.equal(peer.service.state().role, 'peer');
    assert.equal(hub.service.remotePeers().length, 1, '主机应当看到 1 台设备');

    // 同一台设备再进一次：仍然只有 1 台，并明确告诉它「已经在群里」。
    const again = await peer.service.joinGroup(code, PEER_PORT, `http://127.0.0.1:${HUB_PORT}`);
    assert.equal(again.ok, true, again.message);
    assert.match(again.message, /已经在群里/);
    assert.equal(hub.service.remotePeers().length, 1, '重复加入不能变成两台');
  } finally {
    hub.service.dispose();
    peer.service.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peer.dir, { recursive: true, force: true });
  }
});

/**
 * 真机路径：**不传地址，靠广播找到群**。
 *
 * 之前所有 joinGroup 测试都传了 address，等于绕过了广播发现 ——
 * 而那正是用户实际用的路径。这条用真实 UDP 广播走一遍：
 * 主机开群 → 成员只填码 → 必须能找到并进群。
 */
test('填码进群（走真实广播，不传地址）', async () => {
  const DISCOVERY = 48_975;
  const HUB_PORT = 49_321;
  const PEER_PORT = 49_322;

  const hub = await makeService(winPeer, { discoveryPort: DISCOVERY });
  // 成员必须用同一个发现端口，否则互相听不到。
  const peerDir = await mkdtemp(join(tmpdir(), 'hwchat-sync-'));
  const peer = new LanSyncService(join(peerDir, 'state.json'), {
    peer: () => macPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: DISCOVERY });
  await peer.load();

  try {
    const started = await hub.service.startGroup(HUB_PORT);
    assert.equal(started.ok, true, started.message);
    const code = started.code ?? '';

    // 只给码，不给地址 —— 全靠广播。
    const joined = await peer.joinGroup(code, PEER_PORT);
    assert.equal(joined.ok, true, `广播没能找到群：${joined.message}`);
    assert.equal(peer.state().role, 'peer');
    assert.equal(hub.service.remotePeers().length, 1, '主机必须看到 1 台成员');
  } finally {
    hub.service.dispose();
    peer.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peerDir, { recursive: true, force: true });
  }
});

test('邀请串：解析出地址与码，粘贴即可直连（不依赖广播）', () => {
  assert.deepEqual(parseInviteText('192.168.0.3:47821#K7M2QX'), { code: 'K7M2QX', address: '192.168.0.3:47821' });
  assert.deepEqual(parseInviteText('  k7m-2qx '), { code: 'K7M2QX' });
  assert.deepEqual(parseInviteText('192.168.0.3'), { code: '', address: '192.168.0.3' });
  assert.deepEqual(parseInviteText('#K7M2QX'), { code: 'K7M2QX' });
  // 只给码时没有地址，才需要广播。
  assert.equal(parseInviteText('K7M2QX').address, undefined);
});

test('传整串邀请文本就能进群：完全不走广播', async () => {
  const HUB_PORT = 49_331;
  const PEER_PORT = 49_332;

  const hub = await makeService(winPeer);
  const peer = await makeService(macPeer);

  try {
    const started = await hub.service.startGroup(HUB_PORT);
    assert.equal(started.ok, true, started.message);
    const code = started.code ?? '';
    assert.ok(started.text, '启动群聊必须给出可粘贴的邀请串');
    assert.match(started.text ?? '', /#/);

    /*
     * 模拟用户粘贴：把邀请串里的地址换成 127.0.0.1（测试在同一台机器上跑）。
     * 关键是**只传这一段文本**，不额外给地址 —— 这条路径必须不碰广播。
     */
    const pasted = `127.0.0.1:${HUB_PORT}#${code}`;
    const joined = await peer.service.joinGroup(pasted, PEER_PORT);
    assert.equal(joined.ok, true, joined.message);
    assert.equal(peer.service.state().role, 'peer');
    assert.equal(hub.service.remotePeers().length, 1);
  } finally {
    hub.service.dispose();
    peer.service.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peer.dir, { recursive: true, force: true });
  }
});

test('重启后邀请码仍然有效：群主自动恢复监听', async () => {
  const HUB_PORT = 49_341;
  const PEER_PORT = 49_342;
  const hubDir = await mkdtemp(join(tmpdir(), 'hwchat-sync-'));

  // 第一次：开群，记下邀请码，然后模拟 VS Code 重启（dispose 掉）。
  const first = new LanSyncService(join(hubDir, 'state.json'), {
    peer: () => winPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await first.load();
  const started = await first.startGroup(HUB_PORT);
  assert.equal(started.ok, true, started.message);
  const code = started.code ?? '';
  first.dispose();

  // 重启后：同一个存储目录，邀请码必须还在，并且监听被重新支起来。
  const again = new LanSyncService(join(hubDir, 'state.json'), {
    peer: () => winPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await again.load();
  assert.equal(again.currentInviteCode(), code, '邀请码必须持久化');

  const member = await makeService(macPeer);
  try {
    // 恢复前：另一台拿着旧码连过来必然被拒（这正是用户遇到的 ECONNREFUSED）。
    const beforeResume = await member.service.joinGroup(`127.0.0.1:${HUB_PORT}#${code}`, PEER_PORT);
    assert.equal(beforeResume.ok, false, '恢复监听之前不应该连得上');

    // 恢复监听后：同一个邀请码应当重新可用。
    const resumed = await again.resumeHosting();
    assert.equal(resumed, true, '应当能恢复群主监听');
    const afterResume = await member.service.joinGroup(`127.0.0.1:${HUB_PORT}#${code}`, PEER_PORT);
    assert.equal(afterResume.ok, true, `重启后旧邀请码应当仍然有效：${afterResume.message}`);
  } finally {
    again.dispose();
    member.service.dispose();
    await rm(hubDir, { recursive: true, force: true });
    await rm(member.dir, { recursive: true, force: true });
  }
});

test('主机没了要能发现：界面不能一直显示「已连接」', async () => {
  const HUB_PORT = 49_351;
  const PEER_PORT = 49_352;

  const lostCalls: string[] = [];
  const hub = await makeService(winPeer);
  const peerDir = await mkdtemp(join(tmpdir(), 'hwchat-sync-'));
  const peer = new LanSyncService(join(peerDir, 'state.json'), {
    peer: () => macPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
    onHostLost: (address) => { lostCalls.push(address); },
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await peer.load();

  try {
    const started = await hub.service.startGroup(HUB_PORT);
    assert.equal(started.ok, true, started.message);
    const joined = await peer.joinGroup(`127.0.0.1:${HUB_PORT}#${started.code}`, PEER_PORT);
    assert.equal(joined.ok, true, joined.message);
    assert.equal(peer.state().role, 'peer');

    // 主机活着时心跳不应该踢人。
    await peer.checkHostOnce();
    await peer.checkHostOnce();
    assert.equal(peer.state().role, 'peer', '主机还在，不能被误踢');

    /*
     * 主机消失（重启 / 改 IP / 用户断开）。
     * 以前没有心跳，peer 会永远停在 'peer'，界面一直显示「已连接」，
     * 两台看到的群记录也完全不同 —— 这正是用户遇到的情况。
     */
    hub.service.dispose();
    await peer.checkHostOnce();      // 第 1 次失败：容忍抖动
    assert.equal(peer.state().role, 'peer', '单次抖动不应该断开');
    await peer.checkHostOnce();      // 第 2 次失败：降级
    assert.equal(peer.state().role, 'off', '主机连续无响应必须降级为未连接');
    assert.equal(lostCalls.length, 1, '必须通知上层，好让界面提示用户');
  } finally {
    hub.service.dispose();
    peer.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peerDir, { recursive: true, force: true });
  }
});

test('自己也在当群主时，加入要能返回「需要确认」而不是硬拒或默默离开', async () => {
  const HUB_PORT = 49_361;
  const PEER_PORT = 49_362;

  // 两台用**不同的发现端口**，避免它们通过广播自动收敛（现实中广播不通时就是这个状态）。
  const a = await makeService(winPeer, { discoveryPort: 48_961 });
  const b = await makeService(macPeer, { discoveryPort: 48_962 });

  try {
    // 两台都点了「启动群聊」—— 这是最常见的误操作。
    const startedA = await a.service.startGroup(HUB_PORT);
    const startedB = await b.service.startGroup(PEER_PORT);
    assert.equal(startedA.ok, true, startedA.message);
    assert.equal(startedB.ok, true, startedB.message);

    const blocked = await b.service.joinGroup(`127.0.0.1:${HUB_PORT}#${startedA.code}`, PEER_PORT);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.needsSwitch, true, '要返回需要确认，交给界面问用户');
    assert.equal(b.service.state().role, 'hub', '没确认之前不能悄悄退出自己的群');

    // 用户确认后才真正切换。
    b.service.stop();
    const switched = await b.service.joinGroup(`127.0.0.1:${HUB_PORT}#${startedA.code}`, PEER_PORT, undefined, {
      allowWhileHosting: true,
    });
    assert.equal(switched.ok, true, switched.message);
    assert.equal(b.service.state().role, 'peer');
    assert.equal(a.service.remotePeers().length, 1);
  } finally {
    a.service.dispose();
    b.service.dispose();
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test('多个设备多个用户：命令冲突时只执行最新的那条，旧的被顶掉', async () => {
  const HUB_PORT = 49_371;
  const A_PORT = 49_372;
  const B_PORT = 49_373;

  const ran: string[] = [];
  const stopped: string[] = [];
  const hubDir = await mkdtemp(join(tmpdir(), 'hwchat-sync-'));

  /*
   * 三台设备在**同一个项目**上（项目对齐是新版本的前提）；
   * 执行故意不是瞬间结束（真实 agent 要跑好几分钟），
   * 只有这样才会出现「正在跑的时候又来了一条」。
   */
  const sameProject = { ...winPeer, project: 'app' };
  const hub = new LanSyncService(join(hubDir, 'state.json'), {
    peer: () => sameProject,
    runRequirement: async (item) => {
      ran.push(item.title);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return true;
    },
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
    onSuperseded: (info) => { stopped.push(info.stopped); },
  }, { discoveryPort: ISOLATED_DISCOVERY_PORT });
  await hub.load();

  const a = await makeService({ ...macPeer, project: 'app' });
  const b = await makeService({ id: 'p-linux', name: 'PC · Linux', platform: 'linux', project: 'app', version: 'test' });

  try {
    const started = await hub.startGroup(HUB_PORT);
    assert.equal(started.ok, true, started.message);
    const code = started.code ?? '';
    assert.equal((await a.service.joinGroup(`127.0.0.1:${HUB_PORT}#${code}`, A_PORT)).ok, true);
    assert.equal((await b.service.joinGroup(`127.0.0.1:${HUB_PORT}#${code}`, B_PORT)).ok, true);

    /*
     * 两位用户先后发**冲突**的命令（A 的用户先说，B 的用户后说）。
     * 群主正在跑第一条时，第二条到达必须把第一条顶掉。
     */
    const firstRun = a.service.shareRequirement('把按钮改成红色');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const secondRun = b.service.shareRequirement('不要红色，改成蓝色');
    await Promise.all([firstRun, secondRun]);
    await new Promise((resolve) => setTimeout(resolve, 900));

    assert.ok(stopped.length >= 1, `正在跑的旧需求必须被叫停（实际被叫停 ${stopped.length} 次）`);
    assert.ok(ran.length >= 1, '至少执行过一条');
    assert.equal(
      ran[ran.length - 1],
      '不要红色，改成蓝色',
      `最终执行的必须是**最新**那条，实际执行顺序：${ran.join(' → ')}`,
    );
  } finally {
    hub.dispose();
    a.service.dispose();
    b.service.dispose();
    await rm(hubDir, { recursive: true, force: true });
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test('只靠邀请码进群后，群消息必须真的能传过去（不能 403）', async () => {
  const HUB_PORT = 49_391;
  const PEER_PORT = 49_392;

  /*
   * 这条是给一个**真实事故**兜底的：
   * 0.5.0~0.5.7 里「填邀请码进群」之后，主机按旧配对码校验，一律 403 ——
   * 加入看着成功，但群里发的每一条都传不过去，两台 agent 从来没真正同群。
   *
   * 之前所有测试都设了旧配对码，正好绕过了这条路径，所以一直没发现。
   * 这里**故意不设配对码**，只用邀请码。
   */
  const received: string[] = [];
  const hub = await makeService(winPeer, {
    onGroupMessage: async (message) => { received.push(String(message.body)); },
  });
  const peer = await makeService(macPeer);

  try {
    const started = await hub.service.startGroup(HUB_PORT);
    assert.equal(started.ok, true, started.message);
    // 关键：完全不调用 setPairingCode。
    const joined = await peer.service.joinGroup(`127.0.0.1:${HUB_PORT}#${started.code}`, PEER_PORT);
    assert.equal(joined.ok, true, joined.message);

    const posted = await peer.service.postGroup({
      author: 'user',
      phase: 'requirement',
      body: '成员在群里说的一句话',
    });
    assert.equal(posted.ok, true, posted.message);
    assert.ok(
      received.includes('成员在群里说的一句话'),
      `群消息被主机拒绝了（403），实际收到：${JSON.stringify(received)}`,
    );

    // 需求也要能过去（否则对端 agent 根本不会执行）。
    const shared = await peer.service.shareRequirement('成员提的需求');
    assert.equal(shared.ok, true, shared.message);
  } finally {
    hub.service.dispose();
    peer.service.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peer.dir, { recursive: true, force: true });
  }
});

test('手动填的地址只有 IP 时自动补端口，不会傻连 80', () => {
  assert.equal(normalizeHubAddress('192.168.0.3', 47821), 'http://192.168.0.3:47821');
  assert.equal(normalizeHubAddress('192.168.0.3:5000', 47821), 'http://192.168.0.3:5000', '显式端口不能被覆盖');
  assert.equal(normalizeHubAddress('http://192.168.0.3', 47821), 'http://192.168.0.3:47821');
  assert.equal(normalizeHubAddress('http://192.168.0.3:47821/', 47821), 'http://192.168.0.3:47821');
  assert.equal(normalizeHubAddress('', 47821), '');
});

test('没连任何通道时，发需求必须明说「没有同步到任何其它设备」', async () => {
  const { service, dir } = await makeService(winPeer);
  try {
    const result = await service.shareRequirement('加一个托盘图标');
    assert.equal(result.ok, false, '此刻没有任何设备会收到，不能报成功');
    assert.match(result.message, /没有同步到任何其它设备/);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('再点一次「连接另一台设备」不会把自己当主机连上去', async () => {
  const { service, dir } = await makeService(winPeer);
  const port = 48_331;
  try {
    const first = await service.startHub(port);
    assert.equal(first.ok, true, first.message);

    /*
     * 用户就是这么操作的：两台都点了，或在同一台又点了一次。
     * 修之前这里会变成 `peer` 并「加入 http://<本机地址>:47821」——
     * 界面提示已连上，实际一台都没连。
     */
    const again = await service.autoConnect(port);
    assert.equal(again.role, 'hub', `不该自己加入自己（返回 ${again.role}：${again.message}）`);
    assert.deepEqual(service.remotePeers(), [], '没有第二台设备时对端清单必须为空');
    assert.equal(service.state().address, `:${port}`, '仍应作为主机待命');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});