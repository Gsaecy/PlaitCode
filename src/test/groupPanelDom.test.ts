import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 群窗口脚本的**真实 DOM 测试**。
 *
 * 为什么要它（用户实况，2026-11-24）：
 *   「Windows 输入框文字发送不出去，由谁执行那行不再显示内容了，没法选择设备」
 *   「macos 那边也没法发送消息」
 *
 * 两台都发不出去 —— 这类 bug 只有把脚本真的跑起来才能抓住：tsc 抓不到，
 * 字符串断言也抓不到「运行时抛错导致后半段没执行」。
 *
 * 这里把群窗口脚本（`media/group.js`）在真实 DOM 里执行，
 * 然后像 webview 一样派发 state 消息，检查：
 *   1. 脚本不抛错（抛错会让后面的渲染全停，正是「由谁执行」空掉的原因）；
 *   2. 「由谁执行」真的画出设备按钮；
 *   3. 打字后发送真的发出去，前缀不会把正文吃掉。
 */

/**
 * 脚本现在是一个真文件（`media/group.js`），直接从磁盘读。
 *
 * 以前它内联在 `groupPanel.ts` 的模板字符串里，只能从 `out/extension.js` 里按锚点切出来，
 * 再求值一次模板字符串。搬出去之后不需要这两步了 —— 测试跑的就是**送给 webview 的那份**。
 */
function extractPanelSource(): string {
  return readFileSync('media/group.js', 'utf8');
}

const MARKUP = `<!DOCTYPE html><html><body>
  <span id="status"></span><div id="sub"></div><div id="peek"></div>
  <div id="moreBtn"></div><div id="drawer" style="display:none"></div>
  <div id="members"></div><div id="banner"><b id="bannerWho">乙方在等你回答</b><button id="bannerClose"></button><div class="banner-text" id="bannerText"></div><button class="banner-more" id="bannerMore" type="button">展开全文</button><div id="bannerOpts"></div><div id="bannerHint"></div></div>
  <div id="versionWarn" style="display:none"></div>
  <div id="projectWarn" style="display:none"></div>
  <div id="projectRows"></div><div id="projectBox" style="display:none"></div>
  <div id="invite" style="display:none"><div id="inviteCode"></div><div id="inviteHow"></div>
    <button id="copyInvite"></button><button id="copyInviteInline"></button><div id="inviteToggle"></div></div>
  <div id="board" style="display:none"><div class="board-head" id="boardHead"><b>任务看板</b><span id="boardHint"></span></div><div id="boardCols"></div></div>
  <main id="feed"></main>
  <div id="assign"></div><div id="mention" style="display:none"></div>
  <div class="agent-status" id="agentStatus"></div>
  <textarea id="text"></textarea>
  <div id="attachList" style="display:none"></div>
  <button id="attachBtn" type="button"></button>
  <input id="fileInput" type="file" />
  <button id="voiceBtn" type="button"></button>
  <button id="send"></button>
</body></html>`;

interface Mounted {
  window: any;
  document: any;
  posted: any[];
  text: any;
  errors: string[];
}

async function mount(state: Record<string, unknown>): Promise<Mounted> {
  const { parseHTML } = await import('linkedom');
  const { window, document } = parseHTML(MARKUP) as any;
  const posted: any[] = [];
  const errors: string[] = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => posted.push(message),
    getState: () => undefined,
    setState: () => undefined,
  });
  window.addEventListener('error', (event: any) => {
    errors.push(String(event?.error?.message ?? event?.message ?? event));
  });
  const vscode = { postMessage: (message: unknown) => posted.push(message) };
  try {
    // 内嵌脚本以 IIFE 形式运行，window/document/acquireVsCodeApi 由这里注入。
    const run = new Function('window', 'document', 'acquireVsCodeApi', extractPanelSource());
    run(window, document, window.acquireVsCodeApi);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const event = new window.Event('message');
  (event as any).data = { type: 'state', ...state };
  window.dispatchEvent(event);
  void vscode;
  return { window, document, posted, text: document.getElementById('text'), errors };
}

