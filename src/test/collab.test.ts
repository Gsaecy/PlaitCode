import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { DeviceFlow } from '../sync/relayDeviceFlow';
import { HandoffStore } from '../sync/relayHandoff';
import { createHandoffKeyPair, openFromDevice, sealForDevice } from '../sync/handoffCrypto';
import { buildGitHubAuthorizeUrl, exchangeGitHubCode } from '../sync/relayGitHub';
import { quickStart } from '../sync/collabSetup';
import { handoffRound, registerHandoffKey } from '../sync/handoffClient';
import { deriveKeys } from '../sync/relayCrypto';
import { createRelayServer } from '../sync/relayServer';
import { addDevice, addMember, addOrg, emptyIdentity } from '../sync/relayIdentity';

/**
 * 「同一个 GitHub 账号，多台设备自动协作」这条链路。
 *
 * 这里最该钉死的三件事：
 *  1. 频道密钥只走**设备间加密包**，中继拿到的只有密文；
 *  2. 登录码一次性、会过期，不能被重复领取；
 *  3. 第二台设备能自动拿到密钥，而不是卡在等。
 */

test('交接加密：来回能解开；第三方私钥解不开；改一个字节就失败', () => {
  const alice = createHandoffKeyPair();
  const bob = createHandoffKeyPair();
  const eve = createHandoffKeyPair();
  const payload = { url: 'https://relay.example.com', secret: 'x'.repeat(32) };

  const envelope = sealForDevice(alice.privateKey, bob.publicKey, payload);
  assert.deepEqual(openFromDevice(bob.privateKey, alice.publicKey, envelope), payload);

  // 第三方拿着自己的私钥 + 发送方公钥：算不出同一个共享密钥
  assert.equal(openFromDevice(eve.privateKey, alice.publicKey, envelope), undefined);

  const raw = Buffer.from(envelope.ct, 'base64');
  raw[0] = raw[0]! ^ 0xff;
  assert.equal(openFromDevice(bob.privateKey, alice.publicKey, { iv: envelope.iv, ct: raw.toString('base64') }), undefined);
  // nonce 被换掉也解不开
  assert.equal(
    openFromDevice(bob.privateKey, alice.publicKey, { iv: Buffer.alloc(12).toString('base64'), ct: envelope.ct }),
    undefined,
  );
  assert.equal(Buffer.from(alice.publicKey, 'base64').length, 32);
  // 每次生成的密钥对不同
  assert.notEqual(createHandoffKeyPair().publicKey, createHandoffKeyPair().publicKey);
});

test('登录码：格式可读、能绑定、取走即失效、过期即失效', () => {
  let now = 1_000_000;
  const flow = new DeviceFlow({ ttlMs: 60_000, now: () => now });
  const started = flow.start({ deviceName: '公司电脑', platform: 'win32' });
  assert.match(started.code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

  assert.deepEqual(flow.poll(started.code), { status: 'pending', deviceName: '公司电脑' });

  const result = {
    token: 'tok_1',
    deviceId: 'dev_1',
    memberId: 'mem_1',
    memberName: '我',
    orgId: 'org_1',
    orgName: 'acme',
    grants: [],
  };
  assert.equal(flow.bind(started.code, result), true);
  // 同一个码不能绑两次
  assert.equal(flow.bind(started.code, { ...result, token: 'tok_2' }), false);

  const polled = flow.poll(started.code);
  assert.equal(polled.status, 'ready');
  assert.equal(polled.result?.token, 'tok_1');
  // 取走即失效
  assert.equal(flow.poll(started.code).status, 'expired');

  const second = flow.start({});
  now += 61_000;
  assert.equal(flow.poll(second.code).status, 'expired');
});

test('登录码：用户大小写/空格粘贴也能认出来', () => {
  const flow = new DeviceFlow();
  const started = flow.start({});
  const messy = ` ${started.code.toLowerCase().replace('-', ' ')} `;
  assert.equal(flow.bind(messy, {
    token: 't', deviceId: 'd', memberId: 'm', memberName: 'n', orgId: 'o', orgName: 'g', grants: [],
  }), true);
});

test('交接槽：存取一次即删、超限拒收、过期自动清', () => {
  let now = 5_000_000;
  const store = new HandoffStore({ ttlMs: 60_000, maxBytes: 2048, now: () => now });
  const base = { fromDeviceId: 'a', toDeviceId: 'b', iv: 'aaa', ct: 'bbb', at: now };

  assert.equal(store.put(base).ok, true);
  assert.equal(store.has('b'), true);
  assert.deepEqual(store.take('b'), { ...base, at: now });
  assert.equal(store.has('b'), false);
  assert.equal(store.take('b'), undefined);

  const huge = { ...base, ct: 'x'.repeat(4000) };
  assert.equal(store.put(huge).ok, false);

  store.put(base);
  now += 61_000;
  assert.equal(store.has('b'), false);
});

test('GitHub 授权地址：带 client_id / redirect_uri / 只读用户资料', () => {
  const url = new URL(buildGitHubAuthorizeUrl({
    clientId: 'cid',
    clientSecret: 'sec',
    redirectUri: 'https://relay.example.com/v1/auth/github/callback',
  }, 'state-123'));
  assert.equal(url.host, 'github.com');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('scope'), 'read:user');
  assert.equal(url.searchParams.get('state'), 'state-123');
});

