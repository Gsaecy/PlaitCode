import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { makeNote, type SyncNote, type SyncPeer } from '../sync/lanProtocol';

/**
 * 用户 2026-11-26：「团队群的停止执行按钮，点击后群里的 agent 并没有停止」。
 *
 * 复核出两条会让「停止」失效的真实路径，都在这里钉住：
 *  1. **收端信任判据太窄**：`stopGroup` 以前要求来源在 `approved` 里（用户点过「允许」）。
 *     能走到那一步的消息**已经带过配对凭据**，凭据本身就是身份；两台自动连上或重装扩展后
 *     `approved` 是空的，于是停止被静默忽略 —— 甲方看到的就是「按了没反应」。
 *  2. **停止后又被排队的队友消息重新开跑**：停止只是 abort 当前轮，轮末
 *     `flushPendingNotes()` 把排队的队友消息交回 agent → 立刻再开一轮。
 *     现在停止会清空队列并**暂停交付**，直到甲方重新发话。
 */

const me: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 'test' };
const mac: SyncPeer = { id: 'p-mac', name: 'Mac mini', platform: 'darwin', project: 'app', version: 'test' };

test('停止执行：网络上传来的 stopGroup 不再被「未批准」挡掉', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-stop-'));
  const stopped: string[] = [];
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    runRequirement: async () => true,
    runNote: async () => true,
    onRemoteControl: async (control) => {
      stopped.push(control.action);
      return { ok: true, message: '这台已停止执行' };
    },
    canApproveFromPhone: () => false,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  try {
    // 注意：这里**没有**把 mac 加进 approved（= 自动连接 / 刚重装扩展的状态）。
    await service.ingestRelayMessage({
      kind: 'control',
      id: 'ctl-1',
      from: mac,
      action: 'stopGroup',
      at: Date.now(),
    });
    assert.deepEqual(stopped, ['stopGroup'], '凭据校验通过的对端必须能让本机停手');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('停止后队友消息只记录不交付；甲方重新发话才恢复', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-hold-'));
  const delivered: string[] = [];
  let busy = true;
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => me,
    runRequirement: async () => true,
    // 面板忙 → 返回 false → 进排队队列（真实 `chat.runSyncNote()` 的行为）。
    runNote: async (note: SyncNote) => {
      if (busy) return false;
      delivered.push(note.id);
      return true;
    },
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  try {
    const shared = await service.shareRequirement('改一个文件', undefined, []);
    const requirementId = shared.requirement!.id;

    // 队友消息在「面板忙」时到达 → 排队。
    const queued = makeNote(mac, { topic: 't', body: '你那边文件上限多少？', replyTo: '' });
    assert.ok(queued);
    await service.ingestRelayMessage(queued);
    assert.equal(service.pendingNoteCount(), 1, '忙时应当排队（不能丢）');

    // 甲方按「停止执行」：队列清空 + 闸门关闭。
    const dropped = service.holdNoteDelivery('团队群停止执行');
    assert.equal(dropped, 1);
    assert.equal(service.pendingNoteCount(), 0, '停止要清掉排队消息');
    assert.equal(service.notesHeldForStop(), true);

    // 轮末 flush 不能把工作又启动起来。
    busy = false;
    assert.equal(await service.flushPendingNotes(), 0);
    assert.deepEqual(delivered, [], '停止之后不许再自动开跑');

    // 停止期间新到的队友消息：只记录，不交付。
    const late = makeNote(mac, { topic: 't2', body: '收到停止，那还继续吗？', replyTo: '' });
    assert.ok(late);
    await service.ingestRelayMessage(late);
    assert.deepEqual(delivered, [], '闸门关着时新消息也不该叫醒 agent');

    // 甲方重新发话 → 恢复交付；之后再来的消息正常交付。
    service.resumeNoteDelivery();
    assert.equal(service.notesHeldForStop(), false);
    const after = makeNote(mac, { topic: 't3', body: '继续吧', replyTo: '' });
    assert.ok(after);
    await service.ingestRelayMessage(after);
    assert.deepEqual(delivered, [after.id], '恢复后要能继续协作');
    void requirementId;
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('面板侧：停止团队任务必须**先关闸门再 abort**（顺序反了就会立刻重启一轮）', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/views/chatPanel.ts', 'utf8');
  const start = source.indexOf('async stopTeamTask(');
  assert.ok(start > 0);
  const body = source.slice(start, start + 1_400);
  const hold = body.indexOf('holdNoteDelivery');
  const abort = body.indexOf('run.controller.abort()');
  assert.ok(hold > 0, '停止时要关掉队友消息交付闸门');
  assert.ok(abort > 0, '当然还要 abort 当前这一轮');
  assert.ok(hold < abort, '必须先关闸门再 abort：abort 之后这一轮会在收尾里 flush 队列');
});