const BASE_STATE = {
  localId: 'p-win',
  role: 'hub',
  projectName: 'deepseek-hwchat',
  projectRepo: 'github.com/gsaecy/plaitcode',
  projectRows: [
    { device: 'MagicBookV14 · win32', project: 'deepseek-hwchat', repo: 'github.com/gsaecy/plaitcode', isLocal: true },
    { device: '192.168.0.8 · darwin', project: 'personal workstation', repo: 'github.com/gsaecy/personal-workstation-os', isLocal: false },
  ],
  projectMismatch: '',
  invite: '',
  inviteText: '',
  inviteWaiting: false,
  header: { status: '群聊中 · 2 台设备', sub: '', on: true },
  peers: [
    { id: 'p-win', name: 'MagicBookV14 · win32', platform: 'Windows', project: 'deepseek-hwchat', isLocal: true },
    { id: 'p-mac', name: '192.168.0.8 · darwin', platform: 'macOS', project: 'personal workstation', isLocal: false },
  ],
  messages: [],
  lines: [],
  taskGroups: [],
  canStop: true,
};

function click(node: any): void {
  const win = node.ownerDocument.defaultView;
  node.dispatchEvent(new win.Event('click', { bubbles: true }));
}

test('脚本跑起来不抛错（抛错会让「由谁执行」整行空掉）', async () => {
  const { errors } = await mount(BASE_STATE);
  assert.deepEqual(errors, [], '群窗口脚本不该抛错');
});

test('「由谁执行」真的画出全部设备', async () => {
  const { document } = await mount(BASE_STATE);
  const chips = [...document.querySelectorAll('#assign .chip')].map((node: any) => node.textContent);
  assert.ok(chips.includes('所有人'), `缺少「所有人」，实际：${JSON.stringify(chips)}`);
  assert.ok(chips.some((text: string) => text.includes('MagicBookV14')), '缺少本机设备');
  assert.ok(chips.some((text: string) => text.includes('192.168.0.8')), '缺少对端设备');
});

test('输入框默认写出 @所有人，选中设备后换成 @那台', async () => {
  const { document, text } = await mount(BASE_STATE);
  assert.equal(text.value, '@所有人 ', '默认应当是 @所有人');
  const target = [...document.querySelectorAll('#assign .chip')]
    .find((node: any) => node.textContent.includes('192.168.0.8'));
  assert.ok(target, '没找到对端设备按钮');
  click(target);
  // 用短 token（设备名的第一段），否则 @ 前缀会在空格处断开。
  assert.match(text.value, /^@192\.168\.0\.8 /, `选中后应换成 @那台，实际 ${text.value}`);
});

test('打字后按发送，消息真的发出去（前缀不被当成正文）', async () => {
  const { document, text, posted } = await mount(BASE_STATE);
  text.value = '@所有人 分别报一下自己的项目';
  click(document.getElementById('send'));
  const sent = posted.filter((message) => message.type === 'send');
  assert.equal(sent.length, 1, '必须真的发出一条 send');
  assert.equal(sent[0].text, '分别报一下自己的项目', '前缀要被剥掉，正文不能丢');
});

test('没有前缀时原样发送，不会被吞掉', async () => {
  const { document, text, posted } = await mount(BASE_STATE);
  text.value = '报数';
  click(document.getElementById('send'));
  const sent = posted.filter((message) => message.type === 'send');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '报数');
});

test('只写了 @设备、没写正文时不发（但不能把有正文的也吞掉）', async () => {
  const { document, text, posted } = await mount(BASE_STATE);
  text.value = '@所有人 ';
  click(document.getElementById('send'));
  assert.equal(posted.filter((message) => message.type === 'send').length, 0, '空正文不该发出去');

  text.value = '有正文';
  click(document.getElementById('send'));
  assert.equal(posted.filter((message) => message.type === 'send').length, 1, '有正文必须发出去');
});

test('团队群也支持把文件拖进来（和主对话框一样，不能少这一步）', async () => {
  const { window, text, posted } = await mount(BASE_STATE);
  // 拖放必须阻止浏览器默认行为，否则 webview 会直接「用这个文件打开」。
  const over = new window.Event('dragover', { bubbles: true, cancelable: true });
  text.dispatchEvent(over);
  assert.equal(over.defaultPrevented, true, 'dragover 必须被拦下');

  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  (drop as any).dataTransfer = { files: [{ name: 'huge.png', size: 7 * 1024 * 1024, type: 'image/png' }] };
  text.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented, true, 'drop 必须被拦下');
  const toast = posted.find((message) => message.type === 'toast');
  assert.ok(toast, '超大文件要提示，而不是静默丢掉');
  assert.match(String(toast.text), /6 MB/, '拖进来的文件必须走和文件选择同一套 6 MB 校验');

  // 拖别的东西（纯文本）进来时不能误拦，否则正文就没法拖进来了。
  const plain = new window.Event('drop', { bubbles: true, cancelable: true });
  (plain as any).dataTransfer = { files: [] };
  text.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false, '没有文件时不要拦默认行为');
});

