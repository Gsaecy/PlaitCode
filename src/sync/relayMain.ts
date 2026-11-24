/**
 * 中继服务的可执行入口（被 esbuild 打成一个零依赖的 server.cjs）。
 *
 * 默认只监听 127.0.0.1：公网入口交给 nginx（TLS 终止 + 限流），
 * 这样即使 nginx 配错，中继也不会把明文端口直接暴露到公网。
 */

import { createRelayServer } from './relayServer';
import { emptyIdentity, loadIdentity } from './relayIdentity';
import { createSink, parseSink } from './relayAuditSink';
import type { FeishuConfig } from './relayAuth';
import { hostname as osHostname } from 'node:os';
import { dirname, join } from 'node:path';

async function main(): Promise<void> {
  const port = Number(process.env.PLAITCODE_PORT ?? 8787);
  const host = process.env.PLAITCODE_HOST ?? '127.0.0.1';
  /** 审计日志落盘路径；设为 `-` 表示只走 stdout（交给 journald）。 */
  const auditPath = process.env.PLAITCODE_AUDIT ?? '/var/lib/plaitcode-relay/audit.jsonl';
  const auditToStdout = process.env.PLAITCODE_AUDIT_STDOUT !== '0';
  /**
   * 企业身份层：给了库路径就启用（orgs/members/devices），
   * 没给就还是原来的「频道密钥」模式。
   */
  const identityPath = process.env.PLAITCODE_IDENTITY?.trim();
  const adminToken = process.env.PLAITCODE_ADMIN_TOKEN?.trim() ?? '';
  /**
   * 频道历史落盘目录：只存密文与元数据。
   * 默认放在审计日志旁边；设成 `-` 可关闭（回到纯内存）。
   */
  const historySetting = process.env.PLAITCODE_HISTORY?.trim();
  const historyDir = historySetting === '-'
    ? undefined
    : (historySetting || (auditPath !== '-' ? join(dirname(auditPath), 'channels') : '/var/lib/plaitcode-relay/channels'));

  const identity = identityPath
    ? { state: (await loadIdentity(identityPath)) ?? emptyIdentity(), path: identityPath }
    : undefined;
  if (identity) {
    console.log(`[relay] 身份模式：${identity.state.orgs.length} 组织 / ${identity.state.members.length} 成员 / ${identity.state.devices.length} 设备`);
    if (!adminToken) console.log('[relay] 警告：没设 PLAITCODE_ADMIN_TOKEN，管理接口不可用');
  }

  /* 审计外送：`PLAITCODE_AUDIT_SINK=syslog://host:514 | https://siem/ingest | otlp+http://collector/v1/logs` */
  const sinkSpec = parseSink(process.env.PLAITCODE_AUDIT_SINK);
  const externalSink = sinkSpec ? createSink(sinkSpec, { hostname: osHostname() }) : undefined;
  if (sinkSpec) console.log(`[relay] 审计外送：${sinkSpec.kind} → ${sinkSpec.url.host}`);

  /* 飞书登录（SSO）：四个环境变量齐了才启用 */
  const feishuAppId = process.env.PLAITCODE_FEISHU_APP_ID?.trim() ?? '';
  const feishuSecret = process.env.PLAITCODE_FEISHU_APP_SECRET?.trim() ?? '';
  const authSecret = process.env.PLAITCODE_AUTH_SECRET?.trim() ?? '';
  const publicUrl = (process.env.PLAITCODE_PUBLIC_URL?.trim() || 'https://plaitcode.com').replace(/\/+$/, '');
  const feishuConfig: FeishuConfig | undefined = feishuAppId && feishuSecret
    ? {
      appId: feishuAppId,
      appSecret: feishuSecret,
      redirectUri: `${publicUrl}/v1/auth/feishu/callback`,
      ...(process.env.PLAITCODE_FEISHU_AUTHORIZE ? { endpoints: { authorize: process.env.PLAITCODE_FEISHU_AUTHORIZE } } : {}),
      ...(process.env.PLAITCODE_FEISHU_TOKEN ? { endpoints: { token: process.env.PLAITCODE_FEISHU_TOKEN } } : {}),
      ...(process.env.PLAITCODE_FEISHU_USERINFO ? { endpoints: { userinfo: process.env.PLAITCODE_FEISHU_USERINFO } } : {}),
    }
    : undefined;
  const sso = feishuConfig && authSecret && identity
    ? {
      config: feishuConfig,
      secret: authSecret,
      emailDomains: (process.env.PLAITCODE_AUTH_EMAIL_DOMAINS ?? '').split(',').map((item) => item.trim()).filter(Boolean),
    }
    : undefined;
  if (sso) console.log('[relay] 飞书登录已启用');
  else if (feishuAppId) console.log('[relay] 警告：飞书登录需要 PLAITCODE_AUTH_SECRET 与身份库（PLAITCODE_IDENTITY）');
  if (process.env.PLAITCODE_FEISHU_WEBHOOK?.trim()) console.log('[relay] 飞书机器人通知已启用');

  const handle = await createRelayServer({
    port: Number.isFinite(port) && port > 0 ? port : 8787,
    host,
    log: (line) => console.log(line),
    ...(identity ? { identity } : {}),
    ...(adminToken ? { adminToken } : {}),
    ...(sso ? { auth: sso } : {}),
    ...(historyDir ? { historyDir } : {}),
    ...(process.env.PLAITCODE_SELF_ENROLL === '0' ? { selfEnroll: false } : {}),
    ...(process.env.PLAITCODE_FEISHU_WEBHOOK?.trim() ? { notifyHook: process.env.PLAITCODE_FEISHU_WEBHOOK.trim() } : {}),
    audit: {
      ...(auditPath && auditPath !== '-' ? { path: auditPath } : {}),
      sink: ((line: string) => {
        if (auditToStdout) console.log(`[audit] ${line}`);
        externalSink?.send(line);
      }),
      includeIp: process.env.PLAITCODE_AUDIT_IP !== '0',
      maxBytes: Number(process.env.PLAITCODE_AUDIT_MAX_BYTES ?? 20 * 1024 * 1024),
      keep: Number(process.env.PLAITCODE_AUDIT_KEEP ?? 5),
    },
  });

  console.log(`[relay] ready on http://${host}:${handle.port}`);
  const shutdown = (signal: string): void => {
    console.log(`[relay] ${signal}，正在关闭`);
    externalSink?.close();
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  console.error(`[relay] 启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
