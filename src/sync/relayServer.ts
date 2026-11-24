/**
 * PlaitCode 跨网中继（零依赖，单文件可部署）。
 *
 * 它**只做三件事**：收密文、按频道排队、把新密文送给在线设备。
 * 它看不到消息内容（端到端加密在两端做），也不执行任何命令 —— 越简单越安全。
 *
 * 传输用 HTTP 长轮询而不是 WebSocket：少一个依赖、少一种协议、任何反向代理都能过，
 * 对我们这种「人类说话」的频率（每秒几次都算多）足够。
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AuditLog, type AuditOptions } from './relayAudit';
import { createChannelHistory } from './relayHistory';
import { sendFeishuNotify, type NotifyPayload } from './relayNotify';
import { renderRelayMobilePage } from './relayPage';
import { APP_ICON_SVG, SERVICE_WORKER_JS, renderManifest } from './relayPwa';
import { parseCookies } from './mobileControl';
import {
  addDevice,
  addMember,
  addOrg,
  authorize,
  authorizeSession,
  findMemberByIdentity,
  identitySnapshot,
  deviceByToken,
  revokeDevice,
  saveIdentity,
  type Action,
  type IdentityState,
} from './relayIdentity';
import {
  buildAuthorizeUrl,
  emailAllowed,
  exchangeCode,
  signSession,
  signState,
  verifySession,
  verifyState,
  type FeishuConfig,
} from './relayAuth';

export interface RelayOptions {
  port?: number;
  host?: string;
  /** 每个频道最多保留多少条（环形缓冲）。 */
  maxMessages?: number;
  /** 长轮询最长挂多久。 */
  maxWaitMs?: number;
  /** 每个 IP 每分钟最多多少个请求。 */
  rateLimit?: number;
  /** 审计日志（企业客户要的「谁在什么时候发了什么」）。 */
  audit?: AuditOptions;
  /**
   * 企业身份层。**有它时 publish/poll/presence 只认设备令牌**，
   * 不再接受频道密钥；没有它时完全是原来的行为。
   */
  identity?: { state: IdentityState; path?: string };
  /** 管理接口令牌（请求头 `x-plaitcode-admin`）。不填就关闭管理接口。 */
  adminToken?: string;
  /** 飞书登录（SSO）。需要身份库一起开启。 */
  auth?: {
    config: FeishuConfig;
    secret: string;
    /** 允许自动开户的邮箱域名；空数组表示不限制（内网自用）。 */
    emailDomains?: string[];
    sessionTtlMs?: number;
  };
  log?: (line: string) => void;
  /**
   * 频道历史落盘目录。
   *
   * 只存密文（iv + ct）与元数据（seq / 发送方 / 时间），服务端仍然看不到内容。
   * 不填就不落盘，行为与之前一致（内存态，重启丢消息）。
   */
  historyDir?: string;
  /**
   * 飞书自定义机器人 webhook：任务完成 / 需要批准时推送到飞书。
   *
   * 为什么用机器人而不是 Web Push：iPhone 上 Web Push 要求"加到主屏幕"且限制多，
   * 而目标客户本来就在飞书里办公，通知落在飞书最容易被看到。
   */
  notifyHook?: string;
  /**
   * 允许已登记的设备给自己的另一台设备签发令牌（默认开）。
   *
   * 关掉后只能由管理员用 `/v1/admin/devices` 发令牌，
   * 适合"设备必须审批"的受监管场景。
   */
  selfEnroll?: boolean;
}

export interface RelayHandle {
  port: number;
  close: () => Promise<void>;
}

interface StoredMessage {
  seq: number;
  id: string;
  from: string;
  envelope: { iv: string; ct: string };
  at: number;
}

interface Channel {
  keyHash: string;
  createdAt: number;
  seq: number;
  messages: StoredMessage[];
  /**
   * 从磁盘补齐历史的一次性任务。poll/publish 在读 `messages` 前先等它，
   * 否则新设备第一次 `since=0` 会拿到空历史。
   */
  ready?: Promise<void>;
  /** 长轮询里正在等的响应。 */
  waiters: Array<() => void>;
  /** 已收到的消息 id：重复投递直接忽略（设备重连补发会用到）。 */
  seen: Set<string>;
  /** 设备在线表：deviceId → { name, platform, project, at }。 */
  presence: Map<string, { name: string; platform: string; project: string; at: number }>;
}

