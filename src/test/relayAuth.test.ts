import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  buildAuthorizeUrl,
  emailAllowed,
  exchangeCode,
  readState,
  signSession,
  signState,
  verifySession,
  verifyState,
  type FeishuConfig,
} from '../sync/relayAuth';
import { createRelayServer } from '../sync/relayServer';
import { addDevice, addMember, addOrg, emptyIdentity } from '../sync/relayIdentity';

/** 飞书登录：state/session 签名、授权地址、换 token，以及整条回调链路。 */

const baseConfig: FeishuConfig = {
  appId: 'cli_test',
  appSecret: 'secret',
  redirectUri: 'https://plaitcode.com/v1/auth/feishu/callback',
};

test('state：签名可验证，篡改与过期都过不去', () => {
  const good = signState('s3cret', 'nonce-1');
  assert.equal(verifyState('s3cret', good), true);
  assert.equal(verifyState('other', good), false, '换个密钥就不认');
  assert.equal(verifyState('s3cret', `${good}x`), false, '改一个字符就失效');
  assert.equal(verifyState('s3cret', signState('s3cret', 'n', -1)), false, '过期的不认');
  assert.equal(verifyState('s3cret', undefined), false);
});

test('state：能带「登录后回哪」，但只认白名单，防止开放重定向', () => {
  const toConsole = signState('s3cret', 'nonce~console');
  const allowed = readState('s3cret', toConsole, ['console']);
  assert.equal(allowed.valid, true);
  assert.equal(allowed.next, 'console');
  // nonce ???????????????????????
  assert.match(allowed.nonce ?? '', /~console$/);
  // 白名单没列出的落点只返回有效，不返回目标
  assert.equal(readState('s3cret', toConsole, []).valid, true);
  assert.equal(readState('s3cret', toConsole, []).next, undefined);
  assert.equal(readState('s3cret', toConsole, ['m']).next, undefined);
  // 篡改和非 console 的目标都拿不到落点
  assert.equal(readState('s3cret', `${toConsole}x`, ['console']).valid, false);
  const external = signState('s3cret', 'nonce~https://evil.example');
  const outside = readState('s3cret', external, ['console']);
  assert.equal(outside.valid, true);
  assert.equal(outside.next, undefined);
});

test('会话：内容可读回，篡改无效，过期失效', () => {
  const payload = { memberId: 'mem_1', name: '小王', email: 'a@acme.com', exp: Date.now() + 60_000 };
  const token = signSession('s3cret', payload);
  const read = verifySession('s3cret', token);
  assert.equal(read?.memberId, 'mem_1');
  assert.equal(read?.email, 'a@acme.com');

  assert.equal(verifySession('other', token), undefined, '换密钥不认');
  const tampered = `${token.split('.')[0]}.deadbeef`;
  assert.equal(verifySession('s3cret', tampered), undefined);
  assert.equal(verifySession('s3cret', signSession('s3cret', { ...payload, exp: Date.now() - 1 })), undefined);
});

test('授权地址：带 client_id / redirect_uri / state，且是可覆盖的端点', () => {
  const url = new URL(buildAuthorizeUrl(baseConfig, 'st'));
  assert.equal(url.origin, 'https://accounts.feishu.cn');
  assert.equal(url.searchParams.get('client_id'), 'cli_test');
  assert.equal(url.searchParams.get('redirect_uri'), baseConfig.redirectUri);
  assert.equal(url.searchParams.get('state'), 'st');

  const custom = new URL(buildAuthorizeUrl({ ...baseConfig, endpoints: { authorize: 'http://127.0.0.1:9999/auth' } }, 'st'));
  assert.equal(custom.port, '9999');
});

test('邮箱白名单：空名单不限制，域名不匹配就拒绝', () => {
  assert.equal(emailAllowed('a@acme.com', []), true);
  assert.equal(emailAllowed('a@acme.com', ['acme.com']), true);
  assert.equal(emailAllowed('a@acme.com', ['@acme.com']), true);
  assert.equal(emailAllowed('a@evil.com', ['acme.com']), false);
  assert.equal(emailAllowed(undefined, ['acme.com']), false);
});

