import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildGroupTimeline, compactGroupLine, groupHeader } from '../views/groupPanel';
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

test('队友往来与群消息合成一条时间线（按时间交错，不再单独压在下半部分）', () => {
  const at = (minute: number): number => new Date(2026, 10, 25, 9, minute).getTime();
  const messages = [
    makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '做件事' }, at(0), 'a')!,
    makeGroupMessage(mac, { author: 'agent', phase: 'result', body: '做完了' }, at(30), 'b')!,
  ];
  const notes = [
    { id: 'n1', who: 'macOS · B', body: '我先做这端', at: at(10), replyTo: '' },
    { id: 'n2', who: 'Windows · A', body: '好，我做那端', at: at(20), replyTo: 'n1' },
  ];
  const lines = buildGroupTimeline(messages, notes, {
    now: at(60),
    roster: [win, mac],
    labelOf: (peer) => (peer ? `${peer.platform}:${peer.name}` : ''),
    localId: win.id,
  });
  assert.deepEqual(
    lines.map((line) => line.body),
    ['做件事', '我先做这端', '好，我做那端', '做完了'],
    '往来必须按时间插在群消息之间',
  );
  assert.deepEqual(lines.map((line) => line.kind), ['group', 'note', 'note', 'group']);
  assert.equal(lines[1]!.phase, '队友对话');
  assert.equal(lines[2]!.phase, '回复队友');
  assert.equal(lines[1]!.phaseKey, 'note');
  assert.equal(compactGroupLine(messages[0]!, at(60)).at, at(0), '紧凑行要带原始时间戳供排序');
});

test('电脑群窗口：需求的回声晚到，回复也不能排在它上面（真实存档顺序）', () => {
  /*
   * 现场（2026-11-26，`lan-sync.json`）：
   *   07:56:27 乙方 progress「收到。先停下手上这一轮…」
   *   07:56:28 乙方 progress「【项目 …】这台开始执行：…」
   *   07:56:31 甲方 requirement「瞎搞，一点逻辑和做项目的思维都没有…」
   * 需求先在协议层到达、agent 立刻回话；甲方那条气泡是发送方随后才广播过来的。
   * 直接按到达顺序排，用户看到的就是「回复在我的话上面」。
   */
  const base = Date.UTC(2026, 10, 26, 7, 56);
  const requirementId = 'rmwws8hddjz0kq8';
  const messages = [
    { ...makeGroupMessage(win, { author: 'agent', phase: 'progress', body: '收到。先停下手上这一轮' }, base + 1_000, 'a')!, requirementId, receivedAt: base + 1_000 },
    { ...makeGroupMessage(win, { author: 'agent', phase: 'progress', body: '【项目 X】这台开始执行' }, base + 2_000, 'b')!, requirementId, receivedAt: base + 2_000 },
    { ...makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '瞎搞，一点逻辑都没有' }, base + 5_000, 'c')!, requirementId, receivedAt: base + 5_000 },
  ];
  const lines = buildGroupTimeline(messages, [], {
    now: base + 60_000,
    roster: [win, mac],
    labelOf: (peer) => (peer ? peer.name : ''),
    localId: win.id,
  });
  assert.deepEqual(
    lines.map((line) => line.body),
    ['瞎搞，一点逻辑都没有', '收到。先停下手上这一轮', '【项目 X】这台开始执行'],
    '甲方的需求必须排在回应它的乙方发言之前',
  );
  assert.deepEqual(
    lines.map((line) => line.side),
    ['user', 'agent', 'agent'],
    '左右侧不变：需求在右，乙方在左',
  );
});

