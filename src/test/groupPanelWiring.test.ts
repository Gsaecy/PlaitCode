import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GroupPanel } from '../views/groupPanel';
import { Uri } from './support/vscodeMock';

/**
 * 群窗口**不会白屏**的接线验证（用户 2026-11-25 追问：「为什么窗口可能一片空白？你不修复？」）。
 *
 * 我把「可能白屏」当成必须自己排除的风险，而不是让用户去试。白屏只有三种成因，
 * 这里逐条用真实代码验：
 *   1. 脚本加载不到（路径 / localResourceRoots）；
 *   2. CSP 拦掉脚本（nonce 不匹配，或脚本没有 nonce）；
 *   3. 脚本找不到它要的 DOM 节点（一抛错，后面的渲染全停 —— 就是「由谁执行」空掉那类）。
 *
 * 第 1、2 条直接跑 `GroupPanel.html()` 生成**真实 HTML** 再检查；第 3 条把脚本里
 * `el('x')` / `getElementById('x')` 要的 id 与真实 HTML 里的 id 做集合比对。
 */

const PANEL_SOURCE = readFileSync('src/views/groupPanel.ts', 'utf8');
const GROUP_SCRIPT = readFileSync('media/group.js', 'utf8');

/** 复刻 `mediaUri()` 的返回形态：`toString()` 出最终地址，`with({query})` 带版本戳。 */
function fakeWebview(): { cspSource: string; asWebviewUri: (uri: unknown) => unknown } {
  const toUrl = (fsPath: string, query?: string): string => `https://file+.vscode-resource.vscode-cdn.net${fsPath}${query ? `?${query}` : ''}`;
  return {
    cspSource: 'https://*.vscode-cdn.net',
    asWebviewUri: (uri: any) => ({
      toString: () => toUrl(uri.fsPath),
      with: (change: any) => ({ toString: () => toUrl(uri.fsPath, change?.query) }),
    }),
  };
}

/** 调真实的 `html()`（它只依赖 `this.extensionUri`，所以可以拿一个只有它的 this 调）。 */
function buildHtml(): string {
  const call = (GroupPanel.prototype as unknown as { html(webview: unknown): string }).html;
  return call.call({ extensionUri: Uri.file('/ext') }, fakeWebview());
}

test('脚本地址来自本地 resource root（否则 webview 直接加载失败 → 白屏）', () => {
  const html = buildHtml();
  const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]).join('\n');
  // 地址形如 https://file+.vscode-resource.vscode-cdn.net<盘符>/ext/media/group.js?v=<版本>
  // 分隔符两种都认：真机 VS Code 给正斜杠，测试替身 `joinPath` 在 Windows 上给反斜杠。
  assert.match(html, /src="https:\/\/file\+\.vscode-resource[^"]*media[\\/]group\.js\?v=[^"]+"/,
    `必须按媒体地址加载 media/group.js，并带上版本戳（避免旧脚本被缓存）。实际：\n${tags}`);
  assert.match(html, /src="https:\/\/file\+\.vscode-resource[^"]*media[\\/]richtext\.js\?v=[^"]+"/, '富文本脚本同理');
  // localResourceRoots 里必须有 extensionUri，否则上面这个地址会被拦。
  assert.match(PANEL_SOURCE, /localResourceRoots: \[this\.extensionUri, \.\.\.\(assetRoot \? \[assetRoot\] : \[\]\)\]/);
});

test('CSP 与每一个 <script> 的 nonce 完全一致（对不上就是整页脚本都不执行）', () => {
  const html = buildHtml();
  const csp = html.match(/script-src 'nonce-([^']+)'/);
  assert.ok(csp, 'CSP 里必须有 script-src nonce');
  const nonce = csp[1]!;
  const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(tags.length >= 2, `至少两个脚本（richtext + group），实际 ${tags.length}`);
  for (const tag of tags) {
    assert.match(tag, new RegExp(`nonce="${nonce}"`), `这个 <script> 的 nonce 与 CSP 不一致：${tag}`);
  }
  // 外部脚本也要带 nonce（CSP3 允许 nonce 作用于外链脚本；chat.js 等一直这么写）。
  for (const tag of tags) {
    assert.match(tag, /\ssrc="/, `群窗口不该再有内联逻辑脚本：${tag}`);
  }
});

test('脚本要的每个 DOM 节点都真的在 HTML 里（缺一个就抛错，后面的渲染全停）', () => {
  const html = buildHtml();
  const defined = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  const needed = new Set<string>();
  for (const match of GROUP_SCRIPT.matchAll(/\bel\('([^']+)'\)/g)) needed.add(match[1]!);
  for (const match of GROUP_SCRIPT.matchAll(/getElementById\('([^']+)'\)/g)) needed.add(match[1]!);

  const missing = [...needed].filter((id) => !defined.has(id));
  assert.deepEqual(missing, [], `脚本会去找这些节点，但 HTML 里没有：${missing.join('、')}`);
  assert.ok(needed.size > 5, `应当从脚本里读出多个节点需求，实际 ${needed.size}`);
});

test('state 消息的形状两侧一致：宿主**扁平**发、脚本**扁平**读（嵌套就是白屏）', () => {
  /*
   * 现场的坑：`chat.js` 读的是 `message.state`（嵌套），而群窗口脚本读的是 `event.data`（扁平）。
   * 宿主现在两边都对，但这条约定没有任何东西守着 —— 谁改一侧就是「窗口一片空白」。
   * 真浏览器验证时我正是因为按嵌套发了一条 state，脚本当场
   * `Cannot read properties of undefined (reading 'map')`（`state.peers` 为 undefined）。
   */
  assert.match(PANEL_SOURCE, /postMessage\(\{\s*\n\s*type: 'state',\s*\n\s*\/\* 本机设备 id/, '宿主要把字段摊在顶层发');
  assert.doesNotMatch(PANEL_SOURCE, /type: 'state',\s*\n\s*state: /, '不许改成嵌套（脚本不认）');
  assert.match(GROUP_SCRIPT, /if \(data\.type === 'state'\) render\(data\);/, '脚本读的是扁平对象');
  assert.doesNotMatch(GROUP_SCRIPT, /render\(data\.state\)/, '脚本没有嵌套分支');
});

test('脚本自己不做模板求值：文件里的转义就是运行时的那份', () => {
  /*
   * 搬出内联模板时踩过一次：模板字符串里的 `\\[` 到运行时才变成 `\[`，
   * 直接搬运会让正则收到两个反斜杠 —— 脚本启动第一行就抛
   * `Invalid regular expression: Unmatched ')'`，整页白屏。
   * 这里守住「文件里没有模板残留转义」：JS 文件里合法的 `\\` 只在正则/字符串要匹配
   * 反斜杠时出现，数量应当极少。
   */
  const doubleBackslashes = (GROUP_SCRIPT.match(/\\\\/g) ?? []).length;
  assert.ok(doubleBackslashes <= 4, `疑似残留模板转义（${doubleBackslashes} 处）`);
});