test('选中设备后发送，指派信息跟着走', async () => {
  const { document, text, posted } = await mount(BASE_STATE);
  const target = [...document.querySelectorAll('#assign .chip')]
    .find((node: any) => node.textContent.includes('192.168.0.8'));
  click(target);
  text.value = text.value + '检查同步功能';
  click(document.getElementById('send'));
  const sent = posted.filter((message) => message.type === 'send');
  assert.equal(sent.length, 1, '必须发出去');
  assert.equal(sent[0].assignee?.id, 'p-mac', '选了对端设备就该指派给它');
  assert.equal(sent[0].text, '检查同步功能', '前缀要剥掉');
});

test('输入 @某台（设备名带空格）时，指派的就是那台，正文不残留设备名', async () => {
  /*
   * 用户实况（2026-11-25）：输入框 `@郭宏宇的Macmini`，发送后却按 Windows 执行。
   * 根因是 token 去掉了空格，匹配时却拿带空格的设备名做子串比较 —— 永远对不上，
   * 于是退回「所有人」或正在追问的那台。
   */
  const peers = [
    { id: 'p-win', name: 'MAGICBOOKV14', label: 'Windows · MAGICBOOKV14', platform: 'Windows', project: 'x', isLocal: true },
    { id: 'p-mac', name: '郭宏宇的Mac mini', label: 'macOS · 郭宏宇的Mac mini', platform: 'macOS', project: 'y', isLocal: false },
  ];
  const { document, text, posted } = await mount({ ...BASE_STATE, peers });

  text.value = '@郭宏宇的Macmini 服务器已经SSH连接';
  click(document.getElementById('send'));
  let sent = posted.filter((message) => message.type === 'send');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].assignee?.id, 'p-mac', '@ 的是 macOS，就不能派给 Windows');
  assert.equal(sent[0].text, '服务器已经SSH连接', '正文不能残留半截设备名');

  text.value = '@MAGICBOOKV14 这条给本机';
  click(document.getElementById('send'));
  sent = posted.filter((message) => message.type === 'send');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].assignee?.id, 'p-win', '@Windows 设备名要指到本机');
  assert.equal(sent[1].text, '这条给本机');
});

test('两台同名设备：@ token 自动补设备号，@ 谁就是谁；解析不了就不猜', async () => {
  /*
   * 通用问题：用户可能有不止两台设备，且设备名可能相同（默认主机名都叫 DESKTOP）。
   * token 必须唯一，否则 @ 其中一台会命中另一台。
   */
  const peers = [
    { id: 'p-aaaa1111', name: 'DESKTOP', label: 'Windows · DESKTOP @192.168.0.2', platform: 'Windows', project: 'x', isLocal: true },
    { id: 'p-bbbb2222', name: 'DESKTOP', label: 'Windows · DESKTOP @192.168.0.3', platform: 'Windows', project: 'y', isLocal: false },
  ];
  const { document, text, posted } = await mount({ ...BASE_STATE, peers });
  const chips = [...document.querySelectorAll('#assign .chip')];
  const second = chips.find((node: any) => node.textContent.includes('@192.168.0.3'));
  assert.ok(second, '要能选到第二台同名设备');
  const token = String(second!.title).split(' · ')[0]!.replace(/^@/, '');
  assert.notEqual(token, 'DESKTOP', '同名设备必须补设备号，不能都叫 @DESKTOP');

  text.value = '@' + token + ' 给第二台';
  click(document.getElementById('send'));
  let sent = posted.filter((message) => message.type === 'send');
  assert.equal(sent[0]!.assignee?.id, 'p-bbbb2222', '唯一 token 必须指到第二台');
  assert.equal(sent[0]!.text, '给第二台');

  // 只写公共前缀（两台都命中）→ 不猜。
  text.value = '@DESKTOP 这是给谁的';
  click(document.getElementById('send'));
  sent = posted.filter((message) => message.type === 'send');
  assert.equal(sent[1]!.assignee, undefined, '多台都对得上时宁可退回「所有人」，不能乱派');
});

