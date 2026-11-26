import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { makeNote, type SyncNote, type SyncPeer } from '../sync/lanProtocol';

/**
 * 「Windows 收不到 macOS 的回复」—— 2026-11-26 的真身。
 *
 * 现场日志（`HWChat.log`，00:06 → 08:01，逐条可查）：Windows 这台收到 **14 条**队友消息，
 * 每一条都先记了「队友消息（郭宏宇的Mac mini）：…」，紧接着一行
 * 「面板正忙，队友消息已记录（team_sync status 可查看）」。
 *
 * 也就是说：消息**到网了**、落库了，但 `runNote()` 因为「本机正在跑」返回 false，
 * 而旧实现**只写了一行日志就把它扔了**，没有任何重试 —— 用户看到的就是
 * 「Windows 问的问题 macOS 秒回，Windows 却毫无反应」。
 */

const me: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 'test' };
const mac: SyncPeer = { id: 'p-mac', name: '郭宏宇的Mac mini', platform: 'darwin', project: 'app', version: 'test' };

async function makeService(options: { busy: boolean }): Promise<{
  service: LanSyncService;
  dir: string;
  delivered: SyncNote[];
  setBusy: (busy: boolean) => void;
  ingest: (note: SyncNote) => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-notes-'));
  const delivered: SyncNote[] = [];
  let busy = options.busy;
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    runRequirement: async () => true,
    // 面板正忙时返回 false —— 和真实的 `chat.runSyncNote()` 一样。
    runNote: async (note) => {
      if (busy) return false;
      delivered.push(note);
      return true;
    },
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  const ingest = async (note: SyncNote): Promise<void> => {
    await (service as unknown as { applyMessage: (m: unknown, o: unknown) => Promise<void> })
      .applyMessage(note, { relay: false });
  };
  return { service, dir, delivered, setBusy: (value) => { busy = value; }, ingest };
}

test('面板正忙时收到的队友消息会排队，空下来立刻交付（不再丢）', async () => {
  const { service, dir, delivered, setBusy, ingest } = await makeService({ busy: true });
  try {
    const note = makeNote(mac, { body: '先答你那四点，再给你我的方案，请你一句话确认。' }, 1_000)!;
    await ingest(note);

    assert.deepEqual(delivered, [], '忙的时候交付不了');
    assert.equal(service.pendingNoteCount(), 1, '但**必须**留在队列里，而不是只写一行日志就扔');

    // 这一轮跑完了：面板主动 flush（`chatPanel` 在 run 结束时就会这么调）。
    setBusy(false);
    const flushed = await service.flushPendingNotes();
    assert.equal(flushed, 1);
    assert.deepEqual(delivered.map((item: SyncNote) => item.body), [note.body]);
    assert.equal(service.pendingNoteCount(), 0, '交付成功就出队');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('排队不重复：同一条消息到达两次只交付一次', async () => {
  const { service, dir, delivered, setBusy, ingest } = await makeService({ busy: true });
  try {
    const note = makeNote(mac, { body: '这条会到达两次（主机转发 + 直连）。' }, 2_000)!;
    await ingest(note);
    await ingest(note);
    assert.equal(service.pendingNoteCount(), 1);
    setBusy(false);
    await service.flushPendingNotes();
    assert.equal(delivered.length, 1);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 「@某个 agent」是**唯一**的可见性闸门（用户 2026-11-26 的原话）。
 *
 * 点名给别的设备 → 本机不接（也不该把本机叫醒）；没点名 → 群里每一台都要看。
 */
test('@ 是唯一的闸门：点名给别人时不叫醒本机，没点名就都看', async () => {
  const { service, dir, delivered, ingest } = await makeService({ busy: false });
  try {
    await ingest(makeNote(mac, { body: '问 mac 一个问题：你那端的版本是多少？', to: 'p-mac' }, 3_000)!);
    assert.deepEqual(delivered, [], '点名给 p-mac 的消息不该叫醒 p-win');

    await ingest(makeNote(mac, { body: '问你们两台一个问题：版本多少？' }, 4_000)!);
    assert.equal(delivered.length, 1, '没点名 → 本机也要读');

    await ingest(makeNote(mac, { body: '问 Windows 一个问题：你那端版本多少？', to: 'p-win' }, 5_000)!);
    assert.equal(delivered.length, 2, '点名给本机 → 当然要读');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 队友之间说的话必须在群时间线里能看见（手机 / 电脑都要）。
 *
 * 以前这些只躺在 `notes` 里，只有 `team_sync status` 看得到 ——
 * 甲方完全不知道两个 agent 谈了什么。
 */
test('队友往来进了群时间线：手机也能看到谁跟谁在说什么', async () => {
  const { service, dir, ingest } = await makeService({ busy: false });
  try {
    await ingest(makeNote(mac, { body: '我这边先把服务器改了，你只改客户端。', topic: 'sync' }, 6_000)!);
    const state = service.mobileState();
    const dialogue = state.dialogue ?? [];
    assert.equal(dialogue.length, 1);
    assert.match(dialogue[0]!.who, /郭宏宇的Mac mini/);
    assert.match(dialogue[0]!.body, /我这边先把服务器改了/);
    assert.ok(dialogue[0]!.receivedAt, '要带到达时刻，手机端才能按时间线排');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('已读回执翻成名字：手机上不再出现设备 id', async () => {
  const { service, dir } = await makeService({ busy: false });
  try {
    const posted = await service.postGroup({ author: 'user', phase: 'requirement', body: '两台都看一下' });
    assert.ok(posted.group);
    const state = service.mobileState();
    const labels = state.reads?.[posted.group.id] ?? [];
    assert.ok(labels.length >= 1, '本机读到了就该有回执');
    for (const label of labels) {
      assert.doesNotMatch(label, /^p-(win|mac)$/, `回执里不能再是设备 id：${label}`);
      assert.match(label, /本机|MAGICBOOKV14/, '要给人看得懂的名字');
    }
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
