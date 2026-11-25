import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { parseSyncMessage, type SyncPeer } from '../sync/lanProtocol';

/**
 * 让**另一台**设备切项目（用户 2026-11-24）：
 * 「我需要每个设备都能切换项目，而不是只能切换本设备的项目」。
 *
 * 走 control 通道直达那台，不动本机选择；对端收到后自己切并在群里回执。
 */

const HUB_PORT = 48_391;
const PEER_PORT = 48_392;
const ISOLATED_DISCOVERY = 48_973;
const NODE_B = 48_974;

const winPeer: SyncPeer = { id: 'p-win', name: 'MagicBookV14 · win32', platform: 'win32', project: 'deepseek-hwchat', version: 't' };
const macPeer: SyncPeer = { id: 'p-mac', name: '192.168.0.8 · darwin', platform: 'darwin', project: 'personal workstation', version: 't' };

async function make(peer: SyncPeer, projects: string[], repos: string[], controls: any[]): Promise<{ service: LanSyncService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-remote-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => peer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    localProjects: () => projects,
    localProjectRepos: () => repos,
    onRemoteControl: async (control) => {
      controls.push(control);
      if (control.action === 'project' && control.project) {
        await service.setCollabProject(control.project, control.repo ?? '');
        return { ok: true, message: `已切到「${control.project}」` };
      }
      return { ok: true, message: 'ok' };
    },
    log: () => undefined,
  }, { discoveryPort: ISOLATED_DISCOVERY });
  await service.load();
  return { service, dir };
}

test('control 消息过网络保留 project / repo', () => {
  const parsed = parseSyncMessage({
    kind: 'control',
    id: 'ctl-1',
    from: { id: 'p-win', name: 'PC', platform: 'win32', project: 'a', version: 't' },
    action: 'project',
    project: 'Personal-Workstation-OS',
    repo: 'github.com/gsaecy/personal-workstation-os',
    at: 1,
  });
  assert.ok(parsed && parsed.kind === 'control');
  assert.equal((parsed as any).action, 'project');
  assert.equal((parsed as any).project, 'Personal-Workstation-OS');
  assert.equal((parsed as any).repo, 'github.com/gsaecy/personal-workstation-os');
});

test('A 让 B 切项目：B 自己切了，A 本机的选择不动', async () => {
  const aControls: any[] = [];
  const bControls: any[] = [];
  const hub = await make(winPeer, ['deepseek-hwchat', 'Personal-Workstation-OS'], ['github.com/gsaecy/plaitcode', 'github.com/gsaecy/personal-workstation-os'], aControls);
  const peer = await make(macPeer, ['personal workstation', 'deepseek-hwchat'], ['github.com/gsaecy/personal-workstation-os', 'github.com/gsaecy/plaitcode'], bControls);
  try {
    await hub.service.setPairingCode('REMOTE-CODE');
    await peer.service.setPairingCode('REMOTE-CODE');
    assert.equal((await hub.service.startHub(HUB_PORT)).ok, true);
    assert.equal((await peer.service.joinHub(`http://127.0.0.1:${HUB_PORT}`, PEER_PORT)).ok, true);

    await hub.service.setCollabProject('deepseek-hwchat', 'github.com/gsaecy/plaitcode');
    const before = hub.service.activeProjectName();

    // A 让 B 切到 B 自己的 deepseek-hwchat。
    const result = await hub.service.requestProjectSwitch('p-mac', 'deepseek-hwchat', 'github.com/gsaecy/plaitcode');
    assert.equal(result.ok, true, result.message);

    // 等 B 处理完（HTTP 是异步的）。
    for (let i = 0; i < 40 && !bControls.some((item) => item.action === 'project'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(bControls.some((item) => item.action === 'project' && item.project === 'deepseek-hwchat'), 'B 应当收到切项目指令');
    assert.equal(peer.service.activeProjectName(), 'deepseek-hwchat', 'B 自己的项目要真的切了');
    assert.equal(hub.service.activeProjectName(), before, 'A 本机的项目不该被改动');
  } finally {
    hub.service.dispose();
    peer.service.dispose();
    await rm(hub.dir, { recursive: true, force: true });
    await rm(peer.dir, { recursive: true, force: true });
  }
});

test('没有群时拒绝远程切项目（不会静默当成功）', async () => {
  const controls: any[] = [];
  const { service, dir } = await make(winPeer, ['a'], ['github.com/x/a'], controls);
  try {
    const result = await service.requestProjectSwitch('p-mac', 'a', '');
    assert.equal(result.ok, false);
    assert.match(result.message, /没有群/);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