test('没有对端设备时也不崩（只有本机）', async () => {
  const { document, errors } = await mount({
    ...BASE_STATE,
    peers: [{ id: 'p-win', name: 'MagicBookV14 · win32', platform: 'Windows', project: 'x', isLocal: true }],
  });
  assert.deepEqual(errors, []);
  const chips = [...document.querySelectorAll('#assign .chip')].map((node: any) => node.textContent);
  assert.ok(chips.includes('所有人'));
  assert.ok(chips.some((text: string) => text.includes('MagicBookV14')));
});

test('已读回执画在气泡下面：已读列出设备，没回执时点名在等谁', async () => {
  const lines = [
    {
      kind: 'group', side: 'user', who: '你', phase: '需求', phaseKey: 'requirement', body: '都看一下',
      time: '09:00', full: '都看一下', requirementId: 'r1',
      device: { id: 'p-win', name: '你', isLocal: true },
      readBy: ['Windows · MAGICBOOKV14（本机）', 'macOS · Mac mini'], unreadBy: undefined, ackPending: false,
    },
    {
      kind: 'group', side: 'user', who: '你', phase: '需求', phaseKey: 'requirement', body: '第二条',
      time: '09:01', full: '第二条', requirementId: 'r2',
      device: { id: 'p-win', name: '你', isLocal: true },
      readBy: [],
      unreadBy: ['Windows · MAGICBOOKV14（本机）', 'macOS · Mac mini'],
      ackPending: true,
    },
  ];
  const { document, errors } = await mount({ ...BASE_STATE, lines });
  assert.deepEqual(errors, []);
  const receipts = [...document.querySelectorAll('#feed .receipt')].map((node: any) => node.textContent);
  assert.ok(receipts.some((text: string) => text.includes('已读') && text.includes('MAGICBOOKV14')), `缺少已读：${JSON.stringify(receipts)}`);
  assert.ok(
    receipts.some((text: string) => text.includes('等待确认收到：') && text.includes('Mac mini')),
    `没有回执时要点名在等谁：${JSON.stringify(receipts)}`,
  );
});

test('群里的图片画出来、文件画成一行的卡片，点图能用系统看图打开', async () => {
  /*
   * 用户 2026-11-25：「团队群需要有普通对话框的文件附件读取图片输出等全部功能，不要砍功能」。
   * 这条只认渲染结果：图片必须是 <img src>，不能退化成一行文件名。
   */
  const lines = [
    {
      kind: 'group', side: 'user', who: '你', phase: '需求', phaseKey: 'requirement', body: '看这张图',
      time: '09:00', full: '看这张图', requirementId: 'r1',
      device: { id: 'p-win', name: '你', isLocal: true },
      assets: [
        { id: 'a1', name: 'shot.png', kind: 'image', src: 'https://file+.vscode-resource.vscode-cdn.net/a1.png', ready: true },
        { id: 'a2', name: 'report.pdf', kind: 'file', ready: false },
        { id: 'a3', name: 'late.png', kind: 'image', src: '', ready: false },
      ],
    },
  ];
  const { window, document, posted, errors } = await mount({ ...BASE_STATE, lines });
  assert.deepEqual(errors, []);
  const images = [...document.querySelectorAll('#feed .msg-assets img.msg-image')];
  assert.equal(images.length, 1, '能显示的图片必须真的画成 img');
  assert.equal(images[0].getAttribute('src'), 'https://file+.vscode-resource.vscode-cdn.net/a1.png');
  const chips = [...document.querySelectorAll('#feed .msg-file')].map((node: any) => node.textContent);
  assert.ok(chips.some((text: string) => text.includes('文件 report.pdf')), `文件要成卡片：${JSON.stringify(chips)}`);
  assert.ok(chips.some((text: string) => text.includes('正在接收')), '还没到的图要说明正在接收，不能空着');

  click(images[0]);
  const opened = posted.find((message) => message.type === 'openAsset');
  assert.ok(opened && opened.id === 'a1', '点图要交给宿主用系统看图打开原图');
  void window;
});

