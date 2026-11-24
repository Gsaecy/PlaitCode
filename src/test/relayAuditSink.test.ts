import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import test from 'node:test';
import { createSink, parseSink, toOtlpPayload } from '../sync/relayAuditSink';

/** 审计外送：三种接法都要能解析，且真的把行送出去。 */

test('外送地址解析：syslog / syslog+tcp / webhook / otlp', () => {
  const udp = parseSink('syslog://10.0.0.5:514');
  assert.equal(udp?.kind, 'syslog');
  assert.equal(udp?.url.hostname, '10.0.0.5');
  assert.equal(udp?.url.port, '514');

  assert.equal(parseSink('syslog+tcp://siem.internal:1514')?.kind, 'syslog-tcp');
  assert.equal(parseSink('https://siem.example.com/ingest')?.kind, 'webhook');
  assert.equal(parseSink('otlp+http://collector:4318/v1/logs')?.kind, 'otlp');
  assert.equal(parseSink('otlp+http://collector:4318/v1/logs')?.url.pathname, '/v1/logs');

  assert.equal(parseSink(''), undefined);
  assert.equal(parseSink('ftp://nope'), undefined);
  assert.equal(parseSink(undefined), undefined);
});

test('webhook：整行 JSON 原样 POST 出去', async () => {
  const received: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const sink = createSink({ kind: 'webhook', url: new URL(`http://127.0.0.1:${port}/ingest`) });
    sink.send('{"ts":"2026-11-24T00:00:00.000Z","event":"publish","channel":"c1"}');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(received.length, 1);
    assert.match(received[0]!, /"event":"publish"/);
  } finally {
    server.close();
  }
});

test('OTLP：包成 resourceLogs / scopeLogs / logRecords，时间戳是纳秒', () => {
  const payload = JSON.parse(toOtlpPayload('{"ts":"2026-11-24T00:00:00.000Z","event":"publish"}', 'relay-host')) as {
    resourceLogs: Array<{
      resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
      scopeLogs: Array<{ logRecords: Array<{ timeUnixNano: string; body: { stringValue: string } }> }>;
    }>;
  };
  const resource = payload.resourceLogs[0]!;
  assert.equal(resource.resource.attributes.some((item) => item.key === 'service.name'), true);
  const record = resource.scopeLogs[0]!.logRecords[0]!;
  assert.equal(record.timeUnixNano, '1795478400000000000');
  assert.match(record.body.stringValue, /"event":"publish"/);
});

test('syslog：UDP 上收到 RFC5424 行，正文里带完整 JSON', async () => {
  const socket = createSocket('udp4');
  const messages: string[] = [];
  socket.on('message', (message) => messages.push(message.toString('utf8')));
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  try {
    const sink = createSink({ kind: 'syslog', url: new URL(`http://127.0.0.1:${port}`) }, { hostname: 'relay-host' });
    sink.send('{"event":"denied","detail":"channel denied"}');
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(messages.length, 1);
    assert.match(messages[0]!, /^<14>1 - relay-host plaitcode-relay - AUDIT - /);
    assert.match(messages[0]!, /"event":"denied"/);
    sink.close();
  } finally {
    socket.close();
  }
});
