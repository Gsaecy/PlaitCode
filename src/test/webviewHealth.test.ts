import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationStorage } from '../core/storage';
import { ChatPanel } from '../views/chatPanel';
import {
  WEBVIEW_MAX_RECOVERIES,
  WEBVIEW_READY_TIMEOUT_MS,
  freshWebviewHealth,
  markHtmlSet,
  markManualReload,
  markReady,
  markRecovered,
  webviewHealthVerdict,
} from '../views/webviewHealth';

/*
 * 2026-11-26：对话框和设置界面同时变成一片空白，而团队群窗口（另一个 webview）正常。
 * 查证结论是界面代码本身没问题（真实 HTML 放进 Chromium 能完整渲染），
 * 是 webview 没拿到内容 —— 这种情况唯一确定有效的修法就是重新赋值 `webview.html`。
 * 下面把「什么时候该重赋」和「面板真的会重赋」都钉在可执行的层面。
 */

test('看门狗判定：报过 ready 就不再重赋', () => {
  const set = markHtmlSet(freshWebviewHealth(), 1_000);
  assert.equal(webviewHealthVerdict(set, 2_000), 'waiting', '刚赋完，还在等');
  const ready = markReady(set, 1_500);
  assert.equal(webviewHealthVerdict(ready, 1_600), 'ready');
  assert.equal(
    webviewHealthVerdict(ready, 1_000 + WEBVIEW_READY_TIMEOUT_MS * 10),
    'ready',
    'ready 过之后多久都不该再重赋（否则每次操作都白重建一次界面）',
  );
});

test('看门狗判定：超时没 ready 就重赋，额度用完就不再刷', () => {
  let health = markHtmlSet(freshWebviewHealth(), 1_000);
  assert.equal(webviewHealthVerdict(health, 1_000 + WEBVIEW_READY_TIMEOUT_MS - 1), 'waiting');

  health = markRecovered(health, 1_000 + WEBVIEW_READY_TIMEOUT_MS);
  assert.equal(health.recoveries, 1);
  assert.equal(health.readyAt, 0, '重赋之后要重新等 ready');
  assert.equal(
    webviewHealthVerdict(health, 1_000 + WEBVIEW_READY_TIMEOUT_MS + 100),
    'waiting',
    '刚重赋完要给足时间',
  );

  health = markRecovered(health, 100_000);
  assert.equal(health.recoveries, 2);
  assert.equal(
    webviewHealthVerdict(health, 200_000),
    'give-up',
    `连续 ${WEBVIEW_MAX_RECOVERIES} 次都不行就不是「没拿到内容」了，别再无谓重刷`,
  );
});

test('手动重载把额度重新给满（人明确要求了，不该被自动额度挡住）', () => {
  let health = freshWebviewHealth();
  health = markRecovered(markRecovered(markHtmlSet(health, 1), 2), 3);
  assert.equal(webviewHealthVerdict(health, 1_000_000), 'give-up');
  health = markManualReload(health, 2_000_000);
  assert.equal(health.recoveries, 0);
  assert.equal(webviewHealthVerdict(health, 2_000_000 + WEBVIEW_READY_TIMEOUT_MS), 'recover');
});

/** 面板真的会把 html 重新赋一遍（这是白屏的唯一确定修法）。 */
test('ChatPanel.reloadWebview()：真的重赋 html 并重推状态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hwchat-reload-'));
  try {
    const storage = new ConversationStorage(root);
    await storage.initialize();
    const skills = {
      sharedActiveIds: () => [],
      list: () => [],
      onDidChangeSharedState: { event: () => ({ dispose() { /* noop */ } }) },
      onDidChangeSkills: { event: () => ({ dispose() { /* noop */ } }) },
    };
    const secrets = { get: async () => undefined, store: async () => undefined, delete: async () => undefined, onDidChange: () => ({ dispose() { /* noop */ } }) };
    const extensionUri = { fsPath: process.cwd(), scheme: 'file', path: process.cwd() };
    const panel = new ChatPanel(
      extensionUri as never, extensionUri as never, storage as never, {} as never, secrets as never,
      skills as never, {} as never, {} as never,
    );
    const posts: unknown[] = [];
    const view = {
      visible: true,
      webview: {
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: { fsPath?: string }) => ({ toString: () => `https://file+.vscode-resource${uri?.fsPath ?? ''}`, with: () => ({ toString: () => 'x' }) }),
        options: {},
        html: '',
        onDidReceiveMessage: () => ({ dispose() { /* noop */ } }),
        postMessage: async (message: unknown) => { posts.push(message); return true; },
      },
      onDidDispose: () => ({ dispose() { /* noop */ } }),
      onDidChangeVisibility: () => ({ dispose() { /* noop */ } }),
    };
    void posts;
    // `html` 是 VS Code 的读写属性，替身里要能同时读回「被赋过」这件事。
    Object.defineProperty(view.webview, 'html', {
      value: '',
      writable: true,
      configurable: true,
    });
    /*
     * 状态推送要真的走一遍（它是「重载后界面是空的」的修复点），但不必真去渲染整份状态：
     * 这里只数它有没有被再推一次。首次解析也会推一次，所以用增量判断。
     */
    let pushes = 0;
    (panel as unknown as { sendState: () => Promise<void> }).sendState = async () => { pushes += 1; };
    (panel as unknown as { resolveWebviewView: (v: unknown) => void }).resolveWebviewView(view);

    const html = (view.webview as unknown as { html: string }).html;
    assert.match(html, /<div id="app"/, '首次解析就该把界面 HTML 赋上去');
    const first = html;
    const pushesAfterResolve = pushes;

    // 用户点「重新加载界面」：html 必须重新赋一次（iframe 才会整个重建）。
    (view.webview as unknown as { html: string }).html = '';
    panel.reloadWebview('manual');
    const second = (view.webview as unknown as { html: string }).html;
    assert.match(second, /<div id="app"/);
    assert.notEqual(second, first, '重建要拿到一份新的 HTML（nonce 每次不同）');
    assert.ok(pushes > pushesAfterResolve, '重载后要重新推一次状态，否则界面是空的');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
