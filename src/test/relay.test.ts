import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRequirement, type SyncPeer } from '../sync/lanProtocol';
import { RelayClient } from '../sync/relayClient';
import { buildPairingText, deriveKeys, newPairingSecret, open, parsePairingText, seal } from '../sync/relayCrypto';
import { createRelayServer } from '../sync/relayServer';

/**
 * 跨网中继：真起服务、真发 HTTP、真加解密。
 *
 * 这里最该钉死的不是"能连通"，而是三件事：
 *  1. 中转**看不到明文**（只存密文）；
 *  2. 密文被篡改 / 换了消息 id / 换了频道，必须解不开；
 *  3. 密钥不对的设备连不进来。
 */

const winPeer: SyncPeer = { id: 'dev-win', name: 'PC · Windows', platform: 'win32', project: 'app', version: 'test' };
const macPeer: SyncPeer = { id: 'dev-mac', name: 'Mac · macOS', platform: 'darwin', project: 'app', version: 'test' };

function waitFor(check: () => boolean, timeoutMs = 8_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('等待超时'));
      }
    }, 30);
  });
}

test('密钥派生：同一 secret 稳定、不同 secret 互不相同、频道号不泄露 secret', () => {
  const secret = newPairingSecret();
  const first = deriveKeys(secret);
  const again = deriveKeys(secret);
  assert.equal(first.channel, again.channel);
  assert.equal(first.relay, again.relay);
  assert.deepEqual(first.enc, again.enc);

  const other = deriveKeys(newPairingSecret());
  assert.notEqual(first.channel, other.channel);
  assert.notEqual(first.relay, other.relay);
  assert.match(first.channel, /^[0-9a-f]{32}$/);
  assert.equal(first.channel.includes(secret.slice(0, 6)), false);

  assert.throws(() => deriveKeys('short'), /太短/);
});

test('端到端加密：能往返；改密文、换消息 id、换密钥都解不开', () => {
  const keys = deriveKeys(newPairingSecret());
  const plaintext = JSON.stringify({ hello: '世界', n: 42 });
  const envelope = seal(keys, 'msg-1', plaintext);

  assert.equal(open(keys, 'msg-1', envelope), plaintext);
  // AAD 绑定消息 id：中转把密文挪到别的 id 上，必须失败
  assert.equal(open(keys, 'msg-2', envelope), undefined);
  // 换个频道密钥（别台设备的），必须失败
  assert.equal(open(deriveKeys(newPairingSecret()), 'msg-1', envelope), undefined);

  // 篡改一个字节
  const raw = Buffer.from(envelope.ct, 'base64');
  raw[0] = raw[0]! ^ 0xff;
  assert.equal(open(keys, 'msg-1', { iv: envelope.iv, ct: raw.toString('base64') }), undefined);
  // iv 被换掉
  assert.equal(open(keys, 'msg-1', { iv: Buffer.alloc(12).toString('base64'), ct: envelope.ct }), undefined);
});

test('配对文本：一行能来回解析，格式不对直接拒绝', () => {
  const secret = newPairingSecret();
  const text = buildPairingText('https://plaitcode.com/', secret);
  assert.match(text, /^plaitcode:\/\/join\?u=/);
  const parsed = parsePairingText(text);
  assert.ok(parsed);
  assert.equal(parsed!.url, 'https://plaitcode.com');
  assert.equal(parsed!.secret, secret);

  assert.equal(parsePairingText('https://plaitcode.com'), undefined);
  assert.equal(parsePairingText('plaitcode://join?u=ftp://x&s=abcdefghijklmnopqrstuvwx'), undefined);
  assert.equal(parsePairingText('plaitcode://join?u=https://x&s=short'), undefined);
});

test('中继：两台设备经真实中转互通，且中转只拿到密文', async () => {
  const relay = await createRelayServer({ port: 0, maxWaitMs: 2_000 });
  const secret = newPairingSecret();
  const base = `http://127.0.0.1:${relay.port}`;
  const received: unknown[] = [];
  const errors: string[] = [];

  const sender = new RelayClient({
    url: base,
    secret,
    device: winPeer,
    onMessage: () => undefined,
    log: (line) => errors.push(line),
    pollSeconds: 5,
  });
  const receiver = new RelayClient({
    url: base,
    secret,
    device: macPeer,
    onMessage: (message) => { received.push(message); },
    log: (line) => errors.push(line),
    pollSeconds: 5,
  });

  try {
    receiver.start();
    await waitFor(() => receiver.status().connected || errors.length > 0);
    sender.start();
    await waitFor(() => sender.status().connected || errors.length > 0);
    assert.deepEqual(errors, [], `不该有错误：${errors.join(' / ')}`);

    const requirement = makeRequirement(winPeer, '两个平台都加一个托盘图标');
    assert.ok(requirement);
    const sent = await sender.send(requirement!);
    assert.equal(sent.ok, true, sent.message);

    await waitFor(() => received.length > 0);
    const delivered = received[0] as { kind: string; title: string; from: { id: string } };
    assert.equal(delivered.kind, 'requirement');
    assert.equal(delivered.title, '两个平台都加一个托盘图标');
    assert.equal(delivered.from.id, winPeer.id);

    // 中转里存的是密文：拿一个"旁观者"设备读同频道的原始消息，明文不该出现
    const observer = new RelayClient({ url: base, secret, device: { ...macPeer, id: 'dev-spy' }, onMessage: () => undefined });
    const keys = deriveKeys(secret);
    const raw = await fetch(`${base}/v1/poll?channel=${keys.channel}&since=0&wait=0`, {
      headers: { authorization: `Bearer ${keys.relay}` },
    }).then((response) => response.json() as Promise<{ messages: Array<{ envelope: { ct: string } }> }>);
    assert.ok(raw.messages.length >= 1);
    const cipherText = Buffer.from(raw.messages[0]!.envelope.ct, 'base64').toString('utf8');
    assert.equal(cipherText.includes('托盘图标'), false, '中转不该能看到明文');
    void observer;
  } finally {
    sender.stop();
    receiver.stop();
    await relay.close();
  }
});

test('中继：密钥不匹配的设备发不进去也读不到', async () => {
  const relay = await createRelayServer({ port: 0, maxWaitMs: 1_000 });
  const base = `http://127.0.0.1:${relay.port}`;
  const owner = deriveKeys(newPairingSecret());
  const intruder = deriveKeys(newPairingSecret());

  const requirement = makeRequirement(winPeer, '只应进 owner 的频道');
  assert.ok(requirement);

  try {
    // owner 先建频道
    const publish = await fetch(`${base}/v1/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.relay}` },
      body: JSON.stringify({
        channel: owner.channel,
        id: 'm-1',
        from: winPeer.id,
        envelope: seal(owner, 'm-1', JSON.stringify(requirement)),
      }),
    });
    assert.equal(publish.status, 200);

    // 用别人的密钥冒充同一个频道号 → 403
    const forged = await fetch(`${base}/v1/poll?channel=${owner.channel}&since=0&wait=0`, {
      headers: { authorization: `Bearer ${intruder.relay}` },
    });
    assert.equal(forged.status, 403);

    // 用别人的密钥 + 自己的频道号 → 那是另一个空频道，读不到 owner 的消息
    const otherChannel = await fetch(`${base}/v1/poll?channel=${intruder.channel}&since=0&wait=0`, {
      headers: { authorization: `Bearer ${intruder.relay}` },
    });
    const body = await otherChannel.json() as { messages: unknown[] };
    assert.deepEqual(body.messages, []);
  } finally {
    await relay.close();
  }
});
