import assert from 'node:assert/strict';
import test from 'node:test';
import { signSession, readState } from '../sync/relayAuth';
import { addDevice, addMember, addOrg, emptyIdentity } from '../sync/relayIdentity';
import { createRelayServer } from '../sync/relayServer';
import { renderConsolePage, renderLandingPage } from '../sync/relaySite';

/**
 * 网站层：首页是入口，控制台是数据面。
 *
 * 这里钉三件事：
 *  1. `/` 是给人看的首页，`/health` 才是探活 JSON（监控和人都不能拿错东西）；
 *  2. 控制台数据必须登录、且只返回本组织的设备；
 *  3. 页面里不拼服务端数据（设备名是用户输入，不能变成 HTML）。
 */

const FEISHU = {
  appId: 'cli_test',
  appSecret: 'secret',
  redirectUri: 'https://relay.example.com/v1/auth/feishu/callback',
};
const SESSION_SECRET = 'session-secret-for-tests';

function cookieFor(memberId: string, name: string): string {
  const value = signSession(SESSION_SECRET, { memberId, name, exp: Date.now() + 60 * 60_000 });
  return `plaitcode_session=${value}`;
}

test('首页（冰山）：只露一句价值 + 装扩展/手机端，GitHub 账号有注册引导', () => {
  const html = renderLandingPage({
    relayHost: 'relay.example.com',
    consoleEnabled: true,
    installUrl: 'https://marketplace.visualstudio.com/items?itemName=plaitcode.plaitcode',
    repoUrl: 'https://github.com/Gsaecy/PlaitCode',
  });
  // 水面之上：装扩展 + 手机端，两个按钮就够
  assert.match(html, /href="\/m"/);
  assert.match(html, /marketplace\.visualstudio\.com/);
  // 控制台在导航里，不占首屏 CTA
  assert.match(html, /href="\/console"/);
  assert.match(html, /relay\.example\.com/);
  // 没有 GitHub 账号的人要知道去哪注册
  assert.match(html, /github\.com\/signup/);
  assert.match(html, /需要一个 GitHub 账号/);
  // 想深入的人有文档入口（水下）
  assert.match(html, /id="deeper"/);
  assert.match(html, /docs\/COLLAB-SETUP\.md/);

  const noSso = renderLandingPage({
    relayHost: 'relay.example.com',
    consoleEnabled: false,
    installUrl: 'https://example.com/install',
    repoUrl: 'https://example.com/repo',
  });
  assert.match(noSso, /还没开放登录/);
});

test('首页：Host 头被转义，不能借服务端拼出脚本', () => {
  const html = renderLandingPage({
    relayHost: '"><script>alert(1)</script>',
    consoleEnabled: true,
    installUrl: 'https://example.com/install',
    repoUrl: 'https://example.com/repo',
  });
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});

test('控制台页：不含服务端数据，登录态判断写成常量', () => {
  const html = renderConsolePage({ relayHost: 'relay.example.com', sessionAuth: true });
  assert.match(html, /\/v1\/console\/state/);
  assert.match(html, /next=console/);
  assert.match(html, /var sessionAuth = true/);
  assert.equal(html.includes('<script>alert'), false);
  assert.match(renderConsolePage({ relayHost: 'x', sessionAuth: false }), /var sessionAuth = false/);
});

test('网站路由：/ 返回首页 HTML，/health 仍是 JSON', async () => {
  const relay = await createRelayServer({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await home.text(), /PlaitCode/);

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get('content-type') ?? '', /application\/json/);
    const payload = (await health.json()) as Record<string, unknown>;
    assert.equal(payload.service, 'plaitcode-relay');

    const consolePage = await fetch(`${base}/console`);
    assert.equal(consolePage.status, 200);
    assert.match(await consolePage.text(), /PlaitCode 控制台/);
  } finally {
    await relay.close();
  }
});