export const RELAY_VERSION = '1';
const BODY_LIMIT = 96 * 1024;
const PRESENCE_TTL_MS = 90_000;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        resolve(undefined);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(undefined));
  });
}

function bearer(request: IncomingMessage): string {
  const raw = request.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() ?? '';
}

/**
 * 真实客户端 IP。
 *
 * 中继只监听 127.0.0.1，前面一定有 nginx —— 这时候 `socket.remoteAddress` 永远
 * 是 127.0.0.1，如果拿它做限流，**所有用户会共用一个桶**：一个扫描器就能把
 * 所有人的额度打光。所以优先读 nginx 写的 `X-Real-IP`。
 */
function clientIp(request: IncomingMessage): string {
  const real = request.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0]!.trim();
  return (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}

export async function createRelayServer(options: RelayOptions = {}): Promise<RelayHandle> {
  const maxMessages = Math.max(20, options.maxMessages ?? 500);
  const maxWaitMs = Math.max(1_000, Math.min(options.maxWaitMs ?? 22_000, 25_000));
  const rateLimit = Math.max(10, options.rateLimit ?? 240);
  const log = options.log ?? ((): void => undefined);
  const audit = new AuditLog(options.audit);
  const channels = new Map<string, Channel>();
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const history = createChannelHistory(options.historyDir, maxMessages);

  /** 从磁盘补齐历史（只做一次）。补完把 seq 接到已有的最大值上，重启后不会重号。 */
  const hydrate = (channel: Channel, id: string): Promise<void> => {
    if (channel.ready) return channel.ready;
    channel.ready = history.load(id).then((entries) => {
      if (!entries.length) return;
      const known = new Set(channel.messages.map((item) => item.id));
      for (const entry of entries) {
        if (known.has(entry.id)) continue;
        channel.messages.push({ seq: entry.seq, id: entry.id, from: entry.from, envelope: { iv: entry.iv, ct: entry.ct }, at: entry.at });
        channel.seen.add(entry.id);
        if (entry.seq > channel.seq) channel.seq = entry.seq;
      }
      channel.messages.sort((left, right) => left.seq - right.seq);
      if (channel.messages.length > maxMessages) channel.messages = channel.messages.slice(-maxMessages);
      log(`[relay] 频道 ${id.slice(0, 8)}… 从磁盘恢复 ${entries.length} 条，seq=${channel.seq}`);
    }).catch(() => undefined);
    return channel.ready;
  };

  const channelFor = (id: string, key: string): Channel | undefined => {
    const existing = channels.get(id);
    if (existing) return existing.keyHash === sha256(key) ? existing : undefined;
    // 第一次用某个频道：谁能出示这个频道的密钥，谁就是创建者。
    if (!/^[0-9a-f]{16,64}$/.test(id)) return undefined;
    const created: Channel = {
      keyHash: sha256(key),
      createdAt: Date.now(),
      seq: 0,
      messages: [],
      waiters: [],
      seen: new Set(),
      presence: new Map(),
    };
    channels.set(id, created);
    void hydrate(created, id);
    log(`[relay] 新频道 ${id.slice(0, 8)}…`);
    return created;
  };

  const allowed = (ip: string): boolean => {
    const now = Date.now();
    const entry = buckets.get(ip);
    if (!entry || now >= entry.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= rateLimit;
  };

  /* ---------------- 企业身份层 ---------------- */

  const identity = options.identity;
  const adminToken = options.adminToken ?? '';

  /** 身份模式下的频道：鉴权已经由身份层做完，这里只负责取或建。 */
  const ensureChannel = (id: string): Channel | undefined => {
    if (!/^[0-9a-f]{16,64}$/.test(id)) return undefined;
    const existing = channels.get(id);
    if (existing) return existing;
    const created: Channel = {
      keyHash: '',
      createdAt: Date.now(),
      seq: 0,
      messages: [],
      waiters: [],
      seen: new Set(),
      presence: new Map(),
    };
    channels.set(id, created);
    void hydrate(created, id);
    log(`[relay] 新频道 ${id.slice(0, 8)}…（身份模式）`);
    return created;
  };

  /**
   * 身份模式下的鉴权：设备令牌优先；手机没有设备令牌时用飞书会话 Cookie
   * （手机只拿到"我登录了"，票据在 Cookie 里，不落 localStorage）。
   * 没有身份层时一律放行（走原来的频道密钥）。
   */
  const authorizeRequest = (
    request: IncomingMessage,
    channelId: string,
    action: Action,
  ): { ok: true; deviceId?: string; member?: string } | { ok: false; status: number; reason: string } => {
    if (!identity) return { ok: true };
    const token = bearer(request);
    if (token) {
      const verdict = authorize(identity.state, token, channelId, action);
      if (!verdict.ok) return { ok: false, status: 403, reason: verdict.reason ?? '未授权' };
      return { ok: true, deviceId: verdict.device?.id, member: verdict.member?.name };
    }
    const sso = options.auth;
    if (!sso) return { ok: false, status: 403, reason: '设备令牌无效' };
    const session = verifySession(sso.secret, parseCookies(request.headers.cookie).plaitcode_session);
    if (!session) return { ok: false, status: 401, reason: '未登录：请先用飞书登录' };
    const verdict = authorizeSession(identity.state, session.memberId, channelId, action);
    if (!verdict.ok) return { ok: false, status: 403, reason: verdict.reason ?? '未授权' };
    return { ok: true, member: verdict.member?.name };
  };

  const persistIdentity = async (): Promise<void> => {
    if (!identity?.path) return;
    await saveIdentity(identity.path, identity.state).catch((error: unknown) => {
      log(`[relay] 身份库写入失败：${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const adminMatches = (value: unknown): boolean => {
    if (!adminToken || typeof value !== 'string') return false;
    const provided = createHash('sha256').update(value).digest();
    const expected = createHash('sha256').update(adminToken).digest();
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  };

  const server: Server = createServer((request, response) => {
    void (async () => {
      const rawUrl = request.url ?? '/';
      const route = rawUrl.split('?')[0] ?? '/';
      const query = new URLSearchParams(rawUrl.slice(rawUrl.indexOf('?') + 1));

      // 健康检查、手机页面与 PWA 静态资源不限流：探活和首次打开都不该占用户额度。
      const isHealth = route === '/health' || route === '/';
      const isPwa = route === '/manifest.webmanifest' || route === '/sw.js' || route === '/icon.svg';
      const isStatic = isHealth || isPwa || route === '/m';
      if (!isStatic) {
        const ip = clientIp(request);
        if (!allowed(ip)) {
          audit.record({ event: 'denied', ip, detail: 'rate limited' });
          json(response, 429, { ok: false, error: 'too many requests' });
          return;
        }
      }

      if (request.method === 'GET' && route === '/m') {        const html = renderRelayMobilePage({
          relayHost: typeof request.headers.host === 'string' ? request.headers.host : 'plaitcode.com',
          // 身份模式下手机不再出示频道密钥，改用登录后的会话 Cookie
          sessionAuth: Boolean(identity),
        });
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(html),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
        });
        response.end(html);
        return;
      }

      /* ---------------- PWA 静态资源 ---------------- */

      if (request.method === 'GET' && route === '/manifest.webmanifest') {
        const manifest = renderManifest();
        response.writeHead(200, {
          'content-type': 'application/manifest+json; charset=utf-8',
          'content-length': Buffer.byteLength(manifest),
          'cache-control': 'public, max-age=3600',
          'x-content-type-options': 'nosniff',
        });
        response.end(manifest);
        return;
      }

      if (request.method === 'GET' && route === '/sw.js') {
        response.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'content-length': Buffer.byteLength(SERVICE_WORKER_JS),
          // service worker 必须能及时更新，否则改了逻辑用户永远拿到旧的
          'cache-control': 'no-cache',
          // 让它能接管根作用域
          'service-worker-allowed': '/',
          'x-content-type-options': 'nosniff',
        });
        response.end(SERVICE_WORKER_JS);
        return;
      }

      if (request.method === 'GET' && route === '/icon.svg') {
        response.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'content-length': Buffer.byteLength(APP_ICON_SVG),
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff',
        });
        response.end(APP_ICON_SVG);
        return;
      }

      /* ---------------- 飞书登录（SSO） ---------------- */

      if (route === '/v1/auth/feishu/start' && request.method === 'GET') {
        const auth = options.auth;
        if (!auth || !identity) {
          json(response, 404, { ok: false, error: 'sso disabled' });
          return;
        }
        const state = signState(auth.secret, crypto.randomUUID());
        response.writeHead(302, { location: buildAuthorizeUrl(auth.config, state), 'cache-control': 'no-store' });
        response.end();
        return;
      }

      if (route === '/v1/auth/feishu/callback' && request.method === 'GET') {
        const auth = options.auth;
        if (!auth || !identity) {
          json(response, 404, { ok: false, error: 'sso disabled' });
          return;
        }
        if (!verifyState(auth.secret, query.get('state') ?? undefined)) {
          audit.record({ event: 'denied', ip: clientIp(request), detail: 'sso state invalid' });
          json(response, 400, { ok: false, error: 'state 无效或已过期，请重新登录' });
          return;
        }
        const code = query.get('code') ?? '';
        if (!code) {
          json(response, 400, { ok: false, error: '缺少 code' });
          return;
        }
        const result = await exchangeCode(auth.config, code);
        if (!result.ok) {
          audit.record({ event: 'denied', ip: clientIp(request), detail: `sso exchange failed: ${result.error}` });
          json(response, 502, { ok: false, error: `飞书登录失败：${result.error}` });
          return;
        }
        if (auth.emailDomains?.length && !result.identity.email) {
          audit.record({ event: 'denied', ip: clientIp(request), detail: 'sso email missing while domain allowlist configured' });
          json(response, 403, {
            ok: false,
            error: '飞书没有返回邮箱，无法校验域名白名单。请给应用开通 contact:user.email:readonly 权限并发布版本，或把 PLAITCODE_AUTH_EMAIL_DOMAINS 清空。',
          });
          return;
        }
        if (!emailAllowed(result.identity.email, auth.emailDomains ?? [])) {
          audit.record({ event: 'denied', ip: clientIp(request), detail: `sso email not allowed: ${result.identity.email ?? '(none)'}` });
          json(response, 403, { ok: false, error: '这个邮箱不在允许的域名内' });
          return;
        }
        // 认人顺序：邮箱 → open_id → union_id；三者都没有就无法开户
        const who = result.identity;
        let member = findMemberByIdentity(identity.state, who);
        if (!member && (who.email || who.openId || who.unionId)) {
          const org = identity.state.orgs[0];
          if (!org) {
            json(response, 409, { ok: false, error: '服务端还没有组织，请管理员先建组织' });
            return;
          }
          member = addMember(identity.state, {
            orgId: org.id,
            name: who.name,
            role: 'member',
            email: who.email,
            openId: who.openId,
            unionId: who.unionId,
          });
          if (member) {
            await persistIdentity();
            audit.record({ event: 'admin', ip: clientIp(request), detail: `auto-provision ${who.email ?? who.openId ?? who.unionId}` });
          }
        }
        if (!member) {
          audit.record({ event: 'denied', ip: clientIp(request), detail: 'sso identity has no stable key' });
          json(response, 409, { ok: false, error: '无法建立成员身份：飞书没有返回可用于识别身份的标识，请联系管理员' });
          return;
        }
        // 之前靠 open_id 开的户，客户后来补开了邮箱权限：补写邮箱，后续审计和按邮箱认人都能用
        if (who.email && !member.email) {
          member.email = who.email;
          await persistIdentity();
        }
        const ttl = auth.sessionTtlMs ?? 12 * 60 * 60_000;
        const cookie = signSession(auth.secret, {
          memberId: member.id,
          name: member.name,
          ...(result.identity.email ? { email: result.identity.email } : {}),
          exp: Date.now() + ttl,
        });
        audit.record({ event: 'login', ip: clientIp(request), detail: member.name });
        response.writeHead(302, {
          location: '/m',
          'set-cookie': `plaitcode_session=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}`,
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }

      if (route === '/v1/auth/me' && request.method === 'GET') {
        const auth = options.auth;
        if (!auth) {
          json(response, 404, { ok: false, error: 'sso disabled' });
          return;
        }
        const session = verifySession(auth.secret, parseCookies(request.headers.cookie).plaitcode_session);
        if (!session) {
          json(response, 401, { ok: false, error: '未登录' });
          return;
        }
        json(response, 200, { ok: true, member: { id: session.memberId, name: session.name, email: session.email ?? null } });
        return;
      }

      if (route === '/v1/auth/logout' && request.method === 'POST') {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': 'plaitcode_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      /* ---------------- 设备自助登记 ---------------- */

      /*
       * 已连上的设备给「自己的另一台设备」签发令牌。
       *
       * 为什么要它：一个人多台电脑时，去服务器手工 curl 发令牌是最大的摩擦点，
       * 真实使用时没人愿意每次开终端。已授权的设备本来就能代表这个人说话，
       * 让它再发一张同权限的令牌，风险和"在这台电脑上多开一个窗口"相当。
       *
       * 两个硬限制：权限不能超过签发者（不能自我提权）；可在部署时关掉。
       */
      if (route === '/v1/devices/enroll' && request.method === 'POST') {
        if (!identity) {
          json(response, 404, { ok: false, error: 'identity disabled' });
          return;
        }
        if (options.selfEnroll === false) {
          json(response, 403, { ok: false, error: 'self enrollment disabled' });
          return;
        }
        // 只校验"这台设备本身有效"，不要求它在这个频道有授权：
        // 签发的是它自己的授权副本，频道授权由 grants 决定。
        const token = bearer(request);
        const candidate = token ? deviceByToken(identity.state, token) : undefined;
        const enroller = candidate
          && !candidate.revokedAt
          && (candidate.expiresAt === undefined || Date.now() <= candidate.expiresAt)
          ? candidate
          : undefined;
        if (!enroller) {
          audit.record({ event: 'denied', ip: clientIp(request), detail: 'enroll auth failed' });
          json(response, 403, { ok: false, error: '需要用已登记的设备令牌调用' });
          return;
        }
        const raw = await readBody(request);
        if (raw === undefined) {
          json(response, 413, { ok: false, error: 'body too large' });
          return;
        }
        let body: Record<string, unknown> = {};
        if (raw) {
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            json(response, 400, { ok: false, error: 'invalid json' });
            return;
          }
        }
        const created = addDevice(identity.state, {
          memberId: enroller.memberId,
          name: String(body.name ?? '新设备'),
          platform: typeof body.platform === 'string' ? body.platform : undefined,
          // 只继承签发者自己的授权：不能签发一台权限更大的设备
          channels: enroller.grants.map((grant) => ({ channelId: grant.channelId, role: grant.role })),
        });
        if (!created) {
          json(response, 409, { ok: false, error: '成员不存在' });
          return;
        }
        await persistIdentity();
        audit.record({ event: 'admin', ip: clientIp(request), detail: `self-enroll ${created.device.name}` });
        json(response, 200, {
          ok: true,
          device: { id: created.device.id, name: created.device.name, grants: created.device.grants },
          token: created.token,
        });
        return;
      }

      /* ---------------- 飞书机器人通知 ---------------- */

      if (route === '/v1/notify' && request.method === 'POST') {
        const hook = options.notifyHook?.trim();
        if (!hook) {
          json(response, 404, { ok: false, error: 'notify disabled' });
          return;
        }
        const token = bearer(request);
        const device = identity && token ? deviceByToken(identity.state, token) : undefined;
        if (identity && (!device || device.revokedAt)) {
          audit.record({ event: 'denied', ip: clientIp(request), detail: 'notify auth failed' });
          json(response, 403, { ok: false, error: '需要用已登记的设备令牌调用' });
          return;
        }
        const raw = await readBody(request);
        if (raw === undefined) {
          json(response, 413, { ok: false, error: 'body too large' });
          return;
        }
        let body: { kind?: unknown; title?: unknown; summary?: unknown; source?: unknown } = {};
        try {
          body = raw ? JSON.parse(raw) as typeof body : {};
        } catch {
          json(response, 400, { ok: false, error: 'invalid json' });
          return;
        }
        const kind: 'approval' | 'done' | 'blocked' | undefined = body.kind === 'approval' || body.kind === 'done' || body.kind === 'blocked'
          ? body.kind
          : undefined;
        if (!kind) {
          json(response, 400, { ok: false, error: 'kind must be approval/done/blocked' });
          return;
        }
        const payload: NotifyPayload = {
          kind,
          title: String(body.title ?? '').slice(0, 120),
          summary: String(body.summary ?? '').slice(0, 500),
          ...(typeof body.source === 'string' ? { source: body.source.slice(0, 120) } : {}),
        };
        const publicUrl = options.auth?.config?.redirectUri
          ? (() => { try { return new URL(options.auth!.config.redirectUri).origin; } catch { return ''; } })()
          : '';
        const result = await sendFeishuNotify(hook, payload, publicUrl ? `${publicUrl}/m` : '');
        audit.record({
          event: 'admin',
          ip: clientIp(request),
          detail: `notify ${kind} -> ${result.ok ? 'sent' : `failed: ${result.error}`}`,
        });
        json(response, result.ok ? 200 : 502, result.ok ? { ok: true } : { ok: false, error: result.error });
        return;
      }

      /* ---------------- 管理接口 ---------------- */

      if (route.startsWith('/v1/admin/')) {
        if (!identity || !adminToken) {
          json(response, 404, { ok: false, error: 'admin api disabled' });
          return;
        }
        if (!adminMatches(request.headers['x-plaitcode-admin'])) {
          audit.record({ event: 'denied', ip: clientIp(request), detail: 'admin auth failed' });
          json(response, 403, { ok: false, error: 'admin denied' });
          return;
        }
        const rawBody = request.method === 'POST' ? await readBody(request) : '';
        if (rawBody === undefined) {
          json(response, 413, { ok: false, error: 'body too large' });
          return;
        }
        let body: Record<string, unknown> = {};
        if (rawBody) {
          try {
            body = JSON.parse(rawBody) as Record<string, unknown>;
          } catch {
            json(response, 400, { ok: false, error: 'invalid json' });
            return;
          }
        }
        if (route === '/v1/admin/state' && request.method === 'GET') {
          json(response, 200, { ok: true, identity: identitySnapshot(identity.state) });
          return;
        }
        if (route === '/v1/admin/orgs' && request.method === 'POST') {
          const org = addOrg(identity.state, String(body.name ?? ''));
          await persistIdentity();
          audit.record({ event: 'admin', ip: clientIp(request), detail: `org ${org.name}` });
          json(response, 200, { ok: true, org });
          return;
        }
        if (route === '/v1/admin/members' && request.method === 'POST') {
          const member = addMember(identity.state, {
            orgId: String(body.orgId ?? ''),
            name: String(body.name ?? ''),
            role: body.role as never,
          });
          if (!member) {
            json(response, 404, { ok: false, error: 'org not found' });
            return;
          }
          await persistIdentity();
          audit.record({ event: 'admin', ip: clientIp(request), detail: `member ${member.name} (${member.role})` });
          json(response, 200, { ok: true, member });
          return;
        }
        if (route === '/v1/admin/devices' && request.method === 'POST') {
          const channelsInput = Array.isArray(body.channels) ? body.channels : [];
          const created = addDevice(identity.state, {
            memberId: String(body.memberId ?? ''),
            name: String(body.name ?? ''),
            platform: typeof body.platform === 'string' ? body.platform : undefined,
            channels: channelsInput
              .filter((item): item is { channelId?: unknown; role?: unknown } => Boolean(item) && typeof item === 'object')
              .map((item) => ({ channelId: String(item.channelId ?? ''), role: item.role as never })),
          });
          if (!created) {
            json(response, 404, { ok: false, error: 'member not found' });
            return;
          }
          await persistIdentity();
          audit.record({ event: 'admin', ip: clientIp(request), detail: `device ${created.device.name} for ${created.device.memberId}` });
          // 明文令牌只在这里出现一次：库里只有哈希，丢了只能重新发一台
          json(response, 200, { ok: true, device: { id: created.device.id, memberId: created.device.memberId, name: created.device.name, grants: created.device.grants }, token: created.token });
          return;
        }
        if (route === '/v1/admin/devices/revoke' && request.method === 'POST') {
          const revoked = revokeDevice(identity.state, String(body.deviceId ?? ''));
          await persistIdentity();
          audit.record({ event: 'admin', ip: clientIp(request), detail: `revoke ${String(body.deviceId ?? '')} -> ${revoked}` });
          json(response, revoked ? 200 : 404, { ok: revoked });
          return;
        }
        json(response, 404, { ok: false, error: 'not found' });
        return;
      }

      if (request.method === 'GET' && isHealth) {
        json(response, 200, {
          ok: true,
          service: 'plaitcode-relay',
          version: RELAY_VERSION,
          channels: channels.size,
          uptime: Math.round(process.uptime()),
        });
        return;
      }

      if (!route.startsWith('/v1/')) {
        json(response, 404, { ok: false, error: 'not found' });
        return;
      }

      if (request.method === 'GET' && route === '/v1/poll') {
        const id = query.get('channel') ?? '';
        const verdict = authorizeRequest(request, id, 'poll');
        if (!verdict.ok) {
          audit.record({ event: 'denied', channel: id.slice(0, 32), ip: clientIp(request), detail: verdict.reason });
          json(response, verdict.status, { ok: false, error: verdict.reason });
          return;
        }
        const channel = identity ? ensureChannel(id) : channelFor(id, bearer(request));
        if (!channel) {
          json(response, 403, { ok: false, error: 'channel denied' });
          return;
        }
        // 新设备第一次 since=0：先等磁盘历史补齐，否则这一轮拿到空数组，
        // 客户端会以为频道是空的。
        if (channel.ready) await channel.ready;
        const since = Number(query.get('since') ?? 0) || 0;
        const wait = Math.min(Math.max(Number(query.get('wait') ?? 20) * 1000 || 20_000, 0), maxWaitMs);
        const collect = (): StoredMessage[] => channel.messages.filter((item) => item.seq > since);
        const immediate = collect();
        if (immediate.length || wait === 0) {
          json(response, 200, { ok: true, messages: immediate.slice(-200), seq: channel.seq });
          return;
        }
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          const index = channel.waiters.indexOf(finish);
          if (index >= 0) channel.waiters.splice(index, 1);
          clearTimeout(timer);
          if (response.writableEnded) return;
          json(response, 200, { ok: true, messages: collect().slice(-200), seq: channel.seq });
        };
        const timer = setTimeout(finish, wait);
        timer.unref?.();
        channel.waiters.push(finish);
        // 客户端断开（刷新页面、切网络）时要立刻释放，否则连接会越堆越多。
        request.on('close', () => {
          if (done) return;
          done = true;
          const index = channel.waiters.indexOf(finish);
          if (index >= 0) channel.waiters.splice(index, 1);
          clearTimeout(timer);
        });
        return;
      }

      if (request.method === 'POST' && route === '/v1/publish') {
        const raw = await readBody(request);
        if (!raw) {
          json(response, 413, { ok: false, error: 'body too large' });
          return;
        }
        let parsed: { channel?: unknown; id?: unknown; from?: unknown; envelope?: { iv?: unknown; ct?: unknown } };
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          json(response, 400, { ok: false, error: 'invalid json' });
          return;
        }
        const id = typeof parsed.channel === 'string' ? parsed.channel : '';
        const messageId = typeof parsed.id === 'string' ? parsed.id.slice(0, 80) : '';
        const from = typeof parsed.from === 'string' ? parsed.from.slice(0, 80) : '';
        const iv = typeof parsed.envelope?.iv === 'string' ? parsed.envelope.iv : '';
        const ct = typeof parsed.envelope?.ct === 'string' ? parsed.envelope.ct : '';
        if (!messageId || !from || !iv || !ct || ct.length > 64 * 1024) {
          json(response, 400, { ok: false, error: 'invalid message' });
          return;
        }
        const verdict = authorizeRequest(request, id, 'publish');
        if (!verdict.ok) {
          audit.record({ event: 'denied', channel: id.slice(0, 32), ip: clientIp(request), detail: verdict.reason });
          json(response, verdict.status, { ok: false, error: verdict.reason });
          return;
        }
        const channel = identity ? ensureChannel(id) : channelFor(id, bearer(request));
        if (!channel) {
          audit.record({ event: 'denied', channel: id.slice(0, 32), ip: clientIp(request), detail: 'channel denied' });
          json(response, 403, { ok: false, error: 'channel denied' });
          return;
        }
        // 系统重启后第一次发：先把历史读进来，否则 seq 会从 1 重来，
        // 客户端拿着 since=37 就再也收不到新消息。
        if (channel.ready) await channel.ready;
        if (channel.seen.has(messageId)) {
          audit.record({ event: 'publish', channel: id, device: from, message: messageId, ip: clientIp(request), detail: 'duplicate' });
          json(response, 200, { ok: true, duplicate: true, seq: channel.seq });
          return;
        }
        channel.seq += 1;
        channel.seen.add(messageId);
        audit.record({ event: 'publish', channel: id, device: from, message: messageId, ip: clientIp(request), bytes: ct.length });
        if (channel.seen.size > maxMessages * 4) {
          // 只保留最近的一段，防止内存被长期占用。
          channel.seen = new Set([...channel.seen].slice(-maxMessages * 2));
        }
        const stored: StoredMessage = { seq: channel.seq, id: messageId, from, envelope: { iv, ct }, at: Date.now() };
        channel.messages.push(stored);
        // 落盘只写密文与元数据；失败不影响本轮（内存里已经有了，只是重启会丢这一条）
        history.append(id, { seq: stored.seq, id: stored.id, from: stored.from, iv, ct, at: stored.at });
        if (channel.messages.length > maxMessages) channel.messages = channel.messages.slice(-maxMessages);
        for (const wake of [...channel.waiters]) wake();
        json(response, 200, { ok: true, seq: channel.seq });
        return;
      }

      if (route === '/v1/presence') {
        const key = bearer(request);
        let id = query.get('channel') ?? '';
        let device: { id?: unknown; name?: unknown; platform?: unknown; project?: unknown } | undefined;
        if (request.method === 'POST') {
          const raw = await readBody(request);
          if (!raw) {
            json(response, 413, { ok: false, error: 'body too large' });
            return;
          }
          let parsed: { channel?: unknown; device?: typeof device };
          try {
            parsed = JSON.parse(raw) as typeof parsed;
          } catch {
            json(response, 400, { ok: false, error: 'invalid json' });
            return;
          }
          id = typeof parsed.channel === 'string' ? parsed.channel : '';
          device = parsed.device;
        }
        const verdict = authorizeRequest(request, id, 'presence');
        if (!verdict.ok) {
          audit.record({ event: 'denied', channel: id.slice(0, 32), ip: clientIp(request), detail: verdict.reason });
          json(response, verdict.status, { ok: false, error: verdict.reason });
          return;
        }
        const channel = identity ? ensureChannel(id) : channelFor(id, key);
        if (!channel) {
          json(response, 403, { ok: false, error: 'channel denied' });
          return;
        }
        if (device) {
          // 身份模式下设备身份以令牌为准，客户端自报的 id 不可信
          const deviceId = verdict.deviceId ?? (typeof device.id === 'string' ? device.id.slice(0, 80) : '');
          if (!deviceId) {
            json(response, 400, { ok: false, error: 'invalid device' });
            return;
          }
          channel.presence.set(deviceId, {
            name: verdict.member
              ? `${verdict.member} · ${typeof device.name === 'string' ? device.name.slice(0, 60) : '设备'}`
              : (typeof device.name === 'string' ? device.name.slice(0, 120) : deviceId),
            platform: typeof device.platform === 'string' ? device.platform : 'unknown',
            project: typeof device.project === 'string' ? device.project.slice(0, 120) : '',
            at: Date.now(),
          });
        }
        const now = Date.now();
        for (const [deviceId, entry] of channel.presence) {
          if (now - entry.at > PRESENCE_TTL_MS) channel.presence.delete(deviceId);
        }
        json(response, 200, {
          ok: true,
          devices: [...channel.presence.entries()].map(([deviceId, entry]) => ({ id: deviceId, ...entry })),
        });
        return;
      }

      json(response, 404, { ok: false, error: 'not found' });
    })().catch((error: unknown) => {
      log(`[relay] 请求处理失败：${error instanceof Error ? error.message : String(error)}`);
      if (!response.writableEnded) json(response, 500, { ok: false, error: 'internal error' });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8787, options.host ?? '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : (options.port ?? 8787);
  log(`[relay] 监听 ${options.host ?? '0.0.0.0'}:${port}`);
  audit.record({ event: 'startup', detail: `listen ${options.host ?? '0.0.0.0'}:${port}` });

  return {
    port,
    close: () => new Promise<void>((resolve) => {
      audit.record({ event: 'shutdown' });
      for (const channel of channels.values()) {
        for (const wake of [...channel.waiters]) wake();
      }
      server.close(() => {
        void Promise.all([audit.flush(), history.flush()]).then(() => resolve());
      });
      // 长轮询会把 close 拖住，给一个上限。
      setTimeout(() => resolve(), 1_500).unref?.();
    }),
  };
}
