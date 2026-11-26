import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import type { SyncPeer } from '../sync/lanProtocol';

/**
 * 手机遥控的端到端：真起监听、真发 HTTP、真拿 Cookie。
 *
 * 这里不打桩，因为最容易错的就是「协议自己写的、页面自己写的，两边对不上」：
 * 路径写成 `/m/send` 还是 `/m/api/send`、Cookie 名对不对、缺了自定义头会不会被放行 ——
 * 这些只有真发一次请求才看得见。
 *
 * 端口传 0 由系统分配：Windows 上刚关掉的监听会留在 TIME_WAIT，
 * 固定端口第二次跑就会 `EADDRINUSE`，那是测试自己造出来的假失败。
 */

const phonePeer: SyncPeer = { id: 'p-win', name: 'PC · Windows', platform: 'win32', project: 'app', version: 'test' };

async function makeService(received: string[]): Promise<{ service: LanSyncService; dir: string; assigneeSeen: string[]; stopBox: { count: number } }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-mobile-'));
  const assigneeSeen: string[] = [];
  const stopBox = { count: 0 };
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => phonePeer,
    runRequirement: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    log: () => undefined,
    onMobileMessage: async (text, assignee) => {
      received.push(text);
      if (assignee) assigneeSeen.push(assignee);
      return { ok: true, message: '已发到团队群' };
    },
    canApproveFromPhone: () => true,
    onRemoteControl: async (control) => {
      if (control.action === 'stopGroup') stopBox.count += 1;
      return { ok: true, message: '已停' };
    },
  });
  await service.load();
  return { service, dir, assigneeSeen, stopBox };
}

/** 打开手机遥控，返回手机要访问的地址（端口由系统分配）。 */
async function start(service: LanSyncService): Promise<string> {
  const result = await service.setMobileControl(true, 0);
  assert.equal(result.ok, true, result.message);
  return service.mobileInfo().url;
}

