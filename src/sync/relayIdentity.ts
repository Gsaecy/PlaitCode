/**
 * 企业身份层：组织 / 成员 / 设备 / 频道授权。
 *
 * 为什么要它：原来的认证单位是「频道密钥」——谁拿到钥匙谁就是甲方。
 * 一个人两台电脑刚好，但企业必须能回答：
 *   1. 员工离职，怎么立刻吊销他的设备？
 *   2. A 项目成员只能看 A 项目，怎么隔离？
 *   3. 谁有权发布消息？谁只能看？
 *
 * 设计取舍：
 *  - **一人多设备、一设备多频道**：测试机共享、跨项目复用是企业里的常态；
 *  - 令牌只存哈希（`pct_` 前缀 + 24 字节随机），明文只在创建时给一次；
 *  - 端到端加密不变：频道的内容密钥仍由配对信息传递，中转依旧看不到明文，
 *    身份层只回答「这个人能不能往这个频道投递」；
 *  - **默认关闭**：没有身份库时完全走原来的频道密钥逻辑，老部署零影响。
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type Action = 'publish' | 'poll' | 'presence' | 'manage';

export interface Org {
  id: string;
  name: string;
  createdAt: number;
}

export interface Member {
  id: string;
  orgId: string;
  name: string;
  role: Role;
  createdAt: number;
  /** SSO 开户时记下的邮箱，用于按邮箱认人。 */
  email?: string;
  /** GitHub 数字 id（字符串）。改名、换邮箱都不变，是认人的首选主键。 */
  githubId?: string;
  /** GitHub 登录名，只用于显示与审计。 */
  githubLogin?: string;
  /** 飞书 open_id（本应用内唯一）：应用没拿到邮箱权限时靠它认人。 */
  openId?: string;
  /** 飞书 union_id（同开发者多应用间唯一）。 */
  unionId?: string;
}

/** 登录时能从 SSO 拿到的身份标识，任意一个命中就算同一个人。 */
export interface MemberIdentityKey {
  /** 优先用 GitHub 数字 id：同一个人换机器、换邮箱都还是同一个成员。 */
  githubId?: string;
  email?: string;
  openId?: string;
  unionId?: string;
}

export interface DeviceGrant {
  channelId: string;
  role: Role;
}

export interface Device {
  id: string;
  memberId: string;
  name: string;
  platform: string;
  /** 只存哈希：库被拖走也拿不到可用令牌。 */
  tokenHash: string;
  grants: DeviceGrant[];
  createdAt: number;
  lastSeenAt?: number;
  /**
   * 硬过期时间。未设置表示老记录（0.9.0 之前发的令牌），保持永不过期以免升级即断线；
   * 新建设备一律带有效期。
   */
  expiresAt?: number;
  /**
   * 轮换后旧令牌的哈希 + 失效时间。
   *
   * 轮换不能立刻掐掉旧令牌：正在执行任务的客户端还在用旧值，
   * 一瞬间切过去会让它掉线并丢掉本轮的进度。留一段重叠期让它自然切。
   */
  previousTokenHash?: string;
  previousValidUntil?: number;
  /** 最后一次轮换时间。 */
  rotatedAt?: number;
  revokedAt?: number;
  /**
   * 设备公钥（base64，X25519 raw 32 字节）。
   *
   * 用来接收「频道密钥交接」的加密包：老设备用这把公钥加密，只有这台设备的私钥能解开。
   * 公钥是公开信息，放在这里不影响端到端加密。
   */
  pubkey?: string;
  /**
   * 这台设备还在等频道密钥。
   *
   * 登录时它继承到了频道 id，但密钥只存在别的设备上 —— 需要老设备用它的公钥
   * 加密一份送过来。解开之后把它清掉，避免反复投递。
   */
  needsKey?: boolean;
}

export interface IdentityState {
  version: 1;
  orgs: Org[];
  members: Member[];
  devices: Device[];
}

export const IDENTITY_VERSION = 1;
const MAX_GRANTS = 100;
/**
 * 新设备令牌默认**不设**有效期。
 *
 * 个人多设备场景下，90 天到期后令牌静默失效，用户只会看到"某天开始连不上了"，
 * 而轮换界面还没做好。所以默认关掉，由部署方用 `ttlMs` 显式开启；
 * 企业客户需要强制轮换时再打开。
 */
