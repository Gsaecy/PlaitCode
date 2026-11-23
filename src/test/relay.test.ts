import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRequirement, type SyncPeer } from '../sync/lanProtocol';
import { RelayClient } from '../sync/relayClient';
import { CHANNEL_PREFIX, ENC_PREFIX, RELAY_PREFIX, buildPairingText, deriveKeys, newPairingSecret, open, parsePairingText, seal } from '../sync/relayCrypto';
import { createRelayServer } from '../sync/relayServer';
import { webcrypto } from 'node:crypto';

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

test('限流按真实客户端 IP 计（不是 nginx 的 127.0.0.1），健康检查不占额度', async () => {
  // 线上踩到的真问题：中继只监听 127.0.0.1，`socket.remoteAddress` 永远是 127.0.0.1，
  // 于是所有用户共用一个限流桶，一个扫描器就能把所有人的额度打光。
  const relay = await createRelayServer({ port: 0, rateLimit: 3 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    for (let index = 0; index < 6; index += 1) {
      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200, `第 ${index + 1} 次健康检查不该被限流`);
    }

    const call = (ip: string): Promise<Response> => fetch(`${base}/v1/poll?channel=abc&since=0&wait=0`, {
      headers: { 'x-real-ip': ip },
    });
    // 服务端把限流下限卡在 10 次/分钟（防止有人配成 0 等于关掉防线），所以打 12 次
    const statuses: number[] = [];
    for (let index = 0; index < 12; index += 1) statuses.push((await call('203.0.113.7')).status);
    assert.deepEqual(statuses.slice(0, 10), new Array(10).fill(403));
    assert.deepEqual(statuses.slice(10), [429, 429]);

    // 换一个客户端 IP 不受前一个人的额度影响
    assert.equal((await call('203.0.113.8')).status, 403);
  } finally {
    await relay.close();
  }
});

test('中继：/m 返回手机页面（不占限流额度）', async () => {
  const relay = await createRelayServer({ port: 0, rateLimit: 3 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    for (let index = 0; index < 8; index += 1) {
      const page = await fetch(`${base}/m`, { headers: { host: 'plaitcode.com' } });
      assert.equal(page.status, 200, `第 ${index + 1} 次打开页面不该被限流`);
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
      const html = await page.text();
      assert.match(html, /PlaitCode · 团队群/);
      assert.ok(html.includes(CHANNEL_PREFIX), '页面里必须带与 Node 端一致的派生前缀');
      assert.match(html, /plaitcode\.relay\.key/);
    }
  } finally {
    await relay.close();
  }
});

test('手机页面：relayHost 被清洗，注入不进去', async () => {
  const relay = await createRelayServer({ port: 0 });
  try {
    const page = await fetch(`http://127.0.0.1:${relay.port}/m`, {
      headers: { host: '"><script>alert(1)</script>' },
    });
    const html = await page.text();
    assert.equal(html.includes('<script>alert(1)</script>'), false);
  } finally {
    await relay.close();
  }
});

test('浏览器端（WebCrypto）与 Node 端密钥派生一致、密文可互解', async () => {
  // 手机页面用 WebCrypto，桌面用 node:crypto。两边的派生和 AES-GCM 格式必须完全一致，
  // 否则「手机发的消息电脑解不开」会在真机上才暴露 —— 这条测试就是把那个风险钉死。
  const secret = newPairingSecret();
  const nodeKeys = deriveKeys(secret);

  const encoder = new TextEncoder();
  const hash = async (prefix: string): Promise<Uint8Array> => new Uint8Array(
    await webcrypto.subtle.digest('SHA-256', encoder.encode(prefix + secret)),
  );
  const channel = Buffer.from(await hash(CHANNEL_PREFIX)).toString('hex').slice(0, 32);
  const relayKey = Buffer.from(await hash(RELAY_PREFIX)).toString('base64url');
  const rawEnc = await hash(ENC_PREFIX);

  assert.equal(channel, nodeKeys.channel);
  assert.equal(relayKey, nodeKeys.relay);
  assert.deepEqual(Buffer.from(rawEnc), nodeKeys.enc);

  const key = await webcrypto.subtle.importKey('raw', rawEnc, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const plaintext = JSON.stringify({ kind: 'group', body: '手机发的需求' });
  const cipher = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`${channel}:msg-web`), tagLength: 128 },
    key,
    encoder.encode(plaintext),
  );
  const envelope = {
    iv: Buffer.from(iv).toString('base64'),
    ct: Buffer.from(new Uint8Array(cipher)).toString('base64'),
  };
  // 浏览器加密 → Node 解密
  assert.equal(open(nodeKeys, 'msg-web', envelope), plaintext);
  // 反过来：Node 加密 → 浏览器解密（AAD 一致才解得开）
  const sealedByNode = seal(nodeKeys, 'msg-node', plaintext);
  const decrypted = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(sealedByNode.iv, 'base64'), additionalData: encoder.encode(`${channel}:msg-node`), tagLength: 128 },
    key,
    Buffer.from(sealedByNode.ct, 'base64'),
  );
  assert.equal(new TextDecoder().decode(decrypted), plaintext);
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
