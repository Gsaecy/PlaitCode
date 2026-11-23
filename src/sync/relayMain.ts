/**
 * 中继服务的可执行入口（被 esbuild 打成一个零依赖的 server.cjs）。
 *
 * 默认只监听 127.0.0.1：公网入口交给 nginx（TLS 终止 + 限流），
 * 这样即使 nginx 配错，中继也不会把明文端口直接暴露到公网。
 */

import { createRelayServer } from './relayServer';

const port = Number(process.env.PLAITCODE_PORT ?? 8787);
const host = process.env.PLAITCODE_HOST ?? '127.0.0.1';

void createRelayServer({
  port: Number.isFinite(port) && port > 0 ? port : 8787,
  host,
  log: (line) => console.log(line),
}).then((handle) => {
  console.log(`[relay] ready on http://${host}:${handle.port}`);
  const shutdown = (signal: string): void => {
    console.log(`[relay] ${signal}，正在关闭`);
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}).catch((error: unknown) => {
  console.error(`[relay] 启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