test('群窗口把「未读：…」也画出来（只列已读会让人以为另一台没收到）', async () => {
  /*
   * 用户 2026-11-25 的截图：@所有人 的消息只显示「已读：macOS …」，本机那台凭空消失。
   */
  const lines = [
    {
      kind: 'group', side: 'user', who: '你', phase: '需求', phaseKey: 'requirement', body: '四象限卡片…',
      time: '12:08', full: '四象限卡片…', requirementId: 'r1',
      device: { id: 'p-win', name: '你', isLocal: true },
      readBy: ['macOS · Mac mini'],
      addressed: ['Windows · MAGICBOOKV14（本机）', 'macOS · Mac mini'],
      unreadBy: ['Windows · MAGICBOOKV14（本机）'],
      ackPending: false,
    },
    {
      kind: 'group', side: 'user', who: '你', phase: '需求', phaseKey: 'requirement', body: '等回执',
      time: '12:09', full: '等回执', requirementId: 'r2',
      device: { id: 'p-win', name: '你', isLocal: true },
      readBy: [],
      addressed: ['Windows · MAGICBOOKV14（本机）', 'macOS · Mac mini'],
      unreadBy: ['Windows · MAGICBOOKV14（本机）', 'macOS · Mac mini'],
      ackPending: true,
    },
  ];
  const { document, errors } = await mount({ ...BASE_STATE, lines });
  assert.deepEqual(errors, []);
  const receipts = [...document.querySelectorAll('#feed .receipt')].map((node: any) => node.textContent);
  assert.ok(
    receipts.some((text: string) => text.includes('已读：macOS · Mac mini') && text.includes('未读：Windows · MAGICBOOKV14（本机）')),
    `已读与未读要同时出现：${JSON.stringify(receipts)}`,
  );
  assert.ok(
    receipts.some((text: string) => text.includes('等待确认收到：') && text.includes('macOS')),
    `一条回执都没有时要点名在等谁：${JSON.stringify(receipts)}`,
  );
});

test('团队群：实时听写的整段重发要替换，不能把同一句话追加十几遍', async () => {
  /*
   * VS Code 内听写是实时的：每识别出几个字就把**整句**送来一次。
   * 直接 append 会让输入框变成「你好你好你好…」。这里用真实 DOM 跑一遍：
   * 先来「帮我」再来「帮我看看」，最后给最终结果，输入框里只应有一份。
   */
  const { window, document } = await mount(BASE_STATE);
  const text = document.getElementById('text');
  text.value = '';

  const feed = (data: Record<string, unknown>): void => {
    const event = new window.Event('message');
    (event as any).data = data;
    window.dispatchEvent(event);
  };

  feed({ type: 'voiceText', text: '帮我', live: true });
  assert.equal(text.value, '帮我', '第一段实时结果直接填入');
  feed({ type: 'voiceText', text: '帮我看看', live: true });
  assert.equal(text.value, '帮我看看', '第二段要把第一段换掉，不是接在后面');
  feed({ type: 'voiceText', text: '帮我看看这个报错', live: false });
  assert.equal(text.value, '帮我看看这个报错', '最终结果同样替换');

  // 用户已经手打的正文要保留在识别结果前面。
  text.value = '前置内容';
  feed({ type: 'voiceText', text: '接着说', live: false });
  assert.equal(text.value, '前置内容 接着说', '保留用户自己打的字');
});

