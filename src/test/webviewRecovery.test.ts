import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConversationStorage } from '../core/storage';
import { ChatPanel } from '../views/chatPanel';
import { executedCommands, Uri } from './support/vscodeMock';

/**
 * 用户 2026-11-26（贴图）：「hwchat 界面又崩溃不显示了」——右侧对话框整片白，
 * 同一个扩展里的团队群窗口正常。
 *
 * 现场日志给出的关键事实：日志里有 `[sync] …进入阶段…`（说明扩展在跑、版本是新的），
 * 但**一条 `[webview] 开始解析…` 都没有** —— 也就是 VS Code 根本没有调
 * `resolveWebviewView`，屏幕上的视图是从上一次扩展宿主里留下来的一块空白。
 *
 * 这解释了两件事：
 *  1. 看门狗（armWebviewWatchdog）只在 `resolveWebviewView` 里装，所以它根本没生效；
 *  2. 「HWChat: 重新加载界面」在没有视图句柄时直接 return，唯一的自救命令也失效。
 *
 * 下面把这两条都钉在可执行层面：**没有视图句柄时，重载界面必须先去把视图叫出来**。
 */

async function makePanel(): Promise<{ panel: ChatPanel; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-webview-'));
  const storage = new ConversationStorage(dir);
  await storage.initialize();
  /*
   * SkillRegistry 的替身用 Proxy：这个用例只关心「HTML 有没有被赋上」，
   * 不该因为某个 skill 方法没实现就失败（那会把测试变成「替身完备性检查」）。
   */
  const skills = new Proxy({
    sharedActiveIds: () => [],
    list: () => [],
    hasScanned: true,
    onDidChangeSharedState: { event: () => ({ dispose() { /* noop */ } }) },
    onDidChangeSkills: { event: () => ({ dispose() { /* noop */ } }) },
  } as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      // 数组型返回值也常见（技能清单 / 路由 id），一律给空数组更安全。
      return () => [];
    },
  });
  /** 工具执行器的替身：只为让 resolve 流程跑通，不真正执行任何工具。 */
  const toolExecutor = new Proxy({
    definitions: () => [],
    dispose: () => undefined,
    isWorkspaceTrusted: () => true,
  } as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      return () => undefined;
    },
  }) as never;

  const extensionUri = Uri.file(join(process.cwd(), 'extension-root'));
  const secrets = {
    async get() { return undefined; },
    async store() { return undefined; },
    async delete() { return undefined; },
    onDidChange: () => ({ dispose() { /* noop */ } }),
  };
  const panel = new ChatPanel(
    extensionUri as never,
    Uri.file(join(dir, 'attachments')) as never,
    storage as never,
    {} as never,
    secrets as never,
    skills as never,
    toolExecutor as never,
    {} as never,
  );
  return { panel, dir };
}