test('GitHub 换身份：用数字 id 认人；token 或用户信息失败都要说清原因', async () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'gho_x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer gho_x');
    return new Response(JSON.stringify({ id: 42, login: 'gsaecy', name: 'Gsaecy' }), { status: 200 });
  }) as unknown as typeof fetch;

  const ok = await exchangeGitHubCode(
    { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x/cb' },
    'code',
    fakeFetch,
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.identity.githubId, '42');
    assert.equal(ok.identity.login, 'gsaecy');
    assert.equal(ok.identity.name, 'Gsaecy');
  }
  assert.equal(calls.length, 2);

  const denied = await exchangeGitHubCode(
    { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x/cb' },
    'code',
    (async () => new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 })) as unknown as typeof fetch,
  );
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.error, /bad_verification_code/);
});

/** 一个只够 quickStart 用的假中继：记住令牌与已认领频道。 */
function fakeRelay(options: { existingSecret?: string; linkedGithub?: boolean; revoked?: boolean } = {}) {
  const state = { claimed: [] as string[], pubkeys: [] as string[], handoffs: [] as Array<{ toDeviceId: string }>, logins: 0 };
  const oldDevice = createHandoffKeyPair();
  const newDevice = createHandoffKeyPair();
  const existingSecret = options.existingSecret ?? '';
  const existingChannel = existingSecret ? deriveKeys(existingSecret).channel : '';
  // 默认：旧令牌是有效的 GitHub 登录留下的
  const linkedGithub = options.linkedGithub !== false;
  const revoked = options.revoked === true;
  let logins = 0;
  let polls = 0;
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.pathname === '/v1/auth/device/start') {
      logins += 1;
      state.logins = logins;
      return json({ ok: true, code: 'ABCD-EFGH', expiresIn: 600, verifyUrl: `${url.origin}/v1/auth/github/start?device=ABCD-EFGH` });
    }
    if (url.pathname === '/v1/auth/device/poll') {
      logins += 1;
      // 第二轮才「登录完成」，模拟用户真的去浏览器点了一次
      if (logins < 2) return json({ ok: true, status: 'pending' });
      return json({
        ok: true,
        status: 'ready',
        token: 'tok_new',
        deviceId: 'dev_new',
        memberId: 'mem_1',
        memberName: '我',
        orgId: 'org_1',
        orgName: 'acme',
        // 第二台设备：账号里已经有一条频道授权，但本机没有密钥
        grants: existingChannel ? [{ channelId: existingChannel, role: 'member' }] : [],
      });
    }
    if (url.pathname === '/v1/channels/claim') {
      state.claimed.push(String(body.channelId));
      return json({ ok: true, grants: [] });
    }
    if (url.pathname === '/v1/devices/pubkey') {
      state.pubkeys.push(String(body.pubkey));
      return json({ ok: true, needsKey: body.needsKey === true });
    }
    if (url.pathname === '/v1/devices/me') {
      if (revoked) return json({ ok: false, error: 'relay says no' }, 403);
      return json({
        ok: true,
        deviceId: 'dev_new',
        deviceName: 'macOS 版',
        memberId: 'mem_1',
        memberName: '我',
        // 有这一项才代表「这台设备确实用 GitHub 登录过」
        ...(linkedGithub ? { githubId: '424242', githubLogin: 'gsaecy' } : {}),
        orgId: 'org_1',
        orgName: 'acme',
        grants: existingChannel ? [{ channelId: existingChannel, role: 'member' }] : [],
        needsKey: Boolean(existingChannel),
      });
    }
    if (url.pathname === '/v1/handoff') {
      if (init?.method === 'POST') {
        if (body.done) return json({ ok: true });
        state.handoffs.push({ toDeviceId: String(body.toDeviceId) });
        return json({ ok: true });
      }
      polls += 1;
      // 第一次查还没有包（老设备还没处理），从第二次起给一个真实加密好的包
      if (polls < 2) return json({ ok: true, peers: [], needsKey: true });
      const sealed = sealForDevice(oldDevice.privateKey, newDevice.publicKey, {
        url: url.origin,
        secret: existingSecret,
      });
      return json({
        ok: true,
        incoming: {
          fromDeviceId: 'dev_old',
          toDeviceId: 'dev_new',
          iv: sealed.iv,
          ct: sealed.ct,
          at: Date.now(),
          fromPubkey: oldDevice.publicKey,
        },
        peers: [],
        needsKey: true,
      });
    }
    return json({ ok: false, error: `unexpected ${url.pathname}` }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, state, newDevice, oldDevice };
}

