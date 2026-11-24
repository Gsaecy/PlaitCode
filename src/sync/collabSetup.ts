/**
 * 「开始协作」的全流程：一次把登录、频道、密钥全部安排好。
 *
 * 用户视角只有两步：点一下命令 → 在浏览器里用 GitHub 登录。
 * 剩下这些都在这里自动走完：
 *  1. 拿设备码，打开浏览器登录；
 *  2. 轮询到设备令牌（登录成功后服务端已为这台设备登记）；
 *  3. 手上还没有频道就自己生成一个并认领；
 *  4. 登记本机公钥；
 *  5. 如果是这一账号的第 N 台设备，等老设备把频道密钥加密送过来。
 *
 * 每一步都允许中断后重跑：已保存的令牌 / 密钥会被复用，不会重复建频道。
 */

import { deriveKeys, newPairingSecret } from './relayCrypto';
import { createHandoffKeyPair, type HandoffKeyPair } from './handoffCrypto';
import { handoffRound, registerHandoffKey } from './handoffClient';

export interface QuickStartDeps {
  /** 中继地址，例如 https://plaitcode.com 。 */
  relayUrl: string;
  /** 这台设备在控制台里显示的名字。 */
  deviceName: string;
  platform: string;
  /** 已保存的频道密钥；有就复用，没有就新建。 */
  existingSecret?: string;
  /** 已保存的设备令牌；有就跳过登录。 */
  existingToken?: string;
  /** 已保存的交接密钥对；没有就生成。 */
  keyPair?: HandoffKeyPair;
  onProgress?: (message: string) => void;
  /** 打开浏览器的动作由调用方注入（扩展里是 vscode.env.openExternal）。 */
  openUrl?: (url: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** 登录最多等多久，默认 10 分钟。 */
  loginTimeoutMs?: number;
  /** 等别的设备递密钥最多等多久，默认 90 秒。 */
  handoffTimeoutMs?: number;
}

export interface QuickStartResult {
  ok: boolean;
  secret?: string;
  token?: string;
  keyPair?: HandoffKeyPair;
  /** 登录后拿到的成员名，用于提示。 */
  memberName?: string;
  channelId?: string;
  /** 还在等另一台设备递密钥（此时还没有 secret）。 */
  waitingForKey?: boolean;
  error?: string;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function quickStart(deps: QuickStartDeps): Promise<QuickStartResult> {
  const base = deps.relayUrl.trim().replace(/\/+$/, '');
  if (!base) return { ok: false, error: '还没有设置中继地址' };
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? DEFAULT_SLEEP;
  const progress = deps.onProgress ?? ((): void => undefined);
  const keyPair = deps.keyPair ?? createHandoffKeyPair();

  let token = deps.existingToken?.trim() ?? '';
  let memberName = '';
  let grants: Array<{ channelId: string; role: string }> = [];

  /* ---------- 1. 没有令牌就先登录 ---------- */

  if (!token) {
    progress('正在打开浏览器，请用 GitHub 登录…');
    let started: { code?: string; verifyUrl?: string; error?: string } = {};
    try {
      const response = await doFetch(`${base}/v1/auth/device/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceName: deps.deviceName, platform: deps.platform }),
      });
      started = await response.json() as typeof started;
      if (!response.ok) {
        return {
          ok: false,
          // 弹窗只说人话；环境变量名留给日志，普通用户看不懂也不需要懂
          error: started.error === 'github login disabled'
            ? '这个服务暂时没有开放 GitHub 登录。请稍后再试，或换一个中继地址（设置里搜 plaitcode.relay.url）。'
            : (started.error ?? `连不上协作服务（HTTP ${response.status}）`),
        };
      }
    } catch (error) {
      return { ok: false, error: `连不上中继：${error instanceof Error ? error.message : String(error)}` };
    }
    if (!started.code || !started.verifyUrl) return { ok: false, error: '中继没有返回登录码' };

    await deps.openUrl?.(started.verifyUrl);

    const deadline = Date.now() + (deps.loginTimeoutMs ?? 10 * 60_000);
    let ready: { status?: string; token?: string; memberName?: string; grants?: Array<{ channelId: string; role: string }>; error?: string } = {};
    while (Date.now() < deadline) {
      await sleep(2_000);
      try {
        const response = await doFetch(`${base}/v1/auth/device/poll?code=${encodeURIComponent(started.code)}`);
        ready = await response.json() as typeof ready;
        if (ready.status === 'ready' && ready.token) break;
        if (!response.ok) return { ok: false, error: ready.error ?? '登录码失效，请重新执行一次' };
      } catch {
        // 网络抖动：继续等，登录码还在有效期内
      }
    }
    if (!ready.token) return { ok: false, error: '等待 GitHub 登录超时，请重新执行一次', keyPair };
    token = ready.token;
    memberName = ready.memberName ?? '';
    grants = ready.grants ?? [];
    progress(`已登录${memberName ? `：${memberName}` : ''}`);
  }

  /* ---------- 1b. 已有令牌时，问一次这台设备自己有哪些授权 ---------- */

  /*
   * 不能假设「有令牌就等于有密钥」：重装、换机、清理过 SecretStorage 之后，
   * 令牌还在但频道密钥丢了。这时必须走交接，而不是自己另开一条频道。
   */
  if (token && grants.length === 0) {
    try {
      const response = await doFetch(`${base}/v1/devices/me`, { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) {
        const me = await response.json() as {
          memberName?: string;
          grants?: Array<{ channelId: string; role: string }>;
        };
        grants = me.grants ?? [];
        if (!memberName && me.memberName) memberName = me.memberName;
      }
    } catch {
      // 查不到就按「这个账号还没有频道」处理，后面 claim 会给出确切错误
    }
  }

  /* ---------- 2. 决定这条设备要进哪条频道 ---------- */

  let secret = deps.existingSecret?.trim() ?? '';
  let channelId = '';
  let needsKey = false;

  if (secret) {
    // 复用的密钥：确认这台设备还有权限（换了服务器或刚被吊销时会被拒）
    channelId = deriveKeys(secret).channel;
    await doFetch(`${base}/v1/channels/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ channelId }),
    }).catch(() => undefined);
  } else if (grants.length > 0) {
    /*
     * 账号里已经有频道了 —— 这台是同一个账号的第二台设备。
     *
     * 它 inherits 到了频道 id，但**密钥只在别的设备上**，所以不能自己新建一个：
     * 新建就等于两条互不相通的频道。这里的目标是拿到原来那条。
     */
    channelId = grants[0]!.channelId;
    needsKey = true;
    progress('这个账号已经在协作中，正在等另一台设备把频道密钥送过来…');
  } else {
    // 全新账号：自己开一条频道，并让中继承认这台设备的权限
    const created = newPairingSecret();
    channelId = deriveKeys(created).channel;
    try {
      const response = await doFetch(`${base}/v1/channels/claim`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        return { ok: false, token, keyPair, error: payload.error ?? '中继拒绝为这台设备登记频道' };
      }
    } catch (error) {
      return { ok: false, token, keyPair, error: `连不上中继：${error instanceof Error ? error.message : String(error)}` };
    }
    secret = created;
    progress('已创建频道');
  }

  /* ---------- 3. 登记公钥，必要时等老设备递密钥 ---------- */

  await registerHandoffKey({
    url: base,
    token,
    keyPair,
    needsKey,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });

  if (needsKey) {
    const deadline = Date.now() + (deps.handoffTimeoutMs ?? 90_000);
    while (Date.now() < deadline) {
      const round = await handoffRound({
        url: base,
        token,
        keyPair,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      if (round.adopted) {
        progress('已拿到频道密钥');
        return {
          ok: true,
          secret: round.adopted.secret,
          token,
          keyPair,
          ...(memberName ? { memberName } : {}),
          channelId: deriveKeys(round.adopted.secret).channel,
        };
      }
      await sleep(3_000);
    }
    return {
      ok: false,
      token,
      keyPair,
      waitingForKey: true,
      channelId,
      error: '还在等另一台设备递频道密钥。请打开任意一台已登录的电脑（保持 VS Code 开着）后重试。',
    };
  }

  return {
    ok: true,
    secret: secret || undefined,
    token,
    keyPair,
    ...(memberName ? { memberName } : {}),
    channelId,
  };
}