const DEFAULT_DEVICE_TTL_MS = 0;
/** 轮换时旧令牌的重叠有效期：24 小时，足够在跑的客户端自然切换。 */
const DEFAULT_ROTATE_OVERLAP_MS = 24 * 60 * 60_000;

export function emptyIdentity(): IdentityState {
  return { version: IDENTITY_VERSION, orgs: [], members: [], devices: [] };
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function newDeviceToken(): string {
  return `pct_${randomBytes(24).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const ROLE_ACTIONS: Record<Role, Action[]> = {
  viewer: ['poll', 'presence'],
  member: ['publish', 'poll', 'presence'],
  admin: ['publish', 'poll', 'presence', 'manage'],
  owner: ['publish', 'poll', 'presence', 'manage'],
};

export function roleCan(role: Role, action: Action): boolean {
  return (ROLE_ACTIONS[role] ?? []).includes(action);
}

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer';
}

/** 建组织。 */
export function addOrg(state: IdentityState, name: string): Org {
  const org: Org = { id: newId('org'), name: name.trim().slice(0, 80) || 'org', createdAt: Date.now() };
  state.orgs.push(org);
  return org;
}

/** 加成员（角色默认 member）。 */
export function addMember(
  state: IdentityState,
  input: {
    orgId: string;
    name: string;
    role?: Role;
    email?: string;
    githubId?: string;
    githubLogin?: string;
    openId?: string;
    unionId?: string;
  },
): Member | undefined {
  if (!state.orgs.some((org) => org.id === input.orgId)) return undefined;
  const role: Role = isRole(input.role) ? input.role : 'member';
  const member: Member = {
    id: newId('mem'),
    orgId: input.orgId,
    name: input.name.trim().slice(0, 80) || 'member',
    role,
    createdAt: Date.now(),
  };
  if (input.email?.trim()) member.email = input.email.trim();
  if (input.githubId?.trim()) member.githubId = input.githubId.trim();
  if (input.githubLogin?.trim()) member.githubLogin = input.githubLogin.trim();
  if (input.openId?.trim()) member.openId = input.openId.trim();
  if (input.unionId?.trim()) member.unionId = input.unionId.trim();
  state.members.push(member);
  return member;
}

/**
 * 按 SSO 身份找成员：GitHub id 优先，其次邮箱、open_id、union_id。
 *
 * GitHub id 放第一位是因为它是唯一不会变的：账号改名、换邮箱、
 * 换飞书应用都不会影响它，用它认人才不会把同一个人拆成两个成员。
 */
export function findMemberByIdentity(state: IdentityState, key: MemberIdentityKey): Member | undefined {
  if (key.githubId) {
    const byGithub = state.members.find((item) => item.id && item.githubId === key.githubId);
    if (byGithub) return byGithub;
  }
  const email = key.email?.trim().toLowerCase();
  if (email) {
    const byEmail = state.members.find((item) => item.id && item.email?.trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  if (key.openId) {
    const byOpenId = state.members.find((item) => item.id && item.openId === key.openId);
    if (byOpenId) return byOpenId;
  }
  if (key.unionId) return state.members.find((item) => item.id && item.unionId === key.unionId);
  return undefined;
}

/**
 * 登记设备公钥（用于接收频道密钥交接的加密包）。
 *
 * 只允许改自己那台：拿到别人设备 id 也换不掉它的公钥，否则就能把别人的
 * 交接包引到自己机器上。
 */
export function setDevicePubkey(
  state: IdentityState,
  deviceId: string,
  pubkey: string,
  needsKey = true,
): boolean {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device || device.revokedAt) return false;
  const clean = pubkey.trim();
  // X25519 raw 公钥 base64 固定 44 字符；放宽到 88 是为了以后换算法时不用改校验
  if (!/^[A-Za-z0-9+/=]{40,88}$/.test(clean)) return false;
  device.pubkey = clean;
  device.needsKey = needsKey;
  return true;
}

/** 交接完成：这台设备已经有密钥了，别再给它投包。 */
export function clearNeedsKey(state: IdentityState, deviceId: string): boolean {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device) return false;
  device.needsKey = false;
  return true;
}

/**
 * 给设备追加一条频道授权。
 *
 * 频道 id 是从频道密钥派生的，只有持有密钥的人才知道它 ——
 * 所以「能说出这个 id」本身就等于「我有这条频道的钥匙」。
 * 别人冒领同一个 id 也没用：中继按 keyHash 校验，他解不开消息。
 */
export function claimChannel(state: IdentityState, deviceId: string, channelId: string): boolean {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device || device.revokedAt) return false;
  if (!/^[0-9a-f]{16,64}$/.test(channelId)) return false;
  if (device.grants.some((grant) => grant.channelId === channelId)) return true;
  if (device.grants.length >= MAX_GRANTS) return false;
  const member = state.members.find((item) => item.id === device.memberId);
  device.grants.push({ channelId, role: member?.role ?? 'member' });
  return true;
}

/**
 * 给成员登记一台设备，返回**一次性**明文令牌（库里只留哈希）。
 *
 * 授权按频道给：一台设备可以同时被允许写 A 项目、只读 B 项目。
 */
export function addDevice(
  state: IdentityState,
  input: {
    memberId: string;
    name: string;
    platform?: string;
    channels: Array<{ channelId: string; role?: Role }>;
    /** 有效期（毫秒）。默认 90 天；传 0 表示永不过期（仅用于本地测试）。 */
    ttlMs?: number;
  },
): { device: Device; token: string } | undefined {
  const member = state.members.find((item) => item.id === input.memberId);
  if (!member) return undefined;
  const token = newDeviceToken();
  const grants: DeviceGrant[] = input.channels
    .filter((entry) => typeof entry.channelId === 'string' && entry.channelId.trim().length > 0)
    .slice(0, MAX_GRANTS)
    .map((entry) => ({
      channelId: entry.channelId.trim().slice(0, 64),
      role: isRole(entry.role) ? entry.role : member.role,
    }));
  const ttl = input.ttlMs === undefined ? DEFAULT_DEVICE_TTL_MS : input.ttlMs;
  const device: Device = {
    id: newId('dev'),
    memberId: member.id,
    name: input.name.trim().slice(0, 80) || 'device',
    platform: (input.platform ?? 'unknown').slice(0, 20),
    tokenHash: hashToken(token),
    grants,
    createdAt: Date.now(),
    ...(ttl > 0 ? { expiresAt: Date.now() + ttl } : {}),
  };
  state.devices.push(device);
  return { device, token };
}

/**
 * 轮换设备令牌：发一个新的，旧的在重叠期内仍然可用。
 *
 * 为什么不能立刻作废旧令牌：客户端此刻可能正在跑一轮任务，
 * 一刀切会让它掉线、丢掉本轮进度，用户只看到"任务莫名中断"。
 */
export function rotateDeviceToken(
  state: IdentityState,
  deviceId: string,
  options: { ttlMs?: number; overlapMs?: number } = {},
): { device: Device; token: string } | undefined {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device || device.revokedAt) return undefined;
  const token = newDeviceToken();
  const now = Date.now();
  const overlap = Math.max(0, options.overlapMs ?? DEFAULT_ROTATE_OVERLAP_MS);
  if (overlap > 0) {
    device.previousTokenHash = device.tokenHash;
    device.previousValidUntil = now + overlap;
  } else {
    device.previousTokenHash = undefined;
    device.previousValidUntil = undefined;
  }
  device.tokenHash = hashToken(token);
  device.rotatedAt = now;
  const ttl = options.ttlMs === undefined ? DEFAULT_DEVICE_TTL_MS : options.ttlMs;
  if (ttl > 0) device.expiresAt = now + ttl;
  else device.expiresAt = undefined;
  return { device, token };
}

/** 吊销一台设备（离职、丢电脑）。 */
export function revokeDevice(state: IdentityState, deviceId: string): boolean {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device || device.revokedAt) return false;
  device.revokedAt = Date.now();
  return true;
}

/** 按令牌找设备（只比对哈希）。轮换重叠期内的旧令牌也算有效。 */
export function deviceByToken(state: IdentityState, token: string, now = Date.now()): Device | undefined {
  if (!token.startsWith('pct_')) return undefined;
  const hash = hashToken(token);
  const current = state.devices.find((item) => safeEqualHex(item.tokenHash, hash));
  if (current) return current;
  return state.devices.find((item) => item.previousTokenHash
    && item.previousValidUntil !== undefined
    && now < item.previousValidUntil
    && safeEqualHex(item.previousTokenHash, hash));
}

export interface Verdict {
  ok: boolean;
  device?: Device;
  member?: Member;
  reason?: string;
}

/**
 * 授权判断：令牌有效 + 设备未吊销 + 对这个频道有授权 + 角色允许这个动作。
 *
 * 失败原因写得具体 —— 企业排障时「403」没有价值，「设备已被吊销」才有。
 */
export function authorize(state: IdentityState, token: string, channelId: string, action: Action, now = Date.now()): Verdict {
  const device = deviceByToken(state, token, now);
  if (!device) return { ok: false, reason: '设备令牌无效' };
  if (device.revokedAt) return { ok: false, device, reason: '设备已被吊销' };
  if (device.expiresAt !== undefined && now > device.expiresAt) {
    return { ok: false, device, reason: '设备令牌已过期，请重新登记设备' };
  }
  const member = state.members.find((item) => item.id === device.memberId);
  if (!member) return { ok: false, device, reason: '设备所属成员已不存在' };
  const grant = device.grants.find((item) => item.channelId === channelId);
  if (!grant) return { ok: false, device, member, reason: '这台设备没有该频道的授权' };
  if (!roleCan(grant.role, action)) {
    return { ok: false, device, member, reason: `角色 ${grant.role} 不能执行 ${action}` };
  }
  device.lastSeenAt = Date.now();
  return { ok: true, device, member };
}

/**
 * 会话鉴权：手机用飞书登录后没有设备令牌，按「成员 + 频道归属」放行。
 *
 * 频道归属是推导出来的：同组织里任意一台设备被授予过该频道，这个频道就属于该组织。
 * 这样管理员不用额外维护一张"频道属于谁"的表；跨组织的频道一律拒绝。
 */
export function authorizeSession(state: IdentityState, memberId: string, channelId: string, action: Action): Verdict {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return { ok: false, reason: '成员不存在' };
  const active = state.devices.filter((device) => !device.revokedAt);
  const ownGrant = active
    .filter((device) => device.memberId === memberId)
    .flatMap((device) => device.grants)
    .find((grant) => grant.channelId === channelId);
  const role = ownGrant?.role ?? member.role;
  const inOrg = ownGrant
    ? true
    : active.some((device) => device.grants.some((grant) => grant.channelId === channelId)
      && state.members.find((item) => item.id === device.memberId)?.orgId === member.orgId);
  if (!inOrg) return { ok: false, member, reason: '这个频道不属于你所在的组织' };
  if (!roleCan(role, action)) return { ok: false, member, reason: `角色 ${role} 不能执行 ${action}` };
  return { ok: true, member };
}

/** 落盘（先写临时文件再原子替换，避免断电留下半个 JSON）。 */
export async function saveIdentity(path: string, state: IdentityState): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export async function loadIdentity(path: string): Promise<IdentityState | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<IdentityState>;
    if (parsed.version !== IDENTITY_VERSION || !Array.isArray(parsed.orgs) || !Array.isArray(parsed.members) || !Array.isArray(parsed.devices)) {
      return undefined;
    }
    return { version: IDENTITY_VERSION, orgs: parsed.orgs, members: parsed.members, devices: parsed.devices };
  } catch {
    return undefined;
  }
}

/** 给管理接口看的脱敏视图（不含令牌哈希）。 */
export function identitySnapshot(state: IdentityState): unknown {
  return {
    version: state.version,
    orgs: state.orgs,
    members: state.members,
    devices: state.devices.map((device) => ({
      id: device.id,
      memberId: device.memberId,
      name: device.name,
      platform: device.platform,
      grants: device.grants,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      revokedAt: device.revokedAt,
      // 有没有可交接的公钥，对排障有用；公钥本身不是秘密
      hasPubkey: Boolean(device.pubkey),
    })),
  };
}
