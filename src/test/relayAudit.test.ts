import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AuditLog } from '../sync/relayAudit';

/** 中继审计：一行一条 JSON、不含明文、会轮转、可以关掉 IP。 */

test('审计：写 JSONL，字段齐全，且不可能出现消息正文', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-audit-'));
  const path = join(dir, 'audit.jsonl');
  try {
    const audit = new AuditLog({ path, includeIp: true });
    audit.record({ event: 'publish', channel: 'abc123', device: 'dev-win', message: 'm-1', ip: '203.0.113.7', bytes: 128 });
    audit.record({ event: 'denied', ip: '203.0.113.8', detail: 'channel denied' });
    await audit.flush();

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(first.event, 'publish');
    assert.equal(first.channel, 'abc123');
    assert.equal(first.device, 'dev-win');
    assert.equal(first.message, 'm-1');
    assert.equal(first.ip, '203.0.113.7');
    assert.equal(first.bytes, 128);
    assert.match(String(first.ts), /^\d{4}-\d{2}-\d{2}T/);

    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    assert.equal(second.event, 'denied');
    assert.equal(second.detail, 'channel denied');
    assert.equal('bytes' in second, false, '没传的字段不该凭空出现');

    // 审计是元数据：正文根本没进这一层
    assert.equal((await readFile(path, 'utf8')).includes('托盘图标'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('审计：可以关掉 IP（某些地区 IP 属于个人信息）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-audit-'));
  const path = join(dir, 'audit.jsonl');
  try {
    const audit = new AuditLog({ path, includeIp: false });
    audit.record({ event: 'publish', channel: 'c1', device: 'dev', ip: '203.0.113.7' });
    await audit.flush();
    const entry = JSON.parse((await readFile(path, 'utf8')).trim()) as Record<string, unknown>;
    assert.equal('ip' in entry, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('审计：超过单文件上限会轮转，历史文件不会无限增长', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-audit-'));
  const path = join(dir, 'audit.jsonl');
  try {
    const audit = new AuditLog({ path, maxBytes: 4 * 1024, keep: 2 });
    for (let index = 0; index < 120; index += 1) {
      audit.record({ event: 'publish', channel: `channel-${index}`, device: 'dev-win', message: `m-${index}` });
    }
    await audit.flush();

    const current = await readFile(path, 'utf8').catch(() => '');
    assert.ok(current.length > 0);
    assert.ok(current.length <= 4 * 1024 + 512, '当前文件不该远超上限');
    // 至少产生过一次轮转
    const rotated = await readFile(`${path}.1`, 'utf8').catch(() => '');
    assert.ok(rotated.length > 0, '应该存在 .1 历史文件');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