const noSleep = async (): Promise<void> => undefined;

test('开始协作：第一台设备登录后自己建频道并登记公钥', async () => {
  const relay = fakeRelay();
  const opened: string[] = [];
  const result = await quickStart({
    relayUrl: 'https://relay.example.com',
    deviceName: 'Windows 版',
    platform: 'win32',
    keyPair: relay.newDevice,
    fetchImpl: relay.fetchImpl,
    sleep: noSleep,
    openUrl: (url) => { opened.push(url); },
    loginTimeoutMs: 30_000,
  });
  assert.equal(result.ok, true);
  assert.ok(result.token);
  assert.ok(result.secret);
  // 打开了浏览器让用户去登录
  assert.equal(opened.length, 1);
  assert.match(opened[0]!, /device=ABCD-EFGH/);
  // 认领的正是这把密钥派生出来的频道
  assert.deepEqual(relay.state.claimed, [deriveKeys(result.secret!).channel]);
  // 公钥登记了
  assert.equal(relay.state.pubkeys.length, 1);
});

test('开始协作：第二台设备等老设备把密钥加密送过来后自动接上', async () => {
  const secret = 'k'.repeat(32);
  const relay = fakeRelay({ existingSecret: secret });

  const result = await quickStart({
    relayUrl: 'https://relay.example.com',
    deviceName: 'macOS 版',
    platform: 'darwin',
    keyPair: relay.newDevice,
    existingToken: 'tok_old',
    fetchImpl: relay.fetchImpl,
    sleep: noSleep,
    loginTimeoutMs: 30_000,
    handoffTimeoutMs: 30_000,
  });
  assert.equal(result.ok, true);
  // 拿到的是老设备那份密钥，而不是自己新造的
  assert.equal(result.secret, secret);
  assert.equal(result.channelId, deriveKeys(secret).channel);
});

test('开始协作：旧令牌没有关联 GitHub（或已失效）时，重新弹浏览器登录', async () => {
  // 场景一：早期用管理员发的令牌登记过，没走过 GitHub
  const unlinked = fakeRelay({ linkedGithub: false });
  const opened: string[] = [];
  const first = await quickStart({
    relayUrl: 'https://relay.example.com',
    deviceName: 'Windows 版',
    platform: 'win32',
    keyPair: unlinked.newDevice,
    existingToken: 'tok_from_admin',
    fetchImpl: unlinked.fetchImpl,
    sleep: noSleep,
    openUrl: (url) => { opened.push(url); },
    loginTimeoutMs: 30_000,
  });
  assert.equal(first.ok, true);
  // 必须真的又走了一次登录（用户点了按钮就该看到浏览器）
  assert.equal(opened.length, 1);
  assert.equal(unlinked.state.logins, 1);

  // 场景二：令牌被吊销 → 同样重新登录
  const revokedRelay = fakeRelay({ revoked: true });
  const openedAgain: string[] = [];
  const second = await quickStart({
    relayUrl: 'https://relay.example.com',
    deviceName: 'Mac',
    platform: 'darwin',
    keyPair: revokedRelay.newDevice,
    existingToken: 'tok_revoked',
    fetchImpl: revokedRelay.fetchImpl,
    sleep: noSleep,
    openUrl: (url) => { openedAgain.push(url); },
    loginTimeoutMs: 30_000,
  });
  assert.equal(second.ok, true);
  assert.equal(openedAgain.length, 1);
});

