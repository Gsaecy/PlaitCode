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
  /** 飞书 open_id（本应用内唯一）：应用没拿到邮箱权限时靠它认人。 */
  openId?: string;
  /** 飞书 union_id（同开发者多应用间唯一）。 */
  unionId?: string;
}

/** 登录时能从 SSO 拿到的身份标识，任意一个命中就算同一个人。 */
export interface MemberIdentityKey {
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
  revokedAt?: number;
}

export interface IdentityState {
  version: 1;
  orgs: Org[];
  members: Member[];
  devices: Device[];
}

export const IDENTITY_VERSION = 1;
const MAX_GRANTS = 100;

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
  input: { orgId: string; name: string; role?: Role; email?: string; openId?: string; unionId?: string },
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
  if (input.openId?.trim()) member.openId = input.openId.trim();
  if (input.unionId?.trim()) member.unionId = input.unionId.trim();
  state.members.push(member);
  return member;
}

/**
 * 按 SSO 身份找成员：邮箱优先，其次 open_id，最后 union_id。
 *
 * 邮箱不是必需项——客户不给飞书应用开邮箱权限时，仍能靠 open_id 认人。
 */
export function findMemberByIdentity(state: IdentityState, key: MemberIdentityKey): Member | undefined {
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
 * 给成员登记一台设备，返回**一次性**明文令牌（库里只留哈希）。
 *
 * 授权按频道给：一台设备可以同时被允许写 A 项目、只读 B 项目。
 */
export function addDevice(
  state: IdentityState,
  input: { memberId: string; name: string; platform?: string; channels: Array<{ channelId: string; role?: Role }> },
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
  const device: Device = {
    id: newId('dev'),
    memberId: member.id,
    name: input.name.trim().slice(0, 80) || 'device',
    platform: (input.platform ?? 'unknown').slice(0, 20),
    tokenHash: hashToken(token),
    grants,
    createdAt: Date.now(),
  };
  state.devices.push(device);
  return { device, token };
}

/** 吊销一台设备（离职、丢电脑）。 */
export function revokeDevice(state: IdentityState, deviceId: string): boolean {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device || device.revokedAt) return false;
  device.revokedAt = Date.now();
  return true;
}

/** 按令牌找设备（只比对哈希）。 */
export function deviceByToken(state: IdentityState, token: string): Device | undefined {
  if (!token.startsWith('pct_')) return undefined;
  const hash = hashToken(token);
  return state.devices.find((item) => safeEqualHex(item.tokenHash, hash));
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
export function authorize(state: IdentityState, token: string, channelId: string, action: Action): Verdict {
  const device = deviceByToken(state, token);
  if (!device) return { ok: false, reason: '设备令牌无效' };
  if (device.revokedAt) return { ok: false, device, reason: '设备已被吊销' };
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
    })),
  };
}