test('底部是每台设备的 agent 状态灯，操作提示文案已经删掉', async () => {
  /*
   * 用户 2026-11-25：绿闪=运行中、灰=已停止、红=异常中断、黄闪=等确认；
   * 位置原来那句「Enter 发送 · Shift+Enter 换行 · …」要删掉，改用同样的小字体。
   */
  const statuses = [
    { id: 'p-win', label: 'Windows · MAGICBOOKV14', state: 'running', isLocal: true },
    { id: 'p-mac', label: 'macOS · Mac mini', state: 'waiting', isLocal: false },
  ];
  const { document, errors } = await mount({ ...BASE_STATE, statuses });
  assert.deepEqual(errors, []);
  const dots = [...document.querySelectorAll('#agentStatus .dot')].map((node: any) => node.className);
  assert.deepEqual(dots, ['dot running', 'dot waiting'], `指示灯类名应为状态：${JSON.stringify(dots)}`);
  const text = document.getElementById('agentStatus').textContent;
  assert.match(text, /Windows · MAGICBOOKV14（本机） 运行中/);
  assert.match(text, /macOS · Mac mini 等待确认/);
  assert.doesNotMatch(document.body.textContent, /Enter 发送 · Shift\+Enter 换行/, '旧的提示文案要删掉');

  // 出错 / 已停止也要能画出来
  const other = await mount({
    ...BASE_STATE,
    statuses: [
      { id: 'p-win', label: 'Windows', state: 'error', isLocal: true },
      { id: 'p-mac', label: 'macOS', state: 'idle', isLocal: false },
    ],
  });
  const classes = [...other.document.querySelectorAll('#agentStatus .dot')].map((node: any) => node.className);
  assert.deepEqual(classes, ['dot error', 'dot idle']);
  assert.match(other.document.getElementById('agentStatus').textContent, /异常中断/);
  assert.match(other.document.getElementById('agentStatus').textContent, /已停止/);
});

test('群窗口气泡上的「复制」真的把整条消息交给宿主', async () => {
  const lines = [{
    kind: 'group', side: 'agent', who: 'Windows · A', phase: '结果', phaseKey: 'result',
    body: '要复制的内容', full: '要复制的内容\n第二行', time: '09:00',
    device: { id: 'p-win', name: 'Windows · A', isLocal: false },
  }];
  const { document, posted, errors } = await mount({ ...BASE_STATE, lines });
  assert.deepEqual(errors, []);
  const button = document.querySelector('#feed .msg-copy');
  assert.ok(button, '气泡上要有「复制」按钮');
  click(button);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const copied = posted.filter((message) => message.type === 'copyText');
  assert.equal(copied.length, 1, '没有附件时走纯文本路径');
  assert.match(copied[0].text, /要复制的内容/, '正文必须带上');
  assert.match(copied[0].text, /第二行/, '完整正文（保留换行）');
});

test('群里的复制要把每张附件都取一遍（不许只取第一张），清单里带名称与路径', async () => {
  /*
   * 用户 2026-11-25：「气泡消息复制只能第一张附件/图……团队群聊里面也需要实现这个功能」。
   * 这条盯的是「遍历」这个行为本身：两张图就必须发两次 requestAssetData。
   */
  const lines = [{
    kind: 'group', side: 'user', who: '你', phase: '需求', phaseKey: 'requirement',
    body: '两张图', full: '两张图\n第二行', time: '09:00',
    device: { id: 'p-win', name: '你', isLocal: true },
    assets: [
      { id: 'a1', name: 'one.png', kind: 'image', path: '/tmp/one.png', ready: true },
      { id: 'a2', name: 'two.png', kind: 'image', path: '/tmp/two.png', ready: true },
      { id: 'a3', name: 'spec.pdf', kind: 'file', path: '/tmp/spec.pdf', ready: true },
    ],
  }];
  const { window, document, posted, errors } = await mount({ ...BASE_STATE, lines });
  assert.deepEqual(errors, []);
  const button = document.querySelector('#feed .msg-copy');
  assert.ok(button, '气泡上要有「复制」按钮');
  click(button);

  /*
   * 图片是一张一张问的（await 完才问下一张），所以这里像宿主那样逐条回绝：
   * 每来一个 requestAssetData 就回一条 assetData(ok:false)，模拟「读不到字节」。
   */
  const answered = new Set<string>();
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const pending = posted.filter(
      (message) => message.type === 'requestAssetData' && !answered.has(message.requestId),
    );
    if (!pending.length) {
      if (posted.some((message) => message.type === 'copyText')) break;
      continue;
    }
    for (const request of pending) {
      answered.add(request.requestId);
      const event = new window.Event('message');
      (event as any).data = { type: 'assetData', requestId: request.requestId, id: request.id, ok: false };
      window.dispatchEvent(event);
    }
  }

  const asked = posted.filter((message) => message.type === 'requestAssetData').map((message) => message.id);
  assert.deepEqual(asked, ['a1', 'a2'], `每张图都要索取字节，实际：${JSON.stringify(asked)}`);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const copied = posted.filter((message) => message.type === 'copyText');
  assert.equal(copied.length, 1, '写不进富文本时要退回纯文本');
  const text = String(copied[0].text);
  assert.match(text, /两张图/, '正文必须带上');
  assert.match(text, /第二行/, '完整正文（保留换行）');
  assert.match(text, /one\.png：\/tmp\/one\.png/, '第一张图要有名称与路径');
  assert.match(text, /two\.png：\/tmp\/two\.png/, '第二张图也要在清单里');
  assert.match(text, /spec\.pdf：\/tmp\/spec\.pdf/, '普通文件同样要带上');
});

