import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import type { SyncPeer } from '../sync/lanProtocol';

/**
 * 「让 Windows 切项目，它没回应，但是切换错了」（用户 2026-11-24）。
 *
 * 两个原因：
 *  1. 「切换到这个项目」那个按钮传的是**仓库地址**，被当成项目名存了下来，
 *     界面于是显示成 `github.com/gsaecy/plaitcode`，看起来就像切错了；
 *  2. 切换本身不在群里说一声，所以「它没回应」。
 */

const LOCAL_PROJECTS = ['deepseek-hwchat', 'Personal-Workstation-OS'];
const LOCAL_REPOS = ['github.com/gsaecy/plaitcode', 'github.com/gsaecy/personal-workstation-os'];

async function makeService(): Promise<{ service: LanSyncService; dir: string; group: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-switch-'));
  const group: string[] = [];
  const peer: SyncPeer = { id: 'p-win', name: 'MagicBookV14 · win32', platform: 'win32', project: 'deepseek-hwchat', version: 't' };
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => peer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    localProjects: () => LOCAL_PROJECTS,
    localProjectRepos: () => LOCAL_REPOS,
    onGroupMessage: async (message) => { group.push(String(message.body)); },
    log: () => undefined,
  }, { discoveryPort: 48_970 });
  await service.load();
  return { service, dir, group };
}

test('传仓库地址时换成对应的文件夹名，不会把仓库地址当项目名', async () => {
  const { service, dir } = await makeService();
  try {
    await service.setCollabProject('github.com/gsaecy/personal-workstation-os');
    assert.equal(service.currentProject(), 'Personal-Workstation-OS', '要换成文件夹名');
    assert.equal(service.currentRepo(), 'github.com/gsaecy/personal-workstation-os');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('本机没有那个仓库时不切换（避免"看起来切过去了实际没目录"）', async () => {
  const { service, dir } = await makeService();
  try {
    await service.setCollabProject('deepseek-hwchat', 'github.com/gsaecy/plaitcode');
    await service.setCollabProject('github.com/acme/unknown-repo');
    assert.equal(service.currentRepo(), 'github.com/gsaecy/plaitcode', '不该被切到不存在的仓库');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('无法识别的项目名直接忽略，不会切到不存在的文件夹', async () => {
  const { service, dir } = await makeService();
  try {
    await service.setCollabProject('deepseek-hwchat');
    await service.setCollabProject('plaitcode');
    assert.equal(service.currentProject(), 'deepseek-hwchat', '「plaitcode」不是本机文件夹，应当忽略');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('切换在群里一定有回执（不再"它没回应"）', async () => {
  const { service, dir, group } = await makeService();
  try {
    // 先开一个群，才有"群里回执"这回事。
    await service.startHub(48_381).catch(() => ({ ok: false }));
    await service.setCollabProject('github.com/gsaecy/personal-workstation-os');
    assert.ok(
      group.some((body) => body.includes('已切到')),
      `群里应当有回执，实际：${JSON.stringify(group)}`,
    );
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('项目选择会落盘，重新打开还是同一个（否则"切换无效"）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-persist-'));
  const peer: SyncPeer = { id: 'p-win', name: 'PC', platform: 'win32', project: 'deepseek-hwchat', version: 't' };
  const make = (): LanSyncService => new LanSyncService(join(dir, 'state.json'), {
    peer: () => peer,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    localProjects: () => LOCAL_PROJECTS,
    localProjectRepos: () => LOCAL_REPOS,
    log: () => undefined,
  }, { discoveryPort: 48_971 });

  try {
    const first = make();
    await first.load();
    await first.setCollabProject('Personal-Workstation-OS', 'github.com/gsaecy/personal-workstation-os');
    first.dispose();

    const second = make();
    await second.load();
    assert.equal(second.activeProjectName(), 'Personal-Workstation-OS', '重载后仍然是选过的项目');
    assert.equal(second.currentRepo(), 'github.com/gsaecy/personal-workstation-os');
    second.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('存坏的项目名（仓库地址）读回来会自愈成文件夹名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-repair-'));
  const peer: SyncPeer = { id: 'p-win', name: 'PC', platform: 'win32', project: 'deepseek-hwchat', version: 't' };
  try {
    // 模拟旧版本写坏的记录：项目名里是仓库地址。
    await writeFile(join(dir, 'state.json'), JSON.stringify({
      pairingCode: 'AAAA-BBBB',
      requirements: [],
      reports: [],
      collabProject: 'github.com/gsaecy/plaitcode',
    }), 'utf8');
    const service = new LanSyncService(join(dir, 'state.json'), {
      peer: () => peer,
      runRequirement: async () => true,
      runNote: async () => true,
      writeLedger: async () => undefined,
      writeTranscript: async () => undefined,
      localProjects: () => LOCAL_PROJECTS,
      localProjectRepos: () => LOCAL_REPOS,
      log: () => undefined,
    }, { discoveryPort: 48_972 });
    await service.load();
    assert.equal(service.activeProjectName(), 'deepseek-hwchat', '仓库地址应当被还原成对应的文件夹名');
    service.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
