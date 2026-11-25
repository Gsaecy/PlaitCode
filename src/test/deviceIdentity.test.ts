import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deviceLabel,
  deviceName,
  groupSpeaker,
  makeGroupMessage,
  type SyncPeer,
} from '../sync/lanProtocol';
import { buildTaskBoard } from '../sync/tasks';

/**
 * 身份标识统一（用户 2026-11-24）：
 * 「不同设备的 agent 和用户，显示身份标识需要统一和团队群群信息显示的一样，
 *  全部规范为系统类型 + 设备名称。目前只是因为我两个设备分别是 Windows 和 macOS，
 *  如果别的用户都是用 Windows，或者都是用 macOS 设备，怎么区分呢？」
 * 并且：「如果系统类型+设备名称无法区分，最好带上 IP 地址」。
 */

const win: SyncPeer = { id: 'p-win', name: 'MagicBookV14 · win32', platform: 'win32', project: 'app', version: 't', host: '192.168.0.2' };
const mac: SyncPeer = { id: 'p-mac', name: '192.168.0.8 · darwin', platform: 'darwin', project: 'app', version: 't', host: '192.168.0.8' };

test('旧名字里的平台后缀会被剥掉，只留设备名', () => {
  assert.equal(deviceName('MagicBookV14 · win32'), 'MagicBookV14');
  assert.equal(deviceName('MacBook-Pro · macOS'), 'MacBook-Pro');
  assert.equal(deviceName('公司台式机'), '公司台式机');
  assert.equal(deviceName(''), '');
});

test('统一成「系统类型 · 设备名」，不再出现两种写法', () => {
  assert.equal(deviceLabel(win), 'Windows · MagicBookV14');
  assert.equal(deviceLabel(mac), 'macOS · 192.168.0.8');
});

test('同一台设备的甲方、乙方用同一个前缀，只差角色', () => {
  const asUser = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '加个开关' }, 1, 'g1')!;
  const asAgent = makeGroupMessage(win, { author: 'agent', phase: 'progress', body: '在做' }, 2, 'g2')!;
  assert.equal(groupSpeaker(asUser), 'Windows · MagicBookV14 · 甲方');
  assert.equal(groupSpeaker(asAgent), 'Windows · MagicBookV14 · 乙方');
});

test('两台都是 Windows 时靠设备名区分', () => {
  const a: SyncPeer = { id: 'a', name: '公司台式机 · win32', platform: 'win32', project: 'app', version: 't' };
  const b: SyncPeer = { id: 'b', name: '笔记本 · win32', platform: 'win32', project: 'app', version: 't' };
  assert.equal(deviceLabel(a, [a, b]), 'Windows · 公司台式机');
  assert.equal(deviceLabel(b, [a, b]), 'Windows · 笔记本');
});

test('设备名也撞了 → 自动补 IP（用户要求：分不清就带 IP）', () => {
  const a: SyncPeer = { id: 'a', name: 'DESKTOP · win32', platform: 'win32', project: 'app', version: 't', host: '192.168.0.2' };
  const b: SyncPeer = { id: 'b', name: 'DESKTOP · win32', platform: 'win32', project: 'app', version: 't', host: '192.168.0.3' };
  assert.equal(deviceLabel(a, [a, b]), 'Windows · DESKTOP @192.168.0.2');
  assert.equal(deviceLabel(b, [a, b]), 'Windows · DESKTOP @192.168.0.3');
});

test('没有 IP（跨网中继）时退回设备号短码，仍然可区分', () => {
  const a: SyncPeer = { id: 'abcdef123456', name: 'DESKTOP', platform: 'win32', project: 'app', version: 't' };
  const b: SyncPeer = { id: 'abcdef999999', name: 'DESKTOP', platform: 'win32', project: 'app', version: 't' };
  assert.equal(deviceLabel(a, [a, b]), 'Windows · DESKTOP @设备abcdef');
  assert.equal(deviceLabel(b, [a, b]), 'Windows · DESKTOP @设备abcdef', '前 6 位相同就看不出区别，但至少两边一致');
});

test('手机浏览器那条不会被写成 Linux', () => {
  const phone = { id: 'dev-phone', name: '手机 · 浏览器', platform: 'linux', version: 'web' };
  assert.equal(deviceLabel(phone), '手机 · 浏览器');
});

test('看板里的「提出人」也用同一个标识', () => {
  const requirement = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '加个开关' }, 1, 'g1')!;
  const board = buildTaskBoard([requirement]);
  assert.equal(board[0]?.requester, 'Windows · MagicBookV14');
});
