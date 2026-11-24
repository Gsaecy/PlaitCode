/**
 * 跨网审批与远程控制。
 *
 * 真机踩到的坑：agent 在电脑上跑起来后卡在「允许读取文件？」，而人已经在手机上 ——
 * 如果手机不能批准、不能改权限档位，这个功能就等于必须有人守着电脑。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { makeGroupMessage, type SyncPeer } from '../sync/lanProtocol';

const PC: SyncPeer = { id: 'dev-pc', name: '家里电脑', platform: 'win32', project: 'app', version: '0.10' };
const PHONE: SyncPeer = { id: 'dev-phone', name: '手机 · 浏览器', platform: 'android' as never, project: 'mobile', version: 'web' };

async function makeService(options: {
  allowPhone?: boolean;
  onRemoteControl?: (control: { action: string; preset?: string; steps?: number }) => Promise<{ ok: boolean; message: string }>;
} = {}): Promise<{ service: LanSyncService; sent: Array<Record<string, unknown>>; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-approval-'));
  const sent: Array<Record<string, unknown>> = [];
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => PC,
    runRequirement: async () => true,
    runNote: async () => true,
    canApproveFromPhone: () => options.allowPhone !== false,
    onOutgoing: (message) => { sent.push(message as unknown as Record<string, unknown>); },
    onRemoteControl: options.onRemoteControl,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
  });
  await service.load();
  return { service, sent, dir };
}

test('授权卡会经中继广播出去；手机的决定能结算它', async () => {
  const { service, sent, dir } = await makeService();
  try {
    const pending = service.awaitApproval({ title: '允许读取文件？', summary: 'list_directory', detail: '', risk: 'read' }, 'approval-1');
    const request = sent.find((item) => item.kind === 'approval');
    assert.ok(request, '必须广播一条 approval 请求，否则手机看不到');
    assert.equal(request!.phase, 'request');
    assert.equal(request!.title, '允许读取文件？');
    const wireId = String(request!.id);
    assert.ok(wireId.endsWith('approval-1'), '线上 id 保留可读后缀');
    assert.ok(wireId.includes(PC.id.slice(0, 8)), '线上 id 带设备前缀，防止两台电脑互相销卡');

    // 手机点「允许」：把决定送回电脑
    await service.ingestRelayMessage({
      kind: 'approval',
      id: wireId,
      from: PHONE,
      phase: 'decision',
      title: '',
      summary: '',
      detail: '',
      risk: 'read',
      allow: true,
      at: Date.now(),
    });
    assert.equal(await pending, true, '手机批准后工具线程要被放行');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('别的设备名下的卡不会被本机结算', async () => {
  const { service, dir } = await makeService();
  try {
    const pending = service.awaitApproval({ title: 'x', summary: 'y', detail: '', risk: 'read' }, 'approval-2');
    await service.ingestRelayMessage({
      kind: 'approval',
      id: 'other-device:approval-2',
      from: PHONE,
      phase: 'decision',
      title: '',
      summary: '',
      detail: '',
      risk: 'read',
      allow: true,
      at: Date.now(),
    });
    // 没有立刻变 true：这张卡仍挂着（会被 3 分钟超时收掉）
    assert.equal(service.pendingApprovalCount(), 1);
    service.resolveApproval('approval-2', false);
    assert.equal(await pending, false);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('远程控制：改权限档位 / 改步数 / 中止，都会交给上层处理', async () => {
  const applied: string[] = [];
  const { service, dir } = await makeService({
    onRemoteControl: async (control) => {
      applied.push(`${control.action}:${control.preset ?? control.steps ?? ''}`);
      return { ok: true, message: 'ok' };
    },
  });
  try {
    const send = (payload: Record<string, unknown>): Promise<void> => service.ingestRelayMessage({
      kind: 'control',
      id: `c-${Math.random().toString(36).slice(2)}`,
      from: PHONE,
      at: Date.now(),
      ...payload,
    } as never);

    await send({ action: 'preset', preset: 'autopilot' });
    await send({ action: 'steps', steps: 48 });
    await send({ action: 'stop' });
    await send({ action: 'state' });
    assert.deepEqual(applied, ['preset:autopilot', 'steps:48', 'stop:', 'state:']);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('没允许手机操作时，远程控制一律忽略（权限边界不放松）', async () => {
  const applied: string[] = [];
  const { service, dir } = await makeService({
    allowPhone: false,
    onRemoteControl: async (control) => {
      applied.push(control.action);
      return { ok: true, message: 'ok' };
    },
  });
  try {
    await service.ingestRelayMessage({
      kind: 'control',
      id: 'c1',
      from: PHONE,
      action: 'preset',
      preset: 'full',
      at: Date.now(),
    } as never);
    assert.deepEqual(applied, [], '关掉手机操作后，手机不能改电脑的权限');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('控制指令不会被当成群消息写进看板', async () => {
  const { service, dir } = await makeService({ onRemoteControl: async () => ({ ok: true, message: '' }) });
  try {
    await service.ingestRelayMessage({
      kind: 'control',
      id: 'c9',
      from: PHONE,
      action: 'preset',
      preset: 'review',
      at: Date.now(),
    } as never);
    assert.equal(service.groupState().messages.length, 0, '控制指令不是项目讨论');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('广播状态：手机据此显示电脑真实生效的档位', async () => {
  const { service, sent, dir } = await makeService();
  try {
    service.broadcastControl({ preset: 'autopilot', steps: 24, running: true });
    const state = sent.filter((item) => item.kind === 'control').at(-1);
    assert.ok(state);
    assert.equal(state!.action, 'state');
    assert.equal(state!.preset, 'autopilot');
    assert.equal(state!.steps, 24);
    assert.equal(state!.running, true);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('群消息里出现"未执行"阶段时，看板不会把它算成完成', async () => {
  const { service, dir } = await makeService();
  try {
    const requirement = makeGroupMessage(PHONE, {
      author: 'user', phase: 'requirement', body: '改按钮', requirementId: 'r1',
    }, 1_000, 'a')!;
    const blocked = makeGroupMessage(PC, {
      author: 'agent', phase: 'blocked', body: '没配 API Key', requirementId: 'r1',
    }, 2_000, 'b')!;
    await service.ingestRelayMessage(requirement);
    await service.ingestRelayMessage(blocked);
    const messages = service.groupState().messages;
    assert.equal(messages.at(-1)?.phase, 'blocked', 'blocked 阶段必须能通过协议校验并被记录');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