test('@所有人时：已读与未读都要列出来（没回执的那台不能「消失」）', () => {
  /*
   * 用户实况（2026-11-25）：「我发的消息没有 @ 任何 agent，默认是所有人都收到消息，
   * 但是显示只有『已读：macOS · 郭宏宇的Mac mini』，别的 agent 没有显示已读未读状态」。
   *
   * 收件人 = 群里每一台（含本机）；本机自己发的一定读到（见下一个用例），
   * 真正「未读」的是**第三台**还没回执的设备。
   */
  const at = new Date(2026, 10, 25, 12, 8).getTime();
  const linux: SyncPeer = { id: 'p-linux', name: 'Linux', platform: 'linux', project: 'app', version: 't' };
  const message = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '四象限卡片…' }, at, 'r')!;
  const [line] = buildGroupTimeline([message], [], {
    now: at + 60_000,
    roster: [win, mac, linux],
    labelOf: (peer) => (peer ? `${peer.name}` : ''),
    localId: win.id,
    labelForId: (id) => (id === win.id ? 'Windows · MAGICBOOKV14' : id === mac.id ? 'macOS · Mac mini' : 'Linux'),
    reads: { [message.id]: [mac.id] },
  });
  assert.deepEqual(
    [...line!.readBy!].sort(),
    ['Windows · MAGICBOOKV14（本机）', 'macOS · Mac mini'].sort(),
    '已读：本机（自己发的）+ macOS',
  );
  assert.deepEqual(line!.unreadBy, ['Linux'], '没回执的那台必须显式说未读');

  // 都回过执 → 没有「未读」这一段。
  const [allRead] = buildGroupTimeline([message], [], {
    now: at + 60_000,
    roster: [win, mac, linux],
    labelOf: (peer) => (peer ? peer.name : ''),
    localId: win.id,
    labelForId: (id) => (id === win.id ? 'Windows' : id === mac.id ? 'macOS' : 'Linux'),
    reads: { [message.id]: [win.id, mac.id, linux.id] },
  });
  assert.equal(allRead!.unreadBy, undefined);
});

test('点名给某一台时：收件人只有那一台，本机不算在内', () => {
  const at = Date.now();
  const message = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '派给 mac', to: mac.id }, at, 't')!;
  const [line] = buildGroupTimeline([message], [], {
    now: at,
    roster: [win, mac],
    labelOf: (peer) => (peer ? peer.name : ''),
    localId: win.id,
    labelForId: (id) => (id === win.id ? 'Windows' : 'macOS'),
    reads: {},
  });
  assert.deepEqual(line!.addressed, ['macOS']);
  assert.deepEqual(line!.unreadBy, ['macOS']);
});

test('自己发的那条：本机一定在已读里，即使还没收到自己的回执', () => {
  /*
   * 用户实况（2026-11-25，截图）：「Windows（团队群里输入对话的设备）团队任务对话框显示
   * 收到了消息，但是团队群里面显示只有 macmini 已读」。
   *
   * 回执的含义是「已收到」。自己发的那条必然在本机的群记录里，所以界面按事实补上，
   * 不依赖那条可能还没写进状态的自回执。
   */
  const at = Date.now();
  const message = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '四象限…' }, at, 'self')!;
  const [line] = buildGroupTimeline([message], [], {
    now: at,
    roster: [win, mac],
    labelOf: (peer) => (peer ? peer.name : ''),
    localId: win.id,
    labelForId: (id) => (id === win.id ? 'Windows' : 'macOS'),
    // 只有对端的回执，本机那条「自回执」还没写进来。
    reads: { [message.id]: [mac.id] },
  });
  assert.deepEqual([...line!.readBy!].sort(), ['Windows（本机）', 'macOS'].sort(), '本机必须出现在已读里');
  assert.equal(line!.unreadBy, undefined, '两台都读到了，不该再有未读');

  // 点名给别人时，本机不是收件人，不能被算成「已读」。
  const directed = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '只给 mac', to: mac.id }, at, 'to')!;
  const [directedLine] = buildGroupTimeline([directed], [], {
    now: at,
    roster: [win, mac],
    labelOf: (peer) => (peer ? peer.name : ''),
    localId: win.id,
    labelForId: (id) => (id === win.id ? 'Windows' : 'macOS'),
    reads: {},
  });
  assert.deepEqual(directedLine!.readBy, []);
  assert.deepEqual(directedLine!.unreadBy, ['macOS']);
});

