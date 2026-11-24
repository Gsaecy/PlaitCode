import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService, makeInviteCode, normalizeHubAddress, normalizeInviteCode, yieldDecision } from '../sync/lanSync';
import type { SyncNote, SyncPeer, SyncRequirement } from '../sync/lanProtocol';

/**
 * 端到端：真的起两个监听取件，验证「配对 → 广播需求 → 对端执行 → 对端回报 → 主机落账」。
 *
 * 这是这个功能最容易「看起来写完了其实不通」的地方（第一版就把加入方的地址算成了
 * 主机自己，需求永远送不到对端）。所以这里不打桩，用真实 HTTP + 真实端口。
 */

const HUB_PORT = 48_321;
const PEER_PORT = 48_322;

const winPeer: SyncPeer = { id: 'p-win', name: 'PC · Windows', platform: 'win32', project: 'app-win', version: 'test' };
const macPeer: SyncPeer = { id: 'p-mac', name: 'Mac · macOS', platform: 'darwin', project: 'app-mac', version: 'test' };

async function makeService(peer: SyncPeer, options: {
  onRequirement?: (requirement: SyncRequirement) => Promise<boolean>;
  onNote?: (note: SyncNote) => Promise<boolean>;
  onGroupMessage?: (message: any) => Promise<void>;
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
  });
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
  });
  await peerWithHook.load();
  await peerWithHook.setPairingCode('TEST-CODE');

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
  });
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
  });
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
  });
  await hub.load();
  await hub.setPairingCode('HUB-ONLY-CODE');

  const strangerA = new LanSyncService(join(dir2, 'a.json'), {
    peer: () => macPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
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
  });
  await hub.load();
  await hub.setPairingCode('HUB-CODE');
  const stranger = new LanSyncService(join(dir2, 'a.json'), {
    peer: () => macPeer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
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
    });
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