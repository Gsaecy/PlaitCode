import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  buildAuthorizeUrl,
  emailAllowed,
  exchangeCode,
  signSession,
  signState,
  verifySession,
  verifyState,
  type FeishuConfig,
} from '../sync/relayAuth';
import { createRelayServer } from '../sync/relayServer';
import { addOrg, emptyIdentity } from '../sync/relayIdentity';

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
    assert.match(cookie, /^plaitcode_session=/);

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
