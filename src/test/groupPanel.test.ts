import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compactGroupLine, groupHeader } from '../views/groupPanel';
import { makeGroupMessage, type SyncPeer } from '../sync/lanProtocol';

/**
 * 团队群窗口的紧凑行（用户 2026-11-23）：
 *   「群的对话窗口你准备放在哪里？……那就需要将显示的输出简化缩小，避免信息繁杂」
 *
 * 所以群窗口一行只保留：谁 · 什么阶段 · 什么时候 · 一句话正文。
 * 这里钉住三件事：标签能区分甲乙方、正文压成单行、跨天带日期。
 */

const win: SyncPeer = { id: 'p-win', name: 'PC · Windows', platform: 'win32', project: 'app-win', version: 't' };
const mac: SyncPeer = { id: 'p-mac', name: 'Mac · macOS', platform: 'darwin', project: 'app-mac', version: 't' };

test('紧凑行：甲方与乙方标签能区分', () => {
  const fromUser = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '加个深色开关' }, 1000, 'a')!;
  const fromAgent = makeGroupMessage(mac, { author: 'agent', phase: 'question', body: '跟随系统还是手动？' }, 1000, 'b')!;

  const userLine = compactGroupLine(fromUser, 1000);
  const agentLine = compactGroupLine(fromAgent, 1000);
  assert.match(userLine.who, /甲方/);
  assert.match(agentLine.who, /乙方/);
  assert.match(agentLine.who, /macOS/);
  assert.equal(userLine.phase, '需求');
  assert.equal(agentLine.phase, '追问');
});

test('紧凑行：正文压成一行（换行不会把列表撑开）', () => {
  const message = makeGroupMessage(win, {
    author: 'agent',
    phase: 'analysis',
    body: '我理解：\n1. 设置页加开关\n2. 默认跟随系统',
  }, 1000, 'c')!;
  const line = compactGroupLine(message, 1000);
  assert.equal(line.body.includes('\n'), false, '必须压成单行');
  assert.match(line.body, /设置页加开关/);
});

test('紧凑行：当天只显示时分，跨天带日期', () => {
  const at = new Date(2026, 10, 23, 9, 5).getTime();
  const message = makeGroupMessage(win, { author: 'agent', phase: 'result', body: '完成' }, at, 'd')!;
  const sameDay = compactGroupLine(message, new Date(2026, 10, 23, 20, 0).getTime());
  const otherDay = compactGroupLine(message, new Date(2026, 10, 25, 20, 0).getTime());
  assert.equal(sameDay.time, '09:05');
  assert.match(otherDay.time, /11\/23 09:05/);
});

test('顶部状态：局域网没连但中继通着，必须是「已连接」而不是「未连接」', () => {
  // 真机踩过：只看局域网 role=off 就显示「未连接」，而状态栏明明写着「中继已连接 · 2台」
  const viaRelay = groupHeader({ role: 'off', relay: { connected: true, peers: 1, url: 'https://plaitcode.com' } });
  assert.equal(viaRelay.status, '中继已连接 · 2 台');
  assert.equal(viaRelay.on, true);
  assert.match(viaRelay.sub, /plaitcode\.com/);

  // 中继也在重连中，才算真的没连上
  const offline = groupHeader({ role: 'off', relay: { connected: false, peers: 0, url: 'https://plaitcode.com' } });
  assert.equal(offline.status, '未连接');
  assert.equal(offline.on, false);

  // 完全没有中继配置时和以前一样
  assert.equal(groupHeader({ role: 'off' }).status, '未连接');

  // 局域网里以「群聊 + 台数」表达，不暴露主机/从机
  assert.equal(groupHeader({ role: 'hub', peerCount: 0 }).status, '群聊已开 · 等对方加入');
  assert.equal(groupHeader({ role: 'hub', peerCount: 1, relay: { connected: true, peers: 1, url: 'x' } }).status, '群聊中 · 2 台设备');
  assert.equal(groupHeader({ role: 'peer' }).status, '群聊中');
});

test('顶部状态：一台设备都没看到时，不能说「群聊中」', () => {
  /*
   * 真机踩过：对方早就重启了，本机界面还挂着「已连接」和上一份群记录，
   * 两台看到的群完全不一样。除本机以外一个设备都没有，就不该说在群里。
   */
  const stale = groupHeader({ role: 'peer', peerCount: 0 });
  assert.equal(stale.on, false, '没有对方时状态灯不能是绿的');
  assert.equal(stale.status, '群聊已开 · 等对方加入');
  assert.match(stale.sub, /邀请码/);

  // 看到了对方才算真的在群里
  assert.equal(groupHeader({ role: 'peer', peerCount: 1 }).status, '群聊中 · 2 台设备');
  assert.equal(groupHeader({ role: 'peer', peerCount: 2 }).status, '群聊中 · 3 台设备');
});

/**
 * 电脑端补齐（与手机能力一致）：指派、停止、看结果。
 *
 * 指派最容易写错的地方是「本机也跑了」——两台机器各做一遍，
 * 谁后写谁覆盖，比没人做更难查。所以这里钉住那个提前返回。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
const GROUP = readFileSync('src/views/groupPanel.ts', 'utf8');

test('群窗口能把需求指派给某台设备，并一路传到 postGroup', () => {
  const index = PANEL.indexOf('async sendGroupMessage(');
  assert.ok(index > 0);
  const body = PANEL.slice(index, index + 320);
  assert.match(body, /assignee/, '群窗口发送要接受指派参数');
  assert.match(body, /origin: 'group'/, '仍然走群频道');
  assert.match(PANEL, /\(assignee \? \{ assignee \} : \{\}\)/, '指派要进 postGroup 的载荷');
});

test('指派给别的设备时本机不执行（否则同一改动做两遍）', () => {
  const guard = PANEL.indexOf('assignee !== this.lanSync.localPeer().id');
  assert.ok(guard > 0, '缺少「指派给别人就不跑」的判断');
  const notice = PANEL.indexOf('sync.assignedElsewhere', guard);
  assert.ok(notice > guard, '要告诉用户"这条已经交给别的设备了"');
});

test('群窗口有「由谁执行」和「停止执行」', () => {
  assert.match(GROUP, /由谁执行/, '要能选执行设备');
  assert.match(GROUP, /停止执行/, '要能中止电脑上的任务');
  assert.match(GROUP, /type: 'control', command: 'stop'/, '停止走控制通道');
});

test('选中的设备掉线后退回「所有人」，不会发出没人接的需求', () => {
  const index = GROUP.indexOf('function renderAssign(');
  assert.ok(index > 0);
  const body = GROUP.slice(index, index + 900);
  assert.match(body, /chips\.some\(\(item\) => item\.id === assignee\.id\)/, '要校验选中项还在不在');
});

test('结果与未执行保留换行（压成一行会把文件清单挤成不可读长句）', () => {
  const index = GROUP.indexOf('const body = document.createElement');
  const body = GROUP.slice(index, index + 420);
  assert.match(body, /result' \|\| line\.phaseKey === 'blocked'/, '结果类消息要用完整正文');
  assert.match(GROUP, /full: message\.body\.slice\(0, 2_000\)/, '要额外传完整正文');
});