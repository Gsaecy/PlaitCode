/**
 * 设备密钥交接的加密部分（只在设备上跑，中继不参与）。
 *
 * 用 X25519 协商 + HKDF 派生 + AES-256-GCM：
 *  - 私钥永远不出本机（存 SecretStorage）；
 *  - 公钥是公开的，可以放心交给中继转发；
 *  - AAD 绑定版本，防止以后换算法时把旧包当成新包。
 */

import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/** X25519 公钥的 SPKI 头：raw 32 字节前面拼上它就能给 Node 当 DER 用。 */
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const HKDF_INFO = Buffer.from('hwchat-handoff-v1', 'utf8');
const AAD = Buffer.from('hwchat-handoff-v1', 'utf8');

export interface HandoffKeyPair {
  /** base64(raw 32 字节)。 */
  publicKey: string;
  /** base64(PKCS#8 DER)。 */
  privateKey: string;
}

export interface HandoffPayload {
  /** 中继地址。 */
  url: string;
  /** 频道密钥（明文只存在于这两台设备之间的加密包里）。 */
  secret: string;
}

export function createHandoffKeyPair(): HandoffKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return {
    publicKey: Buffer.from(spki.subarray(spki.length - 32)).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

function publicKeyOf(rawBase64: string) {
  const raw = Buffer.from(rawBase64, 'base64');
  if (raw.length !== 32) throw new Error('公钥长度不对，应为 32 字节');
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function privateKeyOf(pkcs8Base64: string) {
  return createPrivateKey({ key: Buffer.from(pkcs8Base64, 'base64'), format: 'der', type: 'pkcs8' });
}

/** 两台设备算出的对称密钥，只在这个函数里出现。 */
function sharedKey(myPrivateKey: string, theirPublicKey: string): Buffer {
  const shared = diffieHellman({ privateKey: privateKeyOf(myPrivateKey), publicKey: publicKeyOf(theirPublicKey) });
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), HKDF_INFO, 32));
}

/** 用对方的公钥加密频道材料。 */
export function sealForDevice(
  myPrivateKey: string,
  theirPublicKey: string,
  payload: HandoffPayload,
): { iv: string; ct: string } {
  const key = sharedKey(myPrivateKey, theirPublicKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    // 认证标签拼在密文尾部，解开时分开取
    ct: Buffer.concat([body, tag]).toString('base64'),
  };
}

/**
 * 用本机私钥解开。
 *
 * 解不开就返回 undefined —— 换过设备、密钥不对、包被改过都会走到这里，
 * 调用方把它当成「还没有可用的交接材料」处理，不要当成崩溃。
 */
export function openFromDevice(
  myPrivateKey: string,
  theirPublicKey: string,
  envelope: { iv: string; ct: string },
): HandoffPayload | undefined {
  try {
    const key = sharedKey(myPrivateKey, theirPublicKey);
    const raw = Buffer.from(envelope.ct, 'base64');
    if (raw.length < 17) return undefined;
    const body = raw.subarray(0, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain) as Partial<HandoffPayload>;
    if (typeof parsed.url !== 'string' || typeof parsed.secret !== 'string') return undefined;
    return { url: parsed.url, secret: parsed.secret };
  } catch {
    return undefined;
  }
}