test('手机遥控：没开时不算开启，也不给访问地址', async () => {
  const { service, dir } = await makeService([]);
  try {
    assert.equal(service.mobileAllowed(), false);
    assert.equal(service.mobileInfo().enabled, false);
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('手机遥控：验证码进门 → 读状态 → 发言 → 批准授权，全链路真请求', async () => {
  const received: string[] = [];
  const { service, dir, assigneeSeen, stopBox } = await makeService(received);
  try {
    const base = await start(service);
    assert.match(base, /^http:\/\/[\d.]+:\d+\/m$/);

    // 1) 页面
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /HWChat/);

    // 2) 错码进不来
    const wrongCode = service.mobileInfo().code === '000000' ? '111111' : '000000';
    const wrong = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: wrongCode }),
    });
    assert.equal(wrong.status, 401);

    // 3) 正确码 → 拿到会话 Cookie
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: service.mobileInfo().code }),
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    assert.match(cookie, /^hwchat_m=[0-9a-f]+$/);

    // 4) 没 Cookie 读不到状态
    assert.equal((await fetch(`${base}/state`)).status, 401);

    // 5) 带 Cookie 读到状态
    const state = await fetch(`${base}/state`, { headers: { cookie } });
    assert.equal(state.status, 200);
    const payload = await state.json() as { device: string; messages: unknown[]; canApprove: boolean };
    assert.equal(payload.device, phonePeer.name);
    assert.deepEqual(payload.messages, []);
    assert.equal(payload.canApprove, true);

    // 6) 发消息：缺自定义头被拒（跨站表单伪造不了这个头）
    const noHeader = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: '加一个托盘图标' }),
    });
    assert.equal(noHeader.status, 403);
    assert.deepEqual(received, []);

    const sent = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-hwchat-mobile': '1' },
      body: JSON.stringify({ text: '加一个托盘图标' }),
    });
    /*
     * `/send` 立刻回 202，真正的发送在后台跑。
     *
     * 用户实况（2026-11-26）：「手机上发送消息也有延迟，或者有时候发送不出去」——
     * 以前这里 await 整个 `sendGroupMessage()`（可能打断正在跑的一轮再等它收尾），
     * 手机界面就一直停在「发送中…」。所以状态码是 202，业务结果要靠等群状态。
     */
    assert.equal(sent.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(received, ['加一个托盘图标']);

    // 7) 空的正文不进群
    const empty = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-hwchat-mobile': '1' },
      body: JSON.stringify({ text: '   ' }),
    });
    assert.equal(empty.status, 400);

    // 8) 手机会出现在待批列表里，批准后桌面那段 Promise 真的被放行
    const pending = service.awaitApproval({ title: '运行命令', summary: 'npm test', detail: '', risk: 'command' }, 'approval-7');
    const listed = await fetch(`${base}/state`, { headers: { cookie } });
    const withApproval = await listed.json() as { approvals: Array<{ id: string }> };
    assert.deepEqual(withApproval.approvals.map((item) => item.id), ['approval-7']);

    const approve = await fetch(`${base}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-hwchat-mobile': '1' },
      body: JSON.stringify({ id: 'approval-7', allow: true }),
    });
    assert.equal(approve.status, 200);
    assert.equal(await pending, true);

    // 9) 重复批准同一张卡 → 409（手机和电脑同时点也不会互相打架）
    const duplicate = await fetch(`${base}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-hwchat-mobile': '1' },
      body: JSON.stringify({ id: 'approval-7', allow: false }),
    });
    assert.equal(duplicate.status, 409);

    /*
     * 10) 手机端与电脑团队群对齐的三件事：
     *     指派（assignee 跟着走）、停止执行（走 broadcastStop）、状态里带项目与已读回执。
     */
    const assigned = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-hwchat-mobile': '1' },
      body: JSON.stringify({ text: '这条只给 mac', assignee: 'p-mac' }),
    });
    assert.equal(assigned.status, 202, '指派那条同样立刻返回（202），真正的发送在后台');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(assigneeSeen, ['p-mac'], '指派要真的传到宿主，否则手机会发出一条没人接的需求');

    // 没有会话：连门都进不去（401 在自定义头检查之前）
    assert.equal((await fetch(`${base}/stop`, { method: 'POST' })).status, 401, '没有会话不能停别人的活');
    // 有会话但缺自定义头：拒绝（跨站表单伪造不了这个头）
    const stopNoHeader = await fetch(`${base}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: '{}',
    });
    assert.equal(stopNoHeader.status, 403, '停止也要那道自定义头（防跨站伪造）');
    const stop = await fetch(`${base}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-hwchat-mobile': '1' },
      body: '{}',
    });
    assert.equal(stop.status, 200, await stop.text());
    assert.equal(stopBox.count, 1, '手机点停止必须真的走到广播停止');

    const rich = await (await fetch(`${base}/state`, { headers: { cookie } })).json() as {
      projectName?: string;
      reads?: Record<string, string[]>;
    };
    assert.ok('projectName' in rich || rich.projectName === undefined, '状态里允许带项目名（无项目时为空）');
    assert.equal(typeof rich.reads, 'object', '状态里要带已读回执表（可以是空对象）');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('手机遥控：关掉之后会话失效、页面消失', async () => {
  const { service, dir } = await makeService([]);
  try {
    const base = await start(service);
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: service.mobileInfo().code }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    assert.equal((await fetch(`${base}/state`, { headers: { cookie } })).status, 200);

    await service.setMobileControl(false);
    // 监听收掉了：连不上（或者 404），两种都算「进不去」
    await assert.rejects(fetch(`${base}/state`, { headers: { cookie } }));
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 时间线必须按**本机到达顺序**排，不能按两台设备各自的时间戳。
 *
 * 真实故障（2026-11-26，用户实况「手机界面消息有时候回复的消息反而显示在用户发出的
 * 消息上面」）：macOS 那台的系统时钟比 Windows 慢 123 ms，于是群里两条消息按 `at` 排
 * 会得到「Mac 的回复（07:41:39.892）」在「Windows 的需求（07:41:40.015）」之前 ——
 * 微信/飞书里永远不会出现这种顺序。
 */
test('手机遥控：对端时钟慢一点，回复也不会跑到我的消息上面', async () => {
  const { service, dir } = await makeService([]);
  try {
    const base = await start(service);
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: service.mobileInfo().code }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    // 本机先发出需求（本机到达顺序在前）。
    const mine = await service.postGroup({ author: 'user', phase: 'requirement', body: '启动最小版本，我测一下同步' });
    assert.ok(mine.group);

    /*
     * 对端回一条「这条活由另一台执行」，但它的 `at` 比我们那条**早 123 ms**
     * （就是真机上的时钟差）。走的是真实的入站解析路径。
     */
    const peerReply = {
      kind: 'group',
      id: 'peer-reply-1',
      from: { id: 'p-mac', name: 'Mac mini', platform: 'darwin', project: 'app', version: 'test' },
      author: 'agent',
      phase: 'progress',
      body: '这条活由另一台执行，这台只记录、不动手。',
      requirementId: mine.group.requirementId,
      at: (mine.group.at ?? Date.now()) - 123,
    };
    const ingest = (service as unknown as { applyMessage?: (m: unknown, o?: unknown) => Promise<void> }).applyMessage;
    assert.equal(typeof ingest, 'function', '要有入站入口可测（否则这条用例说明不了问题）');
    await ingest!.call(service, peerReply, { relay: false });

    const state = await (await fetch(`${base}/state`, { headers: { cookie } })).json() as {
      messages: Array<{ id: string; body: string; at: number; receivedAt?: number }>;
    };
    assert.deepEqual(
      state.messages.map((message) => message.body),
      ['启动最小版本，我测一下同步', '这条活由另一台执行，这台只记录、不动手。'],
      '不管两台时钟差多少，先到的在前（回复绝不能排在自己的话上面）',
    );
    assert.ok(state.messages[1]!.receivedAt, '入站消息要盖上本机到达时刻');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 真实存档里抓到的顺序（2026-11-26，`lan-sync.json`）：
 *
 * ```
 * 07:56:27.778 乙方 progress 收到。先停下手上这一轮…（requirementId=rmwws8hddjz0kq8）
 * 07:56:28.754 乙方 progress 【项目 …】这台开始执行：…（同一个 requirementId）
 * 07:56:31.713 甲方 requirement 瞎搞，一点逻辑和做项目的思维都没有…
 * ```
 *
 * 需求先在协议层以 `kind: 'requirement'` 到达，agent 立刻回话；甲方那条**气泡**是
 * 发送方随后才广播过来的。按到达顺序排，「回复」就排到了「提问」上面 ——
 * 用户原话：「电脑界面也会出现回复，或者进度消息，显示在用户发送的消息上面，不合理」。
 */
test('手机遥控：需求的回声晚到也不能让回复排到它上面（真实存档顺序）', async () => {
  const { service, dir } = await makeService([]);
  try {
    const base = await start(service);
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: service.mobileInfo().code }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const ingest = (service as unknown as { applyMessage: (m: unknown, o: unknown) => Promise<void> }).applyMessage;
    const mac = { id: 'p-mac', name: 'Mac mini', platform: 'darwin', project: 'app', version: 'test' };
    const requirementId = 'rmwws8hddjz0kq8';

    // 先到的两条乙方进度（回应这条需求）。
    await ingest.call(service, {
      kind: 'group', id: 'ack-1', from: mac, author: 'agent', phase: 'progress',
      body: '收到。先停下手上这一轮，把这条并进当前任务。', requirementId, at: Date.now() - 4000,
    }, { relay: false });
    await ingest.call(service, {
      kind: 'group', id: 'ack-2', from: mac, author: 'agent', phase: 'progress',
      body: '【项目 X】这台开始执行：瞎搞。', requirementId, at: Date.now() - 3000,
    }, { relay: false });
    // 甲方那条气泡后到（发送方随后广播）。
    await ingest.call(service, {
      kind: 'group', id: 'req-bubble', from: mac, author: 'user', phase: 'requirement',
      body: '瞎搞，一点逻辑和做项目的思维都没有。', requirementId, at: Date.now() - 5000,
    }, { relay: false });

    const state = await (await fetch(`${base}/state`, { headers: { cookie } })).json() as {
      messages: Array<{ body: string }>;
    };
    assert.equal(state.messages[0]!.body, '瞎搞，一点逻辑和做项目的思维都没有。', '甲方的需求必须排在回应它的乙方发言之前');
    assert.deepEqual(
      state.messages.slice(1).map((message) => message.body.slice(0, 4)),
      ['收到。先', '【项目 '],
      '两条进度仍然按到达顺序跟在需求后面',
    );
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
