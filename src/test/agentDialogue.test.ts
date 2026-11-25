import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { MAX_DIALOGUE_NOTES, makeNote, type SyncPeer } from '../sync/lanProtocol';

/**
 * 两个 agent 真对话（用户 2026-11-24）：
 * 「没有实现两个 agent 在团队群自己沟通任务的功能，还是各干各的」。
 *
 * 要的三件事：往来可见（线程）、谁回谁有据可查、有终止条件（不许无限接龙）。
 */

const win: SyncPeer = { id: 'p-win', name: 'MagicBookV14', platform: 'win32', project: 'app', version: 't' };
const mac: SyncPeer = { id: 'p-mac', name: 'MacBook-Pro', platform: 'darwin', project: 'app', version: 't' };

async function makeService(): Promise<{ service: LanSyncService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-dialogue-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => win,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    localProjects: () => ['app'],
    localProjectRepos: () => ['github.com/acme/app'],
    log: () => undefined,
  }, { discoveryPort: 48_979 });
  await service.load();
  return { service, dir };
}

test('回队友的话会自动挂上 replyTo（线程靠事实，不靠模型自觉）', async () => {
  const { service, dir } = await makeService();
  try {
    const incoming = makeNote(mac, { body: '你那边的导出用哪个字段？', topic: 'export' }, 10, 'n1')!;
    await service.ingestRelayMessage(incoming);
    await service.shareNote({ body: '用 createdAt，镜像里已经是 ISO。', topic: 'export' });
    const notes = service.recentNotes(5);
    const reply = notes[notes.length - 1]!;
    assert.equal(reply.replyTo, incoming.id, '自动接在对方那条消息后面');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('往来会进界面状态（带统一身份标识）', async () => {
  const { service, dir } = await makeService();
  try {
    await service.ingestRelayMessage(makeNote(mac, { body: '我先做 macOS 端。', topic: 'split' }, 10, 'n1')!);
    const state = service.groupState();
    assert.equal(state.dialogue.length, 1);
    assert.equal(state.dialogue[0]!.who, 'macOS · MacBook-Pro', '用同一个 deviceLabel');
    assert.equal(state.dialogue[0]!.body, '我先做 macOS 端。');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('轮次能数出来，并有硬上限', async () => {
  const { service, dir } = await makeService();
  try {
    for (let i = 0; i < 3; i += 1) {
      await service.ingestRelayMessage(makeNote(mac, { body: `第 ${i} 条`, topic: 'loop' }, Date.now() - 1000 + i, `n${i}`)!);
    }
    assert.equal(service.dialogueRounds('loop'), 3);
    assert.equal(service.dialogueRounds('other'), 0, '按主题分开数');
    assert.ok(MAX_DIALOGUE_NOTES >= 4 && MAX_DIALOGUE_NOTES <= 12, '上限要小而明确');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('到上限就不再自动应答，把话抛回群里等甲方', () => {
  const sync = readFileSync('src/sync/lanSync.ts', 'utf8');
  assert.match(sync, /rounds > MAX_DIALOGUE_NOTES/, '要有轮次闸');
  assert.match(sync, /已经来回 \$\{rounds\} 条还没定下来/, '到顶要说清并请甲方定');
  assert.match(sync, /options: \['继续让两台讨论', '只让一台做', '先停下'\]/, '给甲方可点的选项');
  const panel = readFileSync('src/views/groupPanel.ts', 'utf8');
  assert.match(panel, /队友之间的往来/, '往来要在群窗口里看得见');
  assert.match(panel, /note\.replyTo \? '回复队友' : '队友对话'/, '要标出是不是回复');
});
