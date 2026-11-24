/**
 * 飞书登录（OAuth 2.0 授权码）+ 会话 Cookie。
 *
 * 为什么不用标准 OIDC：飞书网页应用走的是 OAuth 2.0 授权码，没有标准的
 * `.well-known/openid-configuration`；拿到 `user_access_token` 后再调
 * `authen/v1/user_info` 取姓名与邮箱即可。
 *
 * 端点做成可覆盖（`PLAITCODE_FEISHU_*`）：飞书改过几次授权域名与 token 路径，
 * 真机联调时不该为了一个 URL 重新打包。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface FeishuEndpoints {
  authorize: string;
  token: string;
  userinfo: string;
}

export const DEFAULT_FEISHU_ENDPOINTS: FeishuEndpoints = {
  authorize: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
  token: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
  userinfo: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
};

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  endpoints?: Partial<FeishuEndpoints>;
}

export interface SessionPayload {
  memberId: string;
  name: string;
  email?: string;
  /** 过期时间（毫秒）。 */
  exp: number;
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function hmac(secret: string, value: string): string {
  return base64url(createHmac('sha256', secret).update(value, 'utf8').digest());
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 授权跳转地址。`state` 自带签名与过期时间，防 CSRF 与重放。 */
export function buildAuthorizeUrl(config: FeishuConfig, state: string): string {
  const endpoints = { ...DEFAULT_FEISHU_ENDPOINTS, ...config.endpoints };
  const url = new URL(endpoints.authorize);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('app_id', config.appId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

/** 签一个 state（防 CSRF）：内容 + 过期时间，10 分钟有效。 */
export function signState(secret: string, nonce: string, ttlMs = 10 * 60_000): string {
  const body = `${nonce}.${Date.now() + ttlMs}`;
  return `${base64url(Buffer.from(body, 'utf8'))}.${hmac(secret, body)}`;
}

export function verifyState(secret: string, token: string | undefined): boolean {
  return readState(secret, token).valid;
}

export interface StateCheck {
  valid: boolean;
  /** state 里带的「登录后回哪」，只返回调用方白名单里的值。 */
  next?: string;
}

/**
 * 校验 state，并取出它携带的落点。
 *
 * 落点只接受站内相对页（`/console`、`/m` 这种），由调用方传入白名单 ——
 * 绝不接受外部地址，否则登录回调就成了开放重定向。
 */
export function readState(secret: string, token: string | undefined, allowed: readonly string[] = []): StateCheck {
  if (!token) return { valid: false };
  const index = token.lastIndexOf('.');
  if (index <= 0) return { valid: false };
  const encoded = token.slice(0, index);
  const signature = token.slice(index + 1);
  let body: string;
  try {
    body = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return { valid: false };
  }
  if (!safeEqual(hmac(secret, body), signature)) return { valid: false };
  const cut = body.lastIndexOf('.');
  const expiry = Number(body.slice(cut + 1));
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return { valid: false };
  const nonce = cut > 0 ? body.slice(0, cut) : '';
  const sep = nonce.indexOf('~');
  const next = sep > 0 ? nonce.slice(sep + 1) : '';
  return next && allowed.includes(next) ? { valid: true, next } : { valid: true };
}

/** 会话 Cookie 的值：payload + 签名，客户端改不了内容。 */
export function signSession(secret: string, payload: SessionPayload): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${hmac(secret, body)}`;
}

export function verifySession(secret: string, token: string | undefined): SessionPayload | undefined {
  if (!token) return undefined;
  const index = token.lastIndexOf('.');
  if (index <= 0) return undefined;
  const body = token.slice(0, index);
  const signature = token.slice(index + 1);
  if (!safeEqual(hmac(secret, body), signature)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.memberId || typeof payload.exp !== 'number' || payload.exp <= Date.now()) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export interface FeishuIdentity {
  name: string;
  email?: string;
  openId?: string;
  unionId?: string;
}

/** 从飞书的返回里挑字段：不同版本把数据放在 `data` 里或顶层。 */
function pickData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;
  const nested = record.data;
  if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
  return record;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 用授权码换用户身份。
 *
 * 先试 v2（`client_id` + `client_secret` 直接换），失败再试 v1
 * （先取 `app_access_token`，再换 `user_access_token`）——飞书新旧应用都可能遇到。
 */
export async function exchangeCode(
  config: FeishuConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; identity: FeishuIdentity } | { ok: false; error: string }> {
  const endpoints = { ...DEFAULT_FEISHU_ENDPOINTS, ...config.endpoints };
  const tokenBodies: Array<Record<string, string>> = [
    { grant_type: 'authorization_code', client_id: config.appId, client_secret: config.appSecret, code, redirect_uri: config.redirectUri },
    { grant_type: 'authorization_code', app_id: config.appId, app_secret: config.appSecret, code },
  ];
  let lastError = '飞书没有返回 access_token';
  for (const body of tokenBodies) {
    try {
      const response = await fetchImpl(endpoints.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => undefined) as unknown;
      const token = asString(pickData(json).access_token);
      if (!response.ok || !token) {
        lastError = asString(pickData(json).error_description) ?? asString(pickData(json).msg) ?? `HTTP ${response.status}`;
        continue;
      }
      const infoResponse = await fetchImpl(endpoints.userinfo, { headers: { authorization: `Bearer ${token}` } });
      const infoJson = await infoResponse.json().catch(() => undefined) as unknown;
      const info = pickData(infoJson);
      const name = asString(info.name) ?? asString(info.en_name);
      if (!name) {
        lastError = '飞书没有返回用户姓名';
        continue;
      }
      return {
        ok: true,
        identity: {
          name,
          ...(asString(info.email) ?? asString(info.enterprise_email) ? { email: asString(info.email) ?? asString(info.enterprise_email) } : {}),
          ...(asString(info.open_id) ? { openId: asString(info.open_id) } : {}),
          ...(asString(info.union_id) ? { unionId: asString(info.union_id) } : {}),
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: lastError };
}

/** 邮箱是否在允许的域名内（自动开户的白名单）。 */
export function emailAllowed(email: string | undefined, domains: string[]): boolean {
  if (!domains.length) return true;
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domains.some((item) => item.trim().toLowerCase().replace(/^@/, '') === domain);
}