test('开始协作：已用 GitHub 登录过的设备重跑，不再弹浏览器', async () => {
  const secret = 'm'.repeat(32);
  const relay = fakeRelay({ existingSecret: secret });
  const opened: string[] = [];
  const result = await quickStart({
    relayUrl: 'https://relay.example.com',
    deviceName: 'Windows 版',
    platform: 'win32',
    keyPair: relay.newDevice,
    existingSecret: secret,
    existingToken: 'tok_valid',
    fetchImpl: relay.fetchImpl,
    sleep: noSleep,
    openUrl: (url) => { opened.push(url); },
    loginTimeoutMs: 5_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.secret, secret);
  // 令牌有效且已经关联 GitHub：直接复用，不打扰用户
  assert.equal(opened.length, 0);
  assert.equal(relay.state.logins, 0);
});

test('交接客户端：拿到包就认账；本机有密钥时主动投给在等的设备', async () => {
  const mine = createHandoffKeyPair();
  const peer = createHandoffKeyPair();
  const sealed = sealForDevice(peer.privateKey, mine.publicKey, { url: 'https://relay.example.com', secret: 's'.repeat(32) });
  const posted: Array<Record<string, unknown>> = [];
  let doneCalled = false;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (init?.method === 'POST') {
      if (body.done) doneCalled = true;
      else posted.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ok: true,
      incoming: { fromDeviceId: 'dev_peer', toDeviceId: 'dev_me', iv: sealed.iv, ct: sealed.ct, at: 1, fromPubkey: peer.publicKey },
      peers: [{ deviceId: 'dev_later', name: '新电脑', platform: 'linux', pubkey: peer.publicKey }],
      needsKey: true,
    }), { status: 200 });
  }) as unknown as typeof fetch;

  const round = await handoffRound({
    url: 'https://relay.example.com',
    token: 't',
    keyPair: mine,
    fetchImpl,
  });
  assert.equal(round.adopted?.secret, 's'.repeat(32));
  assert.equal(doneCalled, true);
  // 拿到密钥之后顺手给在等的那台也递一份
  assert.equal(round.delivered, 1);
  assert.equal(posted[0]!.toDeviceId, 'dev_later');
  assert.ok(typeof posted[0]!.iv === 'string' && typeof posted[0]!.ct === 'string');
});

test('登记公钥：失败不抛错，只返回 false', async () => {
  const ok = await registerHandoffKey({
    url: 'https://relay.example.com',
    token: 't',
    keyPair: createHandoffKeyPair(),
    needsKey: true,
    fetchImpl: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
  });
  assert.equal(ok, false);
  const boom = await registerHandoffKey({
    url: 'https://relay.example.com',
    token: 't',
    keyPair: createHandoffKeyPair(),
    needsKey: true,
    fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch,
  });
  assert.equal(boom, false);
});

/* ---------------- 服务端：同一个 GitHub 账号的两台设备 ---------------- */

