/**
 * 频道密钥交接的客户端：让第二台电脑自己把密钥拿到手。
 *
 * 一轮做三件事（都是幂等的，可以每 30 秒跑一次）：
 *  1. 看有没有给自己的加密包 → 解开 → 交出「我拿到了」；
 *  2. 看有没有同一个人新登记的设备在等密钥 → 用对方公钥加密后投出去；
 *  3. 汇报自己是不是还在等。
 *
 * 中继全程只见到密文与公钥。
 */

import { openFromDevice, sealForDevice, type HandoffKeyPair, type HandoffPayload } from './handoffCrypto';

export interface HandoffRoundOptions {
  /** 中继地址（不带尾斜杠）。 */
  url: string;
  /** 本机设备令牌。 */
  token: string;
  /** 本机密钥对（私钥不出本机）。 */
  keyPair: HandoffKeyPair;
  /** 本机已经持有的频道材料；没有就只收不发。 */
  local?: HandoffPayload;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export interface HandoffRoundResult {
  /** 这一轮新拿到的频道材料（拿到就该立刻存起来并使用）。 */
  adopted?: HandoffPayload;
  /** 这一轮给几台设备投了包。 */
  delivered: number;
  /** 本机是否还在等别人给密钥。 */
  waiting: boolean;
  /** 失败原因（网络问题等），调用方决定要不要提示用户。 */
  error?: string;
}

interface IncomingEnvelope {
  fromDeviceId: string;
  toDeviceId: string;
  iv: string;
  ct: string;
  at: number;
  fromPubkey: string;
}

interface PeerEntry {
  deviceId: string;
  name: string;
  platform: string;
  pubkey: string;
}

export async function handoffRound(options: HandoffRoundOptions): Promise<HandoffRoundResult> {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const headers = { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' };
  let delivered = 0;

  let payload: { ok?: boolean; incoming?: IncomingEnvelope; peers?: PeerEntry[]; needsKey?: boolean; error?: string };
  try {
    const response = await doFetch(`${base}/v1/handoff`, { headers: { authorization: headers.authorization } });
    payload = await response.json() as typeof payload;
    if (!response.ok || !payload?.ok) {
      return { delivered, waiting: false, error: payload?.error ?? `HTTP ${response.status}` };
    }
  } catch (error) {
    return { delivered, waiting: false, error: error instanceof Error ? error.message : String(error) };
  }

  let adopted: HandoffPayload | undefined;
  const incoming = payload.incoming;
  if (incoming?.fromPubkey) {
    adopted = openFromDevice(options.keyPair.privateKey, incoming.fromPubkey, { iv: incoming.iv, ct: incoming.ct });
    if (adopted) {
      // 拿到就认账：让中继别再向我投包
      await doFetch(`${base}/v1/handoff`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ done: true }),
      }).catch(() => undefined);
      options.log?.('[handoff] 已收到频道密钥');
    } else {
      options.log?.('[handoff] 收到一个解不开的包，可能是别人投错了目标');
    }
  }

  // 本机有密钥、也有公钥时，才有能力给别人递钥匙
  const usable = options.local ?? adopted;
  if (usable && options.keyPair.privateKey) {
    for (const peer of payload.peers ?? []) {
      try {
        const sealed = sealForDevice(options.keyPair.privateKey, peer.pubkey, { url: usable.url, secret: usable.secret });
        const response = await doFetch(`${base}/v1/handoff`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ toDeviceId: peer.deviceId, iv: sealed.iv, ct: sealed.ct }),
        });
        if (response.ok) {
          delivered += 1;
          options.log?.(`[handoff] 已把频道密钥交给「${peer.name}」`);
        }
      } catch (error) {
        options.log?.(`[handoff] 给「${peer.name}」投递失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { delivered, waiting: payload.needsKey === true && !adopted, ...(adopted ? { adopted } : {}) };
}

/** 登记公钥。needsKey 表示「我还没有密钥，等一台老设备递给我」。 */
export async function registerHandoffKey(options: {
  url: string;
  token: string;
  keyPair: HandoffKeyPair;
  needsKey: boolean;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(`${base}/v1/devices/pubkey`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: options.keyPair.publicKey, needsKey: options.needsKey }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