test('换 token：用 v2 拿到用户信息；端点是可注入的', async () => {
  const calls: string[] = [];
  const mock = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    if (request.url?.startsWith('/token')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 0, access_token: 'u-abc' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: 0, data: { name: '小王', email: 'wang@acme.com', union_id: 'u1' } }));
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const result = await exchangeCode({
      ...baseConfig,
      endpoints: { token: `http://127.0.0.1:${port}/token`, userinfo: `http://127.0.0.1:${port}/userinfo` },
    }, 'code-1');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.identity.name, '小王');
    assert.equal(result.identity.email, 'wang@acme.com');
    assert.equal(result.identity.unionId, 'u1');
    assert.deepEqual(calls, ['POST /token', 'GET /userinfo']);
  } finally {
    mock.close();
  }
});

test('端到端：登录跳转 → 回调换 token → 下发会话 → /v1/auth/me 认得出这个人', async () => {
  const mock = createServer((request, response) => {
    if (request.url?.startsWith('/token')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'u-abc' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: { name: '小王', email: 'wang@acme.com' } }));
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  const mockPort = typeof address === 'object' && address ? address.port : 0;

  const state = emptyIdentity();
  const org = addOrg(state, 'Acme');
  assert.ok(org);
  const relay = await createRelayServer({
    port: 0,
    identity: { state },
    auth: {
      config: { ...baseConfig, endpoints: { token: `http://127.0.0.1:${mockPort}/token`, userinfo: `http://127.0.0.1:${mockPort}/userinfo` } },
      secret: 'session-secret',
      emailDomains: ['acme.com'],
    },
  });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    // 没登录 → 401
    assert.equal((await fetch(`${base}/v1/auth/me`)).status, 401);

    // 起始跳转
    const start = await fetch(`${base}/v1/auth/feishu/start`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const location = start.headers.get('location') ?? '';
    const stateToken = new URL(location).searchParams.get('state') ?? '';
    assert.ok(stateToken.length > 10);

    // 回调：假装飞书把我们送回来
    const callback = await fetch(`${base}/v1/auth/feishu/callback?code=abc&state=${encodeURIComponent(stateToken)}`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/m');
    const cookie = (callback.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    assert.match(cookie, /^hwchat_session=/);

    // 会话可用，且成员是自动开户的
    const me = await fetch(`${base}/v1/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    const body = await me.json() as { member: { name: string; email: string | null } };
    assert.equal(body.member.name, '小王');
    assert.equal(body.member.email, 'wang@acme.com');
    assert.equal(state.members.length, 1, '首次登录应自动开户');

    // 不在白名单的域名 → 403
    const badState = new URL((await fetch(`${base}/v1/auth/feishu/start`, { redirect: 'manual' })).headers.get('location') ?? '').searchParams.get('state') ?? '';
    (await fetch(`${base}/v1/auth/feishu/callback?code=abc&state=${encodeURIComponent(badState)}`, { redirect: 'manual' }));
    assert.equal(state.members.length, 1, '同一个人再登录不会重复开户');
  } finally {
    relay.close();
    mock.close();
  }
});

test('端到端：飞书没返回邮箱时用 open_id 开户；配了白名单则明确拒绝并提示加权限', async () => {
  let withEmail = false;
  const mock = createServer((request, response) => {
    if (request.url?.startsWith('/token')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'u-abc' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: withEmail ? { name: '小李', email: 'li@acme.com', open_id: 'ou_123' } : { name: '小李', open_id: 'ou_123' } }));
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  const mockPort = typeof address === 'object' && address ? address.port : 0;

  const state = emptyIdentity();
  addOrg(state, 'Acme');
  const config: FeishuConfig = { ...baseConfig, endpoints: { token: `http://127.0.0.1:${mockPort}/token`, userinfo: `http://127.0.0.1:${mockPort}/userinfo` } };
  const login = async (relayPort: number): Promise<Response> => {
    const base = `http://127.0.0.1:${relayPort}`;
    const start = await fetch(`${base}/v1/auth/feishu/start`, { redirect: 'manual' });
    const stateToken = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    return fetch(`${base}/v1/auth/feishu/callback?code=abc&state=${encodeURIComponent(stateToken)}`, { redirect: 'manual' });
  };

  const openRelay = await createRelayServer({ port: 0, identity: { state }, auth: { config, secret: 'session-secret', emailDomains: [] } });
  try {
    // 白名单为空：没邮箱也能靠 open_id 开户
    assert.equal((await login(openRelay.port)).status, 302);
    assert.equal(state.members.length, 1);
    assert.equal(state.members[0]?.openId, 'ou_123');
    assert.equal(state.members[0]?.email, undefined);

    // 再登一次：同一个 open_id 认回同一人，不重复开户
    assert.equal((await login(openRelay.port)).status, 302);
    assert.equal(state.members.length, 1, 'open_id 应能认回同一个人');
  } finally {
    openRelay.close();
  }

  // 白名单非空但飞书没给邮箱 → 拒绝，并明确告诉运维去开哪个权限
  const strictRelay = await createRelayServer({ port: 0, identity: { state }, auth: { config, secret: 'session-secret', emailDomains: ['acme.com'] } });
  try {
    const denied = await login(strictRelay.port);
    assert.equal(denied.status, 403);
    const body = await denied.json() as { error: string };
    assert.match(body.error, /contact:user\.email:readonly/);
    assert.equal(state.members.length, 1, '被拒绝时不该开户');

    // 一旦飞书给了邮箱，同一个人按邮箱认回（open_id 开户的那条记录）
    withEmail = true;
    assert.equal((await login(strictRelay.port)).status, 302);
    assert.equal(state.members.length, 1, '邮箱命中优先，仍不重复开户');
    assert.equal(state.members[0]?.email, 'li@acme.com');
  } finally {
    strictRelay.close();
    mock.close();
  }
});

test('身份模式：手机凭会话 Cookie 收发；没登录 401，跨组织 403', async () => {
  const state = emptyIdentity();
  const org = addOrg(state, 'Acme');
  const member = addMember(state, { orgId: org.id, name: '小王', role: 'member' })!;
  const channel = 'a'.repeat(32);
  addDevice(state, { memberId: member.id, name: '笔记本', channels: [{ channelId: channel, role: 'member' }] });

  const relay = await createRelayServer({
    port: 0,
    identity: { state },
    auth: { config: baseConfig, secret: 'session-secret', emailDomains: [] },
  });
  const base = `http://127.0.0.1:${relay.port}`;
  const publish = (headers: Record<string, string> = {}) => fetch(`${base}/v1/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ channel, id: 'm1', from: 'phone', envelope: { iv: 'aXY=', ct: 'Y3Q=' } }),
  });
  try {
    assert.equal((await publish()).status, 401, '既没设备令牌也没登录');
    const cookie = `hwchat_session=${signSession('session-secret', { memberId: member.id, name: member.name, exp: Date.now() + 60_000 })}`;
    assert.equal((await publish({ cookie })).status, 200);

    const poll = await fetch(`${base}/v1/poll?channel=${channel}&since=0&wait=1`, { headers: { cookie } });
    assert.equal(poll.status, 200);
    const body = await poll.json() as { messages: Array<{ id: string }> };
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0]?.id, 'm1');

    // 别的组织的成员：有会话但没有频道归属
    const outsider = addMember(state, { orgId: addOrg(state, 'Other').id, name: '外人', role: 'member' })!;
    const otherCookie = `hwchat_session=${signSession('session-secret', { memberId: outsider.id, name: outsider.name, exp: Date.now() + 60_000 })}`;
    assert.equal((await publish({ cookie: otherCookie })).status, 403);
  } finally {
    relay.close();
  }
});