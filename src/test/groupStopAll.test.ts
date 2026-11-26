import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { parseSyncMessage, type SyncPeer } from '../sync/lanProtocol';

/**
 * 团队群窗口那颗「停止执行」必须**停群里所有 agent**（用户 2026-11-24）：
 * 「团队群界面的停止执行，需要应用到群里所有 agent，
 *   而不是只应用到本设备的团队任务对话框」。
 *
 * 以前它只调本机的 `applyRemoteControl`，另一台照跑，甲方以为全停了。
 */

const HUB_PORT = 48_401;
const PEER_PORT = 48_402;
const ISOLATED_DISCOVERY = 48_975;

const winPeer: SyncPeer = { id: 'p-win', name: 'MagicBookV14 · win32', platform: 'win32', project: 'app', version: 't' };
const macPeer: SyncPeer = { id: 'p-mac', name: '192.168.0.8 · darwin', platform: 'darwin', project: 'app', version: 't' };

async function make(peer: SyncPeer, controls: any[]): Promise<{ service: LanSyncService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-stopall-'));
  const service: LanSyncService = new LanSyncService(join(dir, 'state.json'), {
    peer: () => peer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    localProjects: () => ['app'],
    localProjectRepos: () => ['github.com/acme/app'],
    onRemoteControl: async (control) => {
      controls.push(control);
      return { ok: true, message: '这台已停止执行' };
    },
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY });
  await service.load();
  return { service, dir };
}

test('stopGroup 能过网络（不被当成非法 action 丢掉）', () => {
  const parsed = parseSyncMessage({
    kind: 'control',
    id: 'ctl-stopall-1',
    from: winPeer,
    action: 'stopGroup',
    at: 1,
  });
  assert.ok(parsed && parsed.kind === 'control');
  assert.equal(parsed.action, 'stopGroup');
});

test('A 点停止 → B 也收到 stopGroup，且不往群里塞多余状态', async () => {
  const aControls: any[] = [];
  const bControls: any[] = [];
  const hub = await make(winPeer, aControls);
  const peer = await make(macPeer, bControls);
  try {
    await hub.service.setPairingCode('STOP-CODE');
    await peer.service.setPairingCode('STOP-CODE');
    assert.equal((await hub.service.startHub(HUB_PORT)).ok, true);
    assert.equal((await peer.service.joinHub(`http://127.0.0.1:${HUB_PORT}`, PEER_PORT)).ok, true);

    const result = await hub.service.broadcastStop();
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /1/, '要说清通知了几台');

    for (let i = 0; i < 60 && !bControls.some((item) => item.action === 'stopGroup'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(bControls.some((item) => item.action === 'stopGroup'), '另一台必须收到停止指令');

    // 停完不再补群消息：这一轮自己的「没跑完（被停止）」才是精确的那条，
    // 多一条 progress 会把看板从「等你回复」拉回「进行中」。
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      hub.service.recentGroup(40).filter((m) => m.from.id === macPeer.id).length,
      0,
      '对端不该因为「收到停止」就在群里发言',
    );
  } finally {
    hub.service.dispose();
    peer.service.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peer.dir, { recursive: true, force: true });
  }
});

test('只有本机在线时说「只有本机」，并真的把本机停下', async () => {
  const controls: any[] = [];
  const { service, dir } = await make(winPeer, controls);
  try {
    await service.setPairingCode('SOLO-CODE');
    assert.equal((await service.startHub(48_403)).ok, true);
    const result = await service.broadcastStop();
    assert.equal(result.ok, true);
    assert.match(result.message, /只有本机/);
    /*
     * 单机时没有对端可播，但**本机必须真的停** —— 手机上的「停止执行」走的就是这个方法，
     * 以前这里直接返回「已停」却什么都没停（用户点了停止，任务还在跑）。
     */
    assert.deepEqual(controls.map((control) => control.action), ['stopGroup'], '本机要收到一次停止指令');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('团队群窗口的停止按钮走的是「全群停」，不是只停本机', () => {
  const setup = readFileSync('src/sync/lanSetup.ts', 'utf8');
  assert.match(setup, /control: \(\) => groupStopAll\(\)/, '群窗口的停止要调 groupStopAll');
  assert.match(setup, /await service\.broadcastStop\(\)/, 'groupStopAll 要把停止广播出去');
  assert.match(setup, /control\.action === 'stopGroup'[\s\S]{0,80}chat\.stopTeamTask\(\)/, '收到 stopGroup 就停群里的那轮活');
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /async stopTeamTask\(\)/, '本机要能单独停「群里的活」，不受当前看的是哪条对话影响');
  assert.match(panel, /broadcastStop\(\)/, '团队任务窗口的停止也要广播（否则一台停一台不停）');
});