test('没有视图句柄时，「重新加载界面」必须先聚焦视图把它叫出来', async () => {
  const { panel, dir } = await makePanel();
  try {
    assert.equal(panel.hasWebview(), false, '一开始确实没有视图句柄（这就是白屏那种状态）');
    const before = executedCommands.length;
    panel.reloadWebview('manual');
    // 聚焦是异步发起的，给它一拍。
    await new Promise((resolve) => setTimeout(resolve, 120));
    const issued = executedCommands.slice(before).map((item) => item.id);
    assert.ok(issued.includes('workbench.view.extension.hwchat'), `要聚焦 HWChat 容器（实际：${issued.join(',')}）`);
    assert.ok(
      issued.some((id) => id.endsWith('.focus')),
      '还要聚焦具体视图 —— 只有聚焦才会让 VS Code 重新调 resolveWebviewView',
    );
    // 叫不出来时也要有明确回执（不能静默失败，用户否则只能重载窗口）。
    assert.equal(await panel.waitForWebview(300), false);
  } finally {
    panel.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('视图解析后：HTML 真的被赋上，且带「界面没加载成功」的兜底层', async () => {
  const { panel, dir } = await makePanel();
  try {
    const html: string[] = [];
    const fakeView = {
      visible: true,
      onDidDispose: () => ({ dispose() { /* noop */ } }),
      onDidChangeVisibility: () => ({ dispose() { /* noop */ } }),
      webview: {
        options: {} as never,
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: { toString(): string }) => uri,
        onDidReceiveMessage: () => ({ dispose() { /* noop */ } }),
        set html(value: string) { html.push(value); },
        get html() { return html.at(-1) ?? ''; },
      },
    };
    panel.resolveWebviewView(fakeView as never);
    assert.equal(panel.hasWebview(), true, '解析后要拿到句柄');
    assert.ok(html.length > 0, '必须真的把 HTML 赋给 webview（否则就是白屏）');
    const assigned = html.at(-1)!;
    assert.ok(assigned.length > 10_000, '界面 HTML 不该是空的');
    /*
     * 兜底层：脚本没起来时屏幕上要有**可读的说明**，而不是纯白。
     * 它必须不依赖任何外部脚本，并且明确告诉用户运行哪条命令。
     */
    assert.match(assigned, /id="bootFallback"/, '要带静态兜底层');
    assert.match(assigned, /HWChat: 重新加载界面/, '要告诉用户运行哪条命令');
    assert.match(assigned, /chat\.js/, '正常启动时由 chat.js 移除兜底层');
  } finally {
    panel.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('chat.js 启动成功时会把兜底层收起来（否则正常界面会被它盖住）', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync('media/chat.js', 'utf8');
  const boot = js.indexOf("post('ready')");
  assert.ok(boot > 0, 'chat.js 要在启动完成时报 ready');
  const snippet = js.slice(Math.max(0, boot - 700), boot);
  assert.match(snippet, /getElementById\('bootFallback'\)/, '启动成功要移除兜底层');
});

test('切回视图时如果界面还没就绪，要重赋 HTML（只推状态等于往空文档里发消息）', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/views/chatPanel.ts', 'utf8');
  const start = source.indexOf('onDidChangeVisibility?.(');
  assert.ok(start > 0);
  const body = source.slice(start, start + 900);
  assert.match(body, /webviewHealthVerdict/, '要用健康度判定「还没就绪」');
  assert.match(body, /assignWebviewHtml\('visible-again'\)/, '未就绪时重赋 HTML，而不是只补推状态');
});

/**
 * 用户 2026-11-26 亲口纠正：「我装完 0.4.32 刚开始界面是好的、正常的，后面才变成空白的。」
 *
 * 她说得对。日志时间线：09:04:01 宿主 A → 09:04:07 终止 → 09:04:08 宿主 B →
 * 09:04:27 `HWChat activated.`，而宿主 B 里**没有任何 `[webview] 开始解析`**。
 * 也就是说那块「看起来正常」的面板是**宿主 A 留下的 iframe**：
 * 渲染还在，但已经和新宿主断开（状态永远停在旧画面）；等 VS Code 回收掉它，就只剩空白。
 */
test('宿主重启后视图是残留的：要在激活后主动重新解析（用户不会知道去点命令）', async () => {
  const { shouldHealStaleView, STALE_VIEW_CHECK_DELAY_MS, STALE_VIEW_MAX_HEALS } = await import('../views/webviewHealth.js');
  // 上次打开过、这次没句柄 → 必须自救，直到用完额度。
  assert.equal(shouldHealStaleView({ wasOpen: true, hasView: false, attempts: 0 }), true);
  assert.equal(shouldHealStaleView({ wasOpen: true, hasView: false, attempts: STALE_VIEW_MAX_HEALS - 1 }), true);
  assert.equal(shouldHealStaleView({ wasOpen: true, hasView: false, attempts: STALE_VIEW_MAX_HEALS }), false, '额度用完就停，别反复抢焦点');
  // 这次已经拿到句柄（VS Code 正常解析了）→ 不动它，绝不能平白重载界面。
  assert.equal(shouldHealStaleView({ wasOpen: true, hasView: true, attempts: 0 }), false);
  // 上次根本没打开过 → 不要凭空把面板拉出来。
  assert.equal(shouldHealStaleView({ wasOpen: false, hasView: false, attempts: 0 }), false);
  assert.ok(STALE_VIEW_CHECK_DELAY_MS > 0 && STALE_VIEW_CHECK_DELAY_MS < 10_000);

  // 接线要在：激活时记标记、检查后调 reloadWebview。
  const { readFileSync } = await import('node:fs');
  const ext = readFileSync('src/extension.ts', 'utf8');
  assert.match(ext, /workspaceState\.update\(VIEW_OPENED_KEY, true\)/, '解析时要记住「打开过」');
  assert.match(ext, /shouldHealStaleView\(\{[\s\S]{0,200}hasView: chat\.hasWebview\(\)/s, '检查要真的看这次有没有句柄');
  assert.match(ext, /chat\.reloadWebview\('stale-after-restart'\)/, '没有句柄就主动重新解析 + 重赋 HTML');
});