/** 假 GitHub：换 token 与取用户信息就够。 */
async function fakeGitHub(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    const send = (body: unknown): void => {
      const payload = JSON.stringify(body);
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
      response.end(payload);
    };
    if (url.startsWith('/login/oauth/access_token')) {
      send({ access_token: 'gho_test', token_type: 'bearer', scope: 'read:user' });
      return;
    }
    if (url.startsWith('/user')) {
      send({ id: 424242, login: 'gsaecy', name: 'Gsaecy', email: 'me@example.com' });
      return;
    }
    send({ message: 'not found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}

test('服务端：两台设备用同一个 GitHub 账号登录，第二台继承频道并拿到加密密钥', async () => {
  const github = await fakeGitHub();
  const state = emptyIdentity();
  const relay = await createRelayServer({
    port: 0,
    identity: { state },
    github: {
      config: {
        clientId: 'cid',
        clientSecret: 'sec',
        redirectUri: 'http://127.0.0.1/cb',
        tokenUrl: `${github.base}/login/oauth/access_token`,
        apiBase: github.base,
      },
      secret: 'session-secret',
    },
    rateLimit: 500,
  });
  const base = `http://127.0.0.1:${relay.port}`;

  /** 走一遍设备码登录，返回设备令牌。 */
  const loginDevice = async (deviceName: string): Promise<{ token: string; code: string }> => {
    const started = await (await fetch(`${base}/v1/auth/device/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceName, platform: 'win32' }),
    })).json() as { code: string; verifyUrl: string };
    // 模拟浏览器：跟着 start 拿 state，再回调
    const redirected = await fetch(`${base}/v1/auth/github/start?device=${encodeURIComponent(started.code)}`, { redirect: 'manual' });
    assert.equal(redirected.status, 302);
    const stateParam = new URL(redirected.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const callback = await fetch(`${base}/v1/auth/github/callback?state=${encodeURIComponent(stateParam)}&code=abc`);
    assert.equal(callback.status, 200);
    const polled = await (await fetch(`${base}/v1/auth/device/poll?code=${encodeURIComponent(started.code)}`)).json() as {
      status: string;
      token: string;
    };
    assert.equal(polled.status, 'ready');
    return { token: polled.token, code: started.code };
  };

  try {
    const first = await loginDevice('Windows 版');
    // 第一个登录的人自动成为管理员，并且已经有一条空频道（自己建）
    const meFirst = await (await fetch(`${base}/v1/devices/me`, {
      headers: { authorization: `Bearer ${first.token}` },
    })).json() as { memberName: string; grants: Array<{ channelId: string }> };
    assert.equal(meFirst.memberName, 'Gsaecy');
    assert.equal(meFirst.grants.length, 0);

    const secret = 'z'.repeat(32);
    const channelId = deriveKeys(secret).channel;
    const claimed = await fetch(`${base}/v1/channels/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${first.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ channelId }),
    });
    assert.equal(claimed.status, 200);

    // 第一台登记公钥，表示自己不缺密钥
    const firstKeys = createHandoffKeyPair();
    await fetch(`${base}/v1/devices/pubkey`, {
      method: 'POST',
      headers: { authorization: `Bearer ${first.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: firstKeys.publicKey, needsKey: false }),
    });

    // 第二台：同一个 GitHub 账号 → 同一个成员 → 继承频道授权
    const second = await loginDevice('macOS 版');
    const meSecond = await (await fetch(`${base}/v1/devices/me`, {
      headers: { authorization: `Bearer ${second.token}` },
    })).json() as { deviceId: string; memberName: string; grants: Array<{ channelId: string }> };
    assert.equal(meSecond.memberName, 'Gsaecy');
    assert.deepEqual(meSecond.grants.map((grant) => grant.channelId), [channelId]);

    const secondKeys = createHandoffKeyPair();
    await fetch(`${base}/v1/devices/pubkey`, {
      method: 'POST',
      headers: { authorization: `Bearer ${second.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: secondKeys.publicKey, needsKey: true }),
    });

    // 第一台看到「有人等密钥」→ 用对方公钥加密后投放
    const seen = await (await fetch(`${base}/v1/handoff`, {
      headers: { authorization: `Bearer ${first.token}` },
    })).json() as { peers: Array<{ deviceId: string; pubkey: string; name: string }> };
    assert.equal(seen.peers.length, 1);
    assert.equal(seen.peers[0]!.name, 'macOS 版');

    const sealed = sealForDevice(firstKeys.privateKey, seen.peers[0]!.pubkey, { url: base, secret });
    const pushed = await fetch(`${base}/v1/handoff`, {
      method: 'POST',
      headers: { authorization: `Bearer ${first.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ toDeviceId: seen.peers[0]!.deviceId, iv: sealed.iv, ct: sealed.ct }),
    });
    assert.equal(pushed.status, 200);

    // 第二台取走 → 用自己的私钥解开 → 就是那条频道密钥
    const got = await (await fetch(`${base}/v1/handoff`, {
      headers: { authorization: `Bearer ${second.token}` },
    })).json() as { incoming?: { iv: string; ct: string; fromPubkey: string }; needsKey: boolean };
    assert.ok(got.incoming);
    const opened = openFromDevice(secondKeys.privateKey, got.incoming!.fromPubkey, {
      iv: got.incoming!.iv,
      ct: got.incoming!.ct,
    });
    assert.equal(opened?.secret, secret);
    assert.equal(deriveKeys(opened!.secret).channel, channelId);

    // 取走即失效：再查一次没有包了
    const again = await (await fetch(`${base}/v1/handoff`, {
      headers: { authorization: `Bearer ${second.token}` },
    })).json() as { incoming?: unknown };
    assert.equal(again.incoming, undefined);
  } finally {
    await relay.close();
    await github.close();
  }
});

test('服务端：不同 GitHub 账号是各自独立的空间，互相看不到设备', async () => {
  const github = await fakeGitHub();
  const state = emptyIdentity();
  const relay = await createRelayServer({
    port: 0,
    identity: { state },
    github: {
      config: { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://x/cb', tokenUrl: `${github.base}/login/oauth/access_token`, apiBase: github.base },
      secret: 'session-secret',
    },
    rateLimit: 500,
  });
  const base = `http://127.0.0.1:${relay.port}`;
  const login = async (deviceName: string): Promise<string> => {
    const started = await (await fetch(`${base}/v1/auth/device/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceName }),
    })).json() as { code: string };
    const redirected = await fetch(`${base}/v1/auth/github/start?device=${encodeURIComponent(started.code)}`, { redirect: 'manual' });
    const stateParam = new URL(redirected.headers.get('location') ?? '').searchParams.get('state') ?? '';
    await fetch(`${base}/v1/auth/github/callback?state=${encodeURIComponent(stateParam)}&code=abc`);
    const polled = await (await fetch(`${base}/v1/auth/device/poll?code=${encodeURIComponent(started.code)}`)).json() as { token: string };
    return polled.token;
  };
  try {
    const first = await login('A 的电脑');
    // 同一个 GitHub 账号的第二台：同一个组织
    const second = await login('A 的第二台');
    const meA = await (await fetch(`${base}/v1/devices/me`, { headers: { authorization: `Bearer ${first}` } })).json() as { orgId: string };
    const meA2 = await (await fetch(`${base}/v1/devices/me`, { headers: { authorization: `Bearer ${second}` } })).json() as { orgId: string };
    assert.equal(meA.orgId, meA2.orgId);
    // 两台都在同一个空间里
    assert.equal(state.orgs.length, 1);
    assert.equal(state.members.length, 1);
    assert.equal(state.devices.length, 2);

    // 换一个 GitHub 账号手动建成员，模拟另一个用户
    const strangerOrg = addOrg(state, 'someone-else');
    const stranger = addMember(state, { orgId: strangerOrg.id, name: '别人', role: 'owner', githubId: '555', githubLogin: 'someone' })!;
    assert.notEqual(stranger.orgId, meA.orgId);
    // 他的设备不在我这个组织的设备列表里
    const mine = state.devices.filter((device) => state.members
      .filter((item) => item.orgId === meA.orgId)
      .some((item) => item.id === device.memberId));
    assert.equal(mine.length, 2);
  } finally {
    await relay.close();
    await github.close();
  }
});

test('服务端：交接只能给自己的其它设备，跨成员一律拒绝', async () => {
  const github = await fakeGitHub();
  const state = emptyIdentity();
  const org = addOrg(state, 'acme');
  const mine = addMember(state, { orgId: org.id, name: '我', role: 'owner', githubId: '424242', githubLogin: 'gsaecy' })!;
  const other = addMember(state, { orgId: org.id, name: '别人', role: 'member', githubId: '999', githubLogin: 'other' })!;
  const channel = 'q'.repeat(32);
  const mineDevice = addDevice(state, { memberId: mine.id, name: '我的电脑', channels: [{ channelId: channel, role: 'owner' }] })!;
  const otherDevice = addDevice(state, { memberId: other.id, name: '别人的电脑', channels: [{ channelId: channel, role: 'member' }] })!;

  const relay = await createRelayServer({
    port: 0,
    identity: { state },
    github: {
      config: { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://x/cb', tokenUrl: `${github.base}/t`, apiBase: github.base },
      secret: 'session-secret',
    },
    rateLimit: 500,
  });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    // 别人的设备在等密钥
    await fetch(`${base}/v1/devices/pubkey`, {
      method: 'POST',
      headers: { authorization: `Bearer ${otherDevice.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: createHandoffKeyPair().publicKey, needsKey: true }),
    });
    // 我这边看到的是「同一个人」的等待列表，不该包含别人的设备
    const seen = await (await fetch(`${base}/v1/handoff`, {
      headers: { authorization: `Bearer ${mineDevice.token}` },
    })).json() as { peers: unknown[] };
    assert.deepEqual(seen.peers, []);

    // 就算硬要投给别人的设备也不行 —— 明确 403，而不是假装目标不存在
    const pushed = await fetch(`${base}/v1/handoff`, {
      method: 'POST',
      headers: { authorization: `Bearer ${mineDevice.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ toDeviceId: otherDevice.device.id, iv: 'a', ct: 'b' }),
    });
    assert.equal(pushed.status, 403);
    assert.match(await pushed.text(), /只能给自己的其它设备交接/);
  } finally {
    await relay.close();
    await github.close();
  }
});
