/**
 * 设备密钥交接（handoff）：让第二台电脑自动拿到频道密钥，不用手动粘配对信息。
 *
 * **中继在这一步仍然看不到密钥**：
 *  - 每台设备有一对 X25519 密钥，私钥只在本机 SecretStorage 里；
 *  - 老设备用「新设备的公钥」加密频道密钥，密文交给中继承转发；
 *  - 新设备用自己的私钥解开。
 *
 * 中继只存 `{ from, to, iv, ct }`，和一个已经登记的公钥。公钥是公开的，密文它解不开。
 *
 * 只用一个槽：一台设备只需要一份「进入某条频道」的材料，后到的覆盖先到的。
 */

export interface HandoffEnvelope {
  /** 谁给的（设备 id）。 */
  fromDeviceId: string;
  /** 给谁（设备 id）。 */
  toDeviceId: string;
  /** base64，AES-GCM 的 12 字节 nonce。 */
  iv: string;
  /** base64，AES-GCM 密文。里面有频道地址与密钥。 */
  ct: string;
  at: number;
}

export interface HandoffOptions {
  ttlMs?: number;
  maxBytes?: number;
  now?: () => number;
}

export class HandoffStore {
  private readonly slots = new Map<string, HandoffEnvelope>();
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(options: HandoffOptions = {}) {
    this.ttlMs = Math.max(60_000, options.ttlMs ?? 30 * 60_000);
    this.maxBytes = Math.max(1024, options.maxBytes ?? 32 * 1024);
    this.now = options.now ?? Date.now;
  }

  /** 投放（覆盖同一目标的旧包）。超限直接拒绝，不让中继变成文件柜。 */
  put(envelope: HandoffEnvelope): { ok: true } | { ok: false; error: string } {
    if (typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
      return { ok: false, error: 'invalid envelope' };
    }
    const bytes = Buffer.byteLength(envelope.iv) + Buffer.byteLength(envelope.ct);
    if (bytes > this.maxBytes) return { ok: false, error: 'envelope too large' };
    this.slots.set(envelope.toDeviceId, { ...envelope, at: this.now() });
    return { ok: true };
  }

  /** 取走（一次性）：拿到即删，避免被重复领取。 */
  take(toDeviceId: string): HandoffEnvelope | undefined {
    this.sweep();
    const found = this.slots.get(toDeviceId);
    if (!found) return undefined;
    this.slots.delete(toDeviceId);
    return found;
  }

  /** 有没有待收的（只用于状态显示，不消耗）。 */
  has(toDeviceId: string): boolean {
    this.sweep();
    return this.slots.has(toDeviceId);
  }

  /** 清掉过期的。 */
  sweep(): void {
    const now = this.now();
    for (const [key, value] of this.slots) {
      if (now - value.at > this.ttlMs) this.slots.delete(key);
    }
  }

  get size(): number {
    return this.slots.size;
  }
}