test('登录入口：next=console 会一路带到回调，别的值一律回手机端', async () => {
  const state = emptyIdentity();
  addOrg(state, '我的团队');
  const relay = await createRelayServer({
    port: 0,
    identity: { state },
    auth: { config: FEISHU, secret: SESSION_SECRET },
  });
  const base = `http://127.0.0.1:${relay.port}`;
  const stateOf = async (query: string): Promise<string> => {
    const response = await fetch(`${base}/v1/auth/feishu/start${query}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const location = response.headers.get('location') ?? '';
    return new URL(location).searchParams.get('state') ?? '';
  };
  try {
    assert.equal(readState(SESSION_SECRET, await stateOf('?next=console'), ['console']).next, 'console');
    assert.equal(readState(SESSION_SECRET, await stateOf('?next=/evil.example'), ['console']).next, undefined);
    assert.equal(readState(SESSION_SECRET, await stateOf(''), ['console']).next, undefined);
  } finally {
    await relay.close();
  }
});

test('控制台接口：未登录 401，登录后只看到本组织的设备，可吊销自己的设备', async () => {
  const state = emptyIdentity();
  const org = addOrg(state, '我的团队');
  const mine = addMember(state, { orgId: org.id, name: '我', role: 'member' })!;
  const other = addMember(state, { orgId: org.id, name: '同事', role: 'viewer' })!;
  const strangerOrg = addOrg(state, '别的团队');
  const stranger = addMember(state, { orgId: strangerOrg.id, name: '外人', role: 'owner' })!;
  const channel = 'c'.repeat(32);
  const ownDevice = addDevice(state, {
    memberId: mine.id,
    name: '公司电脑',
    platform: 'win32',
    channels: [{ channelId: channel, role: 'member' }],
  })!;
  const otherDevice = addDevice(state, {
    memberId: other.id,
    name: '同事的 Mac',
    platform: 'darwin',
    channels: [{ channelId: channel, role: 'viewer' }],
  })!;
  const outsideDevice = addDevice(state, {
    memberId: stranger.id,
    name: '别家的机器',
    platform: 'linux',
    channels: [{ channelId: 'd'.repeat(32), role: 'member' }],
  })!;

  const relay = await createRelayServer({
    port: 0,
    identity: { state },
    auth: { config: FEISHU, secret: SESSION_SECRET },
    rateLimit: 500,
  });
  const base = `http://127.0.0.1:${relay.port}`;
  const stateOf = (memberId: string, name: string) => fetch(`${base}/v1/console/state`, {
    headers: { cookie: cookieFor(memberId, name) },
  });
  const revoke = (memberId: string, name: string, deviceId: string) => fetch(`${base}/v1/console/devices/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieFor(memberId, name) },
    body: JSON.stringify({ deviceId }),
  });

  try {
    assert.equal((await fetch(`${base}/v1/console/state`)).status, 401);

    const mineState = (await (await stateOf(mine.id, mine.name)).json()) as any;
    assert.equal(mineState.ok, true);
    assert.equal(mineState.org.name, '我的团队');
    const ids = mineState.devices.map((device: any) => device.id).sort();
    assert.deepEqual(ids, [ownDevice.device.id, otherDevice.device.id].sort());
    assert.equal(mineState.devices.some((device: any) => device.id === outsideDevice.device.id), false);
    assert.equal(mineState.channels.length, 1);
    assert.equal(mineState.channels[0].channelId, channel);
    assert.equal(mineState.channels[0].devices, 2);

    // 自己的设备：普通成员也能吊销
    assert.equal((await revoke(mine.id, mine.name, ownDevice.device.id)).status, 200);
    const afterRevoke = (await (await stateOf(mine.id, mine.name)).json()) as any;
    assert.equal(afterRevoke.counts.devices, 1);
    assert.ok(afterRevoke.devices.find((device: any) => device.id === ownDevice.device.id).revokedAt);

    // 别人的设备：viewer 不行，且跨组织一律看不见
    assert.equal((await revoke(other.id, other.name, ownDevice.device.id)).status, 403);
    assert.equal((await revoke(mine.id, mine.name, outsideDevice.device.id)).status, 404);
  } finally {
    await relay.close();
  }
});