test('气泡上要能看出这条指派给哪台（发错时一眼可查）', () => {
  const at = Date.now();
  const message = makeGroupMessage(
    win,
    { author: 'user', phase: 'requirement', body: '派给 mac', assignee: 'p-mac' },
    at,
    'x',
  )!;
  const [line] = buildGroupTimeline([message], [], {
    now: at,
    roster: [win, mac],
    labelOf: (peer) => (peer ? peer.name : ''),
    localId: win.id,
    labelForId: (id) => (id === 'p-mac' ? 'macOS · Mac' : id),
  });
  assert.equal(line!.assigneeLabel, 'macOS · Mac');

  // 找不到设备信息时退回 id，不能悄悄丢掉指派信息。
  const [fallback] = buildGroupTimeline([message], [], {
    now: at,
    roster: [win, mac],
    labelOf: (peer) => (peer ? peer.name : ''),
    localId: win.id,
  });
  assert.equal(fallback!.assigneeLabel, 'p-mac');
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
/** 群窗口的界面脚本已抽成真文件（media/group.js），行为类断言读它。 */
const GROUP_SCRIPT = readFileSync('media/group.js', 'utf8');

/**
 * 取面板里一个方法的**完整方法体**。
 *
 * 以前用 `slice(start, start + 1400)` 这种固定长度 —— 方法一长，断言就会落在方法外面
 * 变成假失败（2026-11-26 给 `sendGroupMessage` 加了「方案确认」分支之后就是这样）。
 */
function panelMethod(signature: string): string {
  const start = PANEL.indexOf(signature);
  if (start < 0) return '';
  const end = PANEL.indexOf('\n  }\n', start);
  return end < 0 ? PANEL.slice(start, start + 6_000) : PANEL.slice(start, end + 4);
}

test('群窗口能把需求指派给某台设备，并一路传到 postGroup', () => {
  const body = panelMethod('async sendGroupMessage(');
  assert.ok(body, '要有 sendGroupMessage');
  assert.match(body, /assignee/, '群窗口发送要接受指派参数');
  assert.match(body, /origin: 'group'/, '仍然走群频道');
  assert.match(PANEL, /\(assignee \? \{ assignee \} : \{\}\)/, '指派要进 postGroup 的载荷');
});

test('群窗口的附件走普通对话框同一套规则（图片 → 视觉，不再只拼路径）', () => {
  const index = PANEL.indexOf('async stageGroupAttachment(');
  assert.ok(index > 0, '群窗口附件要有统一的暂存入口');
  const body = PANEL.slice(index, index + 1_600);
  assert.match(body, /buildClipboardAttachment/, '复用普通对话框的附件规则（大小 / 类型 / 敏感文件）');
  assert.match(body, /attachmentCacheUri/, '图片要落成真实文件，面板才能显示');

  const send = panelMethod('async sendGroupMessage(');
  assert.match(send, /groupStagedAttachments/, '按 id 取回暂存的附件');
  assert.match(send, /attachments/, '随发送交给 agent，而不是只把路径拼进正文');

  const share = PANEL.indexOf('private async shareGroupAttachments(');
  assert.ok(share > 0, '附件要分片传给另一台，否则对面 agent 看不到');
  assert.match(PANEL.slice(share, share + 1_200), /shareAsset/);

  // 群窗口里不能再出现「把临时路径拼进正文」的老做法。
  const GROUP_PANEL = readFileSync('src/views/groupPanel.ts', 'utf8');
  assert.doesNotMatch(GROUP_PANEL, /附件（本机文件，另一台看不到）/, '旧文案已经不再成立');
  assert.match(GROUP_PANEL, /callbacks\.attach/, '附件交给主面板解析');
});

test('指派给别的设备时本机不执行（否则同一改动做两遍）', () => {
  const guard = PANEL.indexOf('assignee !== this.lanSync.localPeer().id');
  assert.ok(guard > 0, '缺少「指派给别人就不跑」的判断');
  const notice = PANEL.indexOf('sync.assignedElsewhere', guard);
  assert.ok(notice > guard, '要告诉用户"这条已经交给别的设备了"');
});

test('群窗口有「由谁执行」和「停止执行」', () => {
  assert.match(GROUP_SCRIPT, /由谁执行/, '要能选执行设备');
  assert.match(GROUP_SCRIPT, /停止执行/, '要能中止电脑上的任务');
  assert.match(GROUP_SCRIPT, /type: 'control', command: 'stop'/, '停止走控制通道');
});

test('选中的设备掉线后退回「所有人」，不会发出没人接的需求', () => {
  const index = GROUP_SCRIPT.indexOf('function renderAssign(');
  assert.ok(index > 0);
  const body = GROUP_SCRIPT.slice(index, index + 1_600);
  assert.match(body, /chips\.some\(/, '要校验选中项还在不在');
  assert.match(body, /assignee = null/, '掉线了就退回所有人');
});

test('结果与未执行保留换行（压成一行会把文件清单挤成不可读长句）', () => {
  const index = GROUP_SCRIPT.indexOf('const body = document.createElement');
  const body = GROUP_SCRIPT.slice(index, index + 420);
  assert.match(body, /result' \|\| line\.phaseKey === 'blocked'/, '结果类消息要用完整正文');
  // 完整正文由宿主侧的建筑（`full`）提供，复制也用它。
  assert.match(GROUP, /full: message\.body\.slice\(0, 4_000\)/, '要额外传完整正文（复制也用它）');
});