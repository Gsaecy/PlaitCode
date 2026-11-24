/**
 * 中继服务的可执行入口（被 esbuild 打成一个零依赖的 server.cjs）。
 *
 * 默认只监听 127.0.0.1：公网入口交给 nginx（TLS 终止 + 限流），
 * 这样即使 nginx 配错，中继也不会把明文端口直接暴露到公网。
 */

import { createRelayServer } from './relayServer';
import { emptyIdentity, loadIdentity } from './relayIdentity';

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

  const identity = identityPath
    ? { state: (await loadIdentity(identityPath)) ?? emptyIdentity(), path: identityPath }
    : undefined;
  if (identity) {
    console.log(`[relay] 身份模式：${identity.state.orgs.length} 组织 / ${identity.state.members.length} 成员 / ${identity.state.devices.length} 设备`);
    if (!adminToken) console.log('[relay] 警告：没设 PLAITCODE_ADMIN_TOKEN，管理接口不可用');
  }

  const handle = await createRelayServer({
    port: Number.isFinite(port) && port > 0 ? port : 8787,
    host,
    log: (line) => console.log(line),
    ...(identity ? { identity } : {}),
    ...(adminToken ? { adminToken } : {}),
    audit: {
      ...(auditPath && auditPath !== '-' ? { path: auditPath } : {}),
      ...(auditToStdout ? { sink: (line: string) => console.log(`[audit] ${line}`) } : {}),
      includeIp: process.env.PLAITCODE_AUDIT_IP !== '0',
      maxBytes: Number(process.env.PLAITCODE_AUDIT_MAX_BYTES ?? 20 * 1024 * 1024),
      keep: Number(process.env.PLAITCODE_AUDIT_KEEP ?? 5),
    },
  });

  console.log(`[relay] ready on http://${host}:${handle.port}`);
  const shutdown = (signal: string): void => {
    console.log(`[relay] ${signal}，正在关闭`);
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  console.error(`[relay] 启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
