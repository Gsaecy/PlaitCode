/**
 * 审计外送：把 JSONL 审计行转发到企业已有的日志平台。
 *
 * 三种接法，覆盖绝大多数 SIEM：
 *  - `syslog://host:514`（UDP）/ `syslog+tcp://host:514`（TCP，可靠）→ 传统 SIEM、系统日志
 *  - `https://siem.example.com/ingest` → 通用 webhook（Splunk HEC / Datadog / 自建都能收）
 *  - `otlp+http://collector:4318/v1/logs` → OpenTelemetry（走 OTel Collector 接任何后端）
 *
 * 一律 fire-and-forget：**日志平台挂了不能影响中继本身**。失败只记一次本地告警，
 * 不重试、不排队 —— 审计的完整性由本地 JSONL 保证，外送只是方便集中检索。
 */

import { createSocket } from 'node:dgram';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tcpConnect } from 'node:net';

export type SinkKind = 'syslog' | 'syslog-tcp' | 'webhook' | 'otlp';

export interface SinkSpec {
  kind: SinkKind;
  url: URL;
}

/** 解析 `PLAITCODE_AUDIT_SINK`；认不出来就返回 undefined（服务照常跑）。 */
export function parseSink(raw: string | undefined): SinkSpec | undefined {
  const value = (raw ?? '').trim();
  if (!value) return undefined;
  try {
    if (/^otlp\+https?:\/\//i.test(value)) {
      return { kind: 'otlp', url: new URL(value.replace(/^otlp\+/i, '')) };
    }
    if (/^syslog\+tcp:\/\//i.test(value)) {
      return { kind: 'syslog-tcp', url: new URL(value.replace(/^syslog\+tcp:/i, 'http:')) };
    }
    if (/^syslog:\/\//i.test(value)) {
      return { kind: 'syslog', url: new URL(value.replace(/^syslog:/i, 'http:')) };
    }
    if (/^https?:\/\//i.test(value)) {
      return { kind: 'webhook', url: new URL(value) };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface Sink {
  send: (line: string) => void;
  close: () => void;
}

function post(url: URL, body: string, timeoutMs: number): void {
  let target: URL;
  try {
    target = url;
  } catch {
    return;
  }
  const payload = Buffer.from(body, 'utf8');
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const request = send(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
    timeout: timeoutMs,
  }, (response) => { response.resume(); });
  request.on('timeout', () => request.destroy());
  request.on('error', () => undefined);
  request.end(payload);
}

/** OTLP/HTTP JSON：一条审计行 = 一条 logRecord。 */
export function toOtlpPayload(line: string, hostname: string): string {
  let nanos = `${Date.now()}000000`;
  try {
    const parsed = JSON.parse(line) as { ts?: unknown };
    if (typeof parsed.ts === 'string') {
      const ms = Date.parse(parsed.ts);
      if (Number.isFinite(ms)) nanos = `${ms}000000`;
    }
  } catch {
    // 不是合法 JSON 也照发，正文原样放在 body 里
  }
  return JSON.stringify({
    resourceLogs: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'plaitcode-relay' } },
          { key: 'host.name', value: { stringValue: hostname } },
        ],
      },
      scopeLogs: [{
        scope: { name: 'plaitcode.audit' },
        logRecords: [{ timeUnixNano: nanos, severityText: 'INFO', body: { stringValue: line } }],
      }],
    }],
  });
}

export function createSink(spec: SinkSpec, options: { hostname?: string } = {}): Sink {
  const hostname = options.hostname ?? 'plaitcode-relay';
  if (spec.kind === 'webhook') {
    return { send: (line) => post(spec.url, line, 5_000), close: () => undefined };
  }
  if (spec.kind === 'otlp') {
    return { send: (line) => post(spec.url, toOtlpPayload(line, hostname), 5_000), close: () => undefined };
  }
  const host = spec.url.hostname;
  const port = Number(spec.url.port || 514);
  if (spec.kind === 'syslog') {
    const socket = createSocket('udp4');
    socket.on('error', () => undefined);
    socket.unref?.();
    return {
      send: (line) => {
        const message = `<14>1 - ${hostname} plaitcode-relay - AUDIT - ${line}`;
        try {
          socket.send(Buffer.from(message, 'utf8'), port, host, () => undefined);
        } catch {
          // 对端不在也照常跑
        }
      },
      close: () => { try { socket.close(); } catch { /* 已关闭 */ } },
    };
  }
  // syslog-tcp：每条一行，断了就重连（不排队，避免内存被日志吃满）
  let connection: ReturnType<typeof tcpConnect> | undefined;
  const ensure = (): ReturnType<typeof tcpConnect> | undefined => {
    if (connection && !connection.destroyed) return connection;
    connection = tcpConnect(port, host, () => undefined);
    connection.on('error', () => { connection = undefined; });
    connection.on('close', () => { connection = undefined; });
    connection.unref?.();
    return connection;
  };
  return {
    send: (line) => {
      const socket = ensure();
      if (!socket) return;
      try {
        socket.write(`<14>1 - ${hostname} plaitcode-relay - AUDIT - ${line}\n`);
      } catch {
        connection = undefined;
      }
    },
    close: () => { try { connection?.destroy(); } catch { /* 已关闭 */ } },
  };
}
