import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  addDevice,
  addMember,
  addOrg,
  authorize,
  deviceByToken,
  emptyIdentity,
  findMemberByIdentity,
  identitySnapshot,
  loadIdentity,
  newDeviceToken,
  revokeDevice,
  roleCan,
  saveIdentity,
} from '../sync/relayIdentity';

/** 企业身份层：角色矩阵、频道授权、令牌吊销。 */

test('角色矩阵：只读不能发，成员能发不能管，管理员与所有者能管', () => {
  assert.equal(roleCan('viewer', 'poll'), true);
  assert.equal(roleCan('viewer', 'publish'), false);
  assert.equal(roleCan('viewer', 'manage'), false);
  assert.equal(roleCan('member', 'publish'), true);
  assert.equal(roleCan('member', 'manage'), false);
  assert.equal(roleCan('admin', 'manage'), true);
  assert.equal(roleCan('owner', 'manage'), true);
});

test('一人多设备、一设备多频道：按频道分别授权', () => {
  const state = emptyIdentity();
  const org = addOrg(state, 'Acme');
  const member = addMember(state, { orgId: org.id, name: '小王', role: 'member' });
  assert.ok(member);

  const created = addDevice(state, {
    memberId: member!.id,
    name: '公司的台式机',
    platform: 'win32',
    channels: [
      { channelId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', role: 'member' },
      { channelId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', role: 'viewer' },
    ],
  });
  assert.ok(created);
  assert.match(created!.token, /^pct_/);

  const verdict = authorize(state, created!.token, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'publish');
  assert.equal(verdict.ok, true);
  assert.equal(verdict.member?.name, '小王');

  // 同一个令牌在「只读频道」里不能发
  const readOnly = authorize(state, created!.token, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'publish');
  assert.equal(readOnly.ok, false);
  assert.match(readOnly.reason ?? '', /viewer/);
  // 只读频道可以拉消息
  assert.equal(authorize(state, created!.token, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'poll').ok, true);
  // 没授权的频道一律拒绝
  const other = authorize(state, created!.token, 'cccccccccccccccccccccccccccccccc', 'poll');
  assert.equal(other.ok, false);
  assert.match(other.reason ?? '', /没有该频道的授权/);
});

test('吊销设备：立刻失效，且不再能通过任何频道', () => {
  const state = emptyIdentity();
  const org = addOrg(state, 'Acme');
  const member = addMember(state, { orgId: org.id, name: '小李' })!;
  const created = addDevice(state, { memberId: member.id, name: '笔记本', channels: [{ channelId: 'dddddddddddddddddddddddddddddddd' }] })!;

  assert.equal(authorize(state, created.token, 'dddddddddddddddddddddddddddddddd', 'poll').ok, true);
  assert.equal(revokeDevice(state, created.device.id), true);
  assert.equal(revokeDevice(state, created.device.id), false, '重复吊销返回 false');
  const after = authorize(state, created.token, 'dddddddddddddddddddddddddddddddd', 'poll');
  assert.equal(after.ok, false);
  assert.match(after.reason ?? '', /吊销/);
});

test('令牌只存哈希：库里查不到明文，伪造的令牌进不来', () => {
  const state = emptyIdentity();
  const org = addOrg(state, 'Acme');
  const member = addMember(state, { orgId: org.id, name: '小张' })!;
  const created = addDevice(state, { memberId: member.id, name: 'Mac', channels: [{ channelId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }] })!;

  assert.equal(JSON.stringify(state).includes(created.token), false, '身份库里不该出现明文令牌');
  assert.ok(deviceByToken(state, created.token), '用明文能查回设备');
  assert.equal(deviceByToken(state, newDeviceToken()), undefined);
  assert.equal(deviceByToken(state, 'not-a-token'), undefined);
});

test('身份库：落盘后能读回，快照不含令牌哈希', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaitcode-identity-'));
  const path = join(dir, 'identity.json');
  try {
    const state = emptyIdentity();
    const org = addOrg(state, 'Acme');
    const member = addMember(state, { orgId: org.id, name: '小王', role: 'admin' })!;
    addDevice(state, { memberId: member.id, name: '台式机', channels: [{ channelId: 'ffffffffffffffffffffffffffffffff' }] });
    await saveIdentity(path, state);

    const loaded = await loadIdentity(path);
    assert.ok(loaded);
    assert.equal(loaded!.orgs[0]?.name, 'Acme');
    assert.equal(loaded!.members[0]?.role, 'admin');
    assert.equal(loaded!.devices.length, 1);

    const snapshot = JSON.stringify(identitySnapshot(loaded!));
    assert.equal(snapshot.includes('tokenHash'), false, '管理接口不该回传令牌哈希');
    assert.equal(snapshot.includes('tokens'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('按 SSO 身份认人：邮箱优先，没邮箱就退到 open_id，再退到 union_id', () => {
  const state = emptyIdentity();
  const org = addOrg(state, 'Acme');
  const byEmail = addMember(state, { orgId: org.id, name: '有邮箱', email: 'A@Honor-World.com' })!;
  const byOpenId = addMember(state, { orgId: org.id, name: '没邮箱', openId: 'ou_abc' })!;
  const byUnionId = addMember(state, { orgId: org.id, name: '只有联合身份', unionId: 'on_xyz' })!;

  assert.equal(byEmail.email, 'A@Honor-World.com');
  assert.equal(findMemberByIdentity(state, { email: 'a@honor-world.com' })?.id, byEmail.id, '邮箱按小写比对');
  assert.equal(findMemberByIdentity(state, { openId: 'ou_abc' })?.id, byOpenId.id);
  assert.equal(findMemberByIdentity(state, { unionId: 'on_xyz' })?.id, byUnionId.id);
  assert.equal(findMemberByIdentity(state, { email: 'a@honor-world.com', openId: 'ou_abc' })?.id, byEmail.id, '邮箱命中优先');
  assert.equal(findMemberByIdentity(state, { openId: 'ou_other', unionId: 'on_xyz' })?.id, byUnionId.id, 'open_id 没命中再试 union_id');
  assert.equal(findMemberByIdentity(state, { email: 'nobody@honor-world.com' }), undefined);
  assert.equal(findMemberByIdentity(state, {}), undefined);
});

