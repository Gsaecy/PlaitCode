/**
 * GitHub 登录。
 *
 * 为什么加它：用户要的是「同一个 GitHub 账号登录，多台电脑自动组成一个协作频道」。
 * 飞书 SSO 能证明「你是谁」，但很多人的 GitHub 身份才是唯一的、跨设备的那个账号。
 *
 * 只用 `read:user`：要的是「你是哪个账号」，不是仓库读写权限。
 * 令牌与 state 的签名复用 `relayAuth`，避免两套加密代码各写一遍。
 */

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** 自建 GitHub Enterprise 时覆盖；默认官方端点。 */
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBase?: string;
}

export interface GitHubIdentity {
  /** GitHub 数字 id（字符串形式）。账号改名、换邮箱都不变，是认人的主键。 */
  githubId: string;
  login: string;
  name: string;
  email?: string;
}

const DEFAULT_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const DEFAULT_TOKEN = 'https://github.com/login/oauth/access_token';
const DEFAULT_API = 'https://api.github.com';

/** 只要读用户资料；不要仓库权限，出问题也不会碰到代码。 */
const SCOPE = 'read:user';

export function buildGitHubAuthorizeUrl(config: GitHubConfig, state: string): string {
  const url = new URL(config.authorizeUrl ?? DEFAULT_AUTHORIZE);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 授权码换身份。
 *
 * GitHub 的 token 端点默认返回 `a=b&c=d` 表单；带 `Accept: application/json` 才是 JSON。
 * 一定要带 User-Agent，否则 GitHub 直接 403。
 */
export async function exchangeGitHubCode(
  config: GitHubConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; identity: GitHubIdentity } | { ok: false; error: string }> {
  const api = (config.apiBase ?? DEFAULT_API).replace(/\/+$/, '');
  let token: string | undefined;
  try {
    const response = await fetchImpl(config.tokenUrl ?? DEFAULT_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'HWChat-Relay' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      }),
    });
    const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    token = asString(payload?.access_token);
    if (!response.ok || !token) {
      return {
        ok: false,
        error: asString(payload?.error_description) ?? asString(payload?.error) ?? `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'HWChat-Relay',
    'x-github-api-version': '2022-11-28',
  };

  let user: Record<string, unknown>;
  try {
    const response = await fetchImpl(`${api}/user`, { headers });
    if (!response.ok) return { ok: false, error: `读取 GitHub 用户失败：HTTP ${response.status}` };
    user = await response.json() as Record<string, unknown>;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const id = user.id;
  const login = asString(user.login);
  const githubId = typeof id === 'number' ? String(id) : asString(id);
  if (!githubId || !login) return { ok: false, error: 'GitHub 没有返回用户 id 或登录名' };

  // 用户资料里的 email 常为空（隐私设置）；取主邮箱需要额外 scope，这里只做补充，缺失不影响认人。
  const email = asString(user.email);
  return {
    ok: true,
    identity: {
      githubId,
      login,
      name: asString(user.name) ?? login,
      ...(email ? { email } : {}),
    },
  };
}
