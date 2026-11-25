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
 * 这里从构建产物里抽出群窗口的内嵌脚本，在真实 DOM 里执行，
 * 然后像 webview 一样派发 state 消息，检查：
 *   1. 脚本不抛错（抛错会让后面的渲染全停，正是「由谁执行」空掉的原因）；
 *   2. 「由谁执行」真的画出设备按钮；
 *   3. 打字后发送真的发出去，前缀不会把正文吃掉。
 */

const BUNDLE = readFileSync('out/extension.js', 'utf8');

function extractPanelSource(): string {
  // 锚点用「脚本自己发的 ready」——它一定在群窗口那段内嵌脚本里，
  // 而且不像监听器那一行容易被改写（改成多行后旧锚点就找不到了）。
  const anchor = BUNDLE.indexOf("vscode.postMessage({ type: 'ready' });");
  assert.ok(anchor > 0, '没找到群窗口脚本锚点');
  const open = BUNDLE.lastIndexOf('<script', anchor);
  const close = BUNDLE.indexOf('</script>', anchor);
  const raw = BUNDLE.slice(BUNDLE.indexOf('>', open) + 1, close);
  /*
   * 这段脚本在 `html()` 里是**模板字符串**的一部分，真实 webview 拿到的是**求值后**的文本：
   * 模板里的 `\\s` 会变成 `\s`、`\u4E00` 会变成汉字。
   * 这里用同样的方式求值一次，否则测试跑的是未求值的源码，正则行为会和真机不一致
   * （这个文件禁止反引号，所以包一层模板是安全的）。
   */
  // eslint-disable-next-line no-new-func
  return new Function(`return \`${raw}\`;`)() as string;
}

const MARKUP = `<!DOCTYPE html><html><body>
  <span id="status"></span><div id="sub"></div><div id="peek"></div>
  <div id="moreBtn"></div><div id="drawer" style="display:none"></div>
  <div id="members"></div><div id="banner"><b id="bannerWho">乙方在等你回答</b><button id="bannerClose"></button><span id="bannerText"></span><div id="bannerOpts"></div><div id="bannerHint"></div></div>
  <div id="versionWarn" style="display:none"></div>
  <div id="projectWarn" style="display:none"></div>
  <div id="projectRows"></div><div id="projectBox" style="display:none"></div>
  <div id="invite" style="display:none"><div id="inviteCode"></div><div id="inviteHow"></div>
    <button id="copyInvite"></button><button id="copyInviteInline"></button><div id="inviteToggle"></div></div>
  <div id="board" style="display:none"><div class="board-head" id="boardHead"><b>任务看板</b><span id="boardHint"></span></div><div id="boardCols"></div></div>
  <main id="feed"></main>
  <div id="assign"></div><div id="mention" style="display:none"></div>
  <textarea id="text"></textarea><button id="send"></button>
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
