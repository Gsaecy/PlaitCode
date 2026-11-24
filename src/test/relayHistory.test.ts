/**
 * 频道历史落盘：重启不丢消息、seq 不重号、坏行不影响其它消息。
 *
 * 这是「换台电脑接着干活」和「任务看板」的地基：新设备首次 `since=0`
 * 必须能拿到之前发生过的全部消息，否则它看到的是一段残缺的对话。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRelayServer } from '../sync/relayServer';
import { createChannelHistory } from '../sync/relayHistory';

const CHANNEL = 'a'.repeat(32);

async function publish(port: number, id: string, iv = 'aXY=', ct = 'Y3Q='): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/v1/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer key-material' },
    body: JSON.stringify({ channel: CHANNEL, id, from: 'dev-a', envelope: { iv, ct } }),
  });
}

async function poll(port: number, since: number): Promise<{ messages: Array<{ id: string; seq: number }>; seq: number }> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/poll?channel=${CHANNEL}&since=${since}&wait=0`, {
    headers: { authorization: 'Bearer key-material' },
  });
  return response.json() as Promise<{ messages: Array<{ id: string; seq: number }>; seq: number }>;
}

test('重启后消息还在，seq 继续递增而不是从 1 重来', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-history-'));
  try {
    const first = await createRelayServer({ port: 0, historyDir: dir });
    try {
      assert.equal((await publish(first.port, 'm1')).status, 200);
      assert.equal((await publish(first.port, 'm2')).status, 200);
    } finally {
      await first.close();
    }

    const second = await createRelayServer({ port: 0, historyDir: dir });
    try {
      const restored = await poll(second.port, 0);
      assert.deepEqual(restored.messages.map((item) => item.id), ['m1', 'm2']);
      assert.equal(restored.seq, 2);

      // 新消息必须接在 3，否则客户端拿着 since=2 会永远收不到
      assert.equal((await publish(second.port, 'm3')).status, 200);
      const next = await poll(second.port, 2);
      assert.deepEqual(next.messages.map((item) => item.id), ['m3']);
      assert.equal(next.seq, 3);
    } finally {
      await second.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('重复投递在重启后依然被识别（历史里的 id 也进 seen）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-history-'));
  try {
    const first = await createRelayServer({ port: 0, historyDir: dir });
    try {
      await publish(first.port, 'm1');
    } finally {
      await first.close();
    }
    const second = await createRelayServer({ port: 0, historyDir: dir });
    try {
      const again = await publish(second.port, 'm1');
      assert.equal(again.status, 200);
      const body = await again.json() as { duplicate?: boolean; seq: number };
      assert.equal(body.duplicate, true, '重启后同一条消息不该再占一个 seq');
      assert.equal(body.seq, 1);
    } finally {
      await second.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('落地文件只含密文与元数据，坏行被跳过', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-history-'));
  try {
    const file = join(dir, `${CHANNEL}.jsonl`);
    const good = JSON.stringify({ seq: 1, id: 'm1', from: 'dev-a', iv: 'aXY=', ct: 'Y3Q=', at: 1 });
    // 断电时最后一行可能只写了一半
    await writeFile(file, `${good}\n{"seq":2,"id":"m2"`, 'utf8');

    const history = createChannelHistory(dir, 100);
    const entries = await history.load(CHANNEL);
    assert.deepEqual(entries.map((entry) => entry.id), ['m1'], '坏行跳过，好行保留');

    const relay = await createRelayServer({ port: 0, historyDir: dir });
    try {
      const restored = await poll(relay.port, 0);
      assert.deepEqual(restored.messages.map((item) => item.id), ['m1']);
    } finally {
      await relay.close();
    }

    await history.append(CHANNEL, { seq: 2, id: 'm2', from: 'dev-a', iv: 'aXY=', ct: 'Y3Q=', at: 2 });
    await history.flush();
    const raw = await readFile(file, 'utf8');
    assert.match(raw, /"ct":"Y3Q="/, '落盘的是密文');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('超出上限只保留最近的消息，seq 仍取最大值', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-history-'));
  try {
    const history = createChannelHistory(dir, 100);
    for (let seq = 1; seq <= 30; seq += 1) {
      history.append(CHANNEL, { seq, id: `m${seq}`, from: 'dev-a', iv: 'aXY=', ct: 'Y3Q=', at: seq });
    }
    await history.flush();

    // 中继把 maxMessages 下限卡在 20（防止配成 0 等于不保留历史）
    const relay = await createRelayServer({ port: 0, historyDir: dir, maxMessages: 20 });
    try {
      const restored = await poll(relay.port, 0);
      assert.equal(restored.messages.length, 20);
      assert.equal(restored.messages[0]?.id, 'm11', '保留最近 20 条');
      assert.equal(restored.messages[19]?.id, 'm30');
      assert.equal(restored.seq, 30, 'seq 必须接在最大值上');
    } finally {
      await relay.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('不配 historyDir 时行为与以前一致（纯内存）', async () => {
  const relay = await createRelayServer({ port: 0 });
  try {
    await publish(relay.port, 'm1');
    const first = await poll(relay.port, 0);
    assert.deepEqual(first.messages.map((item) => item.id), ['m1']);
  } finally {
    await relay.close();
  }
});