test('追问提醒条默认只显示三行，markdown 记号清掉，可展开全文', async () => {
  /*
   * 用户实况：「这个消息这么长一块消息」——agent 一次给出「我的理解 + 证据表 + 待办」，
   * 提醒条原样铺开会占满半个窗口，反而看不到群里的对话。
   */
  const long = [
    '### 我的理解',
    '',
    '你告诉我 Mac 已经装好新包并登录了，意思是可以开始互测。',
    '',
    '| 事实 | 证据 |',
    '|---|---|',
    '| 便签在同步范围内 | sync.rs:658 |',
    '| 拉取只在启动时执行一次 | lib.rs:846 |',
    '',
    '**已做的两件事**',
    '- 群里已发：Mac 就绪',
    '- 文档已补',
    '',
    '### 🔔 需要你做的',
    '1. 在 Mac 应用里加一条便签',
    '2. 再新建一个项目',
    '3. 回来跟我说一句「Mac 写好了」',
  ].join('\n');
  const { document, errors } = await mount({
    ...BASE_STATE,
    openQuestion: { requirementId: 'r1', askerId: 'p-mac', askerLabel: 'macOS · Mac mini', body: long, options: ['接着做'] },
  });
  assert.deepEqual(errors, []);
  const bodyNode = document.getElementById('bannerText');
  assert.match(bodyNode.className, /banner-text/, '正文要用可截断的容器');
  assert.doesNotMatch(bodyNode.textContent, /^###/m, '标题记号要去掉');
  assert.doesNotMatch(bodyNode.textContent, /\*\*|^\|/m, '加粗与表格记号要去掉');
  assert.match(bodyNode.textContent, /我的理解/, '正文仍然可读');
  assert.equal(document.getElementById('bannerMore').style.display, 'inline-block', '长消息要给「展开全文」');
  assert.match(document.getElementById('bannerMore').textContent, /展开全文/);
  // 短消息不显示展开按钮（避免噪音）
  const short = await mount({ ...BASE_STATE, openQuestion: { requirementId: 'r2', askerId: 'p-mac', askerLabel: 'macOS', body: '要跟随系统还是手动？', options: [] } });
  assert.equal(short.document.getElementById('bannerMore').style.display, 'none');
});

test('所有类型的消息都按时间线顺序渲染（队友往来也在中间，不单独占底部）', async () => {
  const lines = [
    { kind: 'group', side: 'user', who: '你', phase: '需求', phaseKey: 'requirement', body: '第一条', time: '09:00', full: '第一条', requirementId: 'r1', device: { id: 'p-win', name: '你', isLocal: true }, assigneeLabel: 'macOS · 郭宏宇的Mac mini' },
    { kind: 'note', side: 'agent', who: 'macOS · B', phase: '队友对话', phaseKey: 'note', body: '第二条', time: '09:01', full: '第二条', device: { id: 'n1', name: 'macOS · B', isLocal: false } },
    { kind: 'group', side: 'agent', who: 'Windows · A', phase: '结果', phaseKey: 'result', body: '第三条', time: '09:02', full: '第三条', device: { id: 'p-mac', name: 'Windows · A', isLocal: false } },
  ];
  const { document, errors } = await mount({ ...BASE_STATE, lines });
  assert.deepEqual(errors, []);
  const text = [...document.querySelectorAll('#feed .bubble')].map((node: any) => node.textContent).join('|');
  const first = text.indexOf('第一条');
  const second = text.indexOf('第二条');
  const third = text.indexOf('第三条');
  assert.ok(first >= 0 && first < second && second < third, `必须按时间线顺序渲染，实际：${text}`);
  assert.ok(text.includes('队友对话'), '队友往来的标签要保留');
  assert.ok(text.includes('需求') && text.includes('结果'), '群消息的阶段标签也要保留');
  assert.ok(text.includes('@macOS · 郭宏宇的Mac mini'), '气泡上要显示这条指派给了哪台');
});

/**
 * 所有渲染分支都要能跑通。
 *
 * 「一次抛错 = 后半段 UI 全黑」是这次事故的形态（assignee 未声明）。
 * 所以这里把每种状态都渲染一遍，任何一条路径抛错都会被抓住。
 */
const STATES: Record<string, Record<string, unknown>> = {
  '完全空状态（刚开群）': {
    ...BASE_STATE,
    role: 'hub',
    peers: [BASE_STATE.peers[0]],
    projectRows: [],
    projectName: '',
    projectRepo: '',
    invite: '',
    inviteText: '',
    messages: [],
    lines: [],
    taskGroups: [],
  },
  '只有本机的单机模式': {
    ...BASE_STATE,
    role: 'off',
    peers: [BASE_STATE.peers[0]],
    canStop: false,
  },
  '带邀请码等待加入': {
    ...BASE_STATE,
    peers: [BASE_STATE.peers[0]],
    invite: 'ABC123',
    inviteText: 'hwchat://ABC123@192.168.0.2:47821',
    inviteWaiting: true,
  },
  '项目不一致告警': {
    ...BASE_STATE,
    projectMismatch: '本机 github.com/gsaecy/plaitcode；192.168.0.8 在做 github.com/gsaecy/personal-workstation-os',
  },
  '有待回答的追问': {
    ...BASE_STATE,
    openQuestion: '导出 CSV 还是 Excel？',
  },
  '有任务看板': {
    ...BASE_STATE,
    taskGroups: [
      { status: 'running', label: '进行中', tasks: [{ id: 'r1', title: '改标题栏', project: 'app', assigneeName: 'MagicBookV14', lastLine: '正在改' }] },
      { status: 'done', label: '已完成', tasks: [{ id: 'r2', title: '报数', project: 'app', assigneeName: '', lastLine: '做完了' }] },
    ],
  },
  '有完整对话与 pending': {
    ...BASE_STATE,
    messages: [
      { kind: 'group', id: 'g1', requirementId: 'r1', from: BASE_STATE.peers[1], author: 'user', phase: 'requirement', body: '报数', at: Date.now() },
      { kind: 'group', id: 'g2', requirementId: 'r1', from: BASE_STATE.peers[0], author: 'agent', phase: 'result', body: '报到：本机已就绪', at: Date.now() },
    ],
    lines: [
      { side: 'user', who: 'MagicBookV14', phase: '需求', phaseKey: 'requirement', body: '报数', time: '21:00', requirementId: 'r1' },
      { side: 'agent', who: 'macOS', phase: '结果', phaseKey: 'result', body: '报到：本机已就绪', time: '21:01', requirementId: 'r1', full: '报到：本机已就绪' },
    ],
    pending: { body: '正在发送的一句话', time: '21:02' },
  },
  '消息里缺 from（旧数据）': {
    ...BASE_STATE,
    messages: [{ kind: 'group', id: 'g9', requirementId: 'r9', author: 'user', phase: 'requirement', body: '老消息', at: Date.now() }],
    lines: [{ side: 'user', who: '未知', phase: '需求', phaseKey: 'requirement', body: '老消息', time: '20:00', requirementId: 'r9', device: { id: '', name: '', isLocal: false } }],
  },
};

for (const [label, state] of Object.entries(STATES)) {
  test(`渲染不抛错：${label}`, async () => {
    const { errors } = await mount(state);
    assert.deepEqual(errors, [], `${label} 渲染时抛错`);
  });
}

test('脚本在严格模式下也成立（隐式全局 / 未声明变量会暴露）', async () => {
  const { parseHTML } = await import('linkedom');
  const { window, document } = parseHTML(MARKUP) as any;
  const errors: string[] = [];
  window.acquireVsCodeApi = () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined });
  try {
    const run = new Function('window', 'document', 'acquireVsCodeApi', `'use strict';\n${extractPanelSource()}`);
    run(window, document, window.acquireVsCodeApi);
    const event = new window.Event('message');
    (event as any).data = { type: 'state', ...BASE_STATE };
    window.dispatchEvent(event);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  assert.deepEqual(errors, [], '严格模式下不该抛错');
});
