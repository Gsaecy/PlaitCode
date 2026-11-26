import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { renderMobilePage } from '../sync/mobileControl';
import { renderAuthResultPage, renderConsolePage, renderLandingPage } from '../sync/relaySite';
import { renderRelayMobilePage } from '../sync/relayPage';
import { SERVICE_WORKER_JS, renderManifest } from '../sync/relayPwa';
import { MobilePanel } from '../views/mobilePanel';

/**
 * 「页面里的内联脚本到底能不能跑」——把它**解析**一遍，而不是读源码猜。
 *
 * 现场（用户 2026-11-25）：「手机遥控，扫码输入验证码，点击进入团队群，没有任何反应」。
 * 根因：页面 HTML 是 TS 模板字符串，里面一处 `'\n'` 在求值时变成**真换行**，
 * 把嵌进去的 JS 字符串劈成两半 → 整段 `SyntaxError` → 脚本一个字都没执行 →
 * 点击退化成原生表单提交，页面重载回登录页，看着就是「没反应」。
 *
 * 这类 bug 有两个共同点，所以一条通用用例就能一次性守住：
 *   1. 症状只在浏览器里出现（`tsc` 全绿、源码断言也全绿）；
 *   2. 判定只需**解析一次**（`new vm.Script`）。
 *
 * 所以这里把所有会拼进浏览器的脚本都拿出来解析：
 * 面板生成的内联脚本、`media/*.js`、service worker。
 */

/** 取出 HTML 里每一段内联 `<script>`（没有 src 的）。 */
function inlineScripts(html: string): string[] {
  const scripts: string[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? '';
    if (/\bsrc\s*=/.test(attributes)) continue;
    scripts.push(match[2] ?? '');
  }
  return scripts;
}

/** 解析失败时把出错行号与那一行原文带出来（否则只知道「有语法错」）。 */
function assertParses(code: string, label: string): void {
  try {
    new vm.Script(code, { filename: label });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? '') : '';
    assert.fail(`${label} 的内联脚本有语法错误：${message}\n${stack}`);
  }
}

test('手机遥控页面：登录态与已登录态的内联脚本都能解析', () => {
  for (const authed of [false, true]) {
    const html = renderMobilePage({ device: 'PC · Windows', authed, canApprove: true });
    const scripts = inlineScripts(html);
    assert.equal(scripts.length, 1, `authed=${authed} 应当只有一段内联脚本，实际 ${scripts.length}`);
    assertParses(scripts[0]!, `mobile(authed=${authed})`);
    // 登录页必须有表单与提交按钮，否则「点进去」这件事本身就不成立。
    if (!authed) {
      assert.match(html, /id="login"/);
      assert.match(html, /进入团队群/);
    }
  }
});

test('手机遥控页面：脚本里的换行转义是「两个字符」，不是真换行', () => {
  /*
   * 这是那次事故的最小判据：`approval.detail` 拼接必须写成 `'\\n'`（源码里两个反斜杠），
   * 送进浏览器的文本里是 `'\n'`（反斜杠 + n）。真换行会让字符串在行尾断掉。
   */
  const html = renderMobilePage({ device: 'PC', authed: true, canApprove: true });
  assert.match(html, /approval\.detail \? '\\n' \+ approval\.detail/, "拼接换行必须是 '\\\\n'");
  assert.doesNotMatch(html, /approval\.detail \? '\n/, '不许出现真换行把字符串劈开');
});

test('手机遥控面板（电脑端窗口）：内联脚本能解析，且带打开/复制的入口', () => {
  const html = (MobilePanel.prototype as unknown as { html(): string }).html.call({});
  const scripts = inlineScripts(html);
  assert.equal(scripts.length, 1);
  assertParses(scripts[0]!, 'mobilePanel');
  assert.match(html, /手机遥控/, '要有标题');
});

test('跨网中继的页面与 service worker：内联脚本都能解析', () => {
  const pages: Array<[string, string]> = [
    ['relayMobile', renderRelayMobilePage({ relayHost: 'https://relay.example.com' })],
    ['relayMobile(auth)', renderRelayMobilePage({ relayHost: 'https://relay.example.com', sessionAuth: true, loginPath: '/login', loginLabel: '登录' })],
    ['console', renderConsolePage({ relayHost: 'https://relay.example.com', sessionAuth: true })],
    ['authResult', renderAuthResultPage({ ok: true, title: '完成', body: '可以关掉这个页面了' })],
    ['landing', renderLandingPage({
      relayHost: 'https://relay.example.com',
      consoleEnabled: true,
      installUrl: 'https://example.com/hwchat.vsix',
      repoUrl: 'https://github.com/example/hwchat',
    })],
  ];
  for (const [label, html] of pages) {
    const scripts = inlineScripts(html);
    // 授权结果页是纯静态的（没有脚本），其余页面都应当带内联脚本。
    if (label !== 'authResult') assert.ok(scripts.length >= 1, `${label} 应当有内联脚本`);
    scripts.forEach((code, index) => assertParses(code, `${label}#${index}`));
  }
  assertParses(SERVICE_WORKER_JS, 'serviceWorker');
  // manifest 是 JSON：顺手确认它是合法 JSON（拼错一个逗号，PWA 就装不上）。
  assert.doesNotThrow(() => JSON.parse(renderManifest()));
});

test('media/*.js 全部能被解析（含群窗口那份，防止模板转义把正则弄坏）', () => {
  /*
   * 同一类事故此前也在群窗口脚本上发生过：从内联模板搬成真文件时把 `\\[` 原样搬过去，
   * 正则收到两个反斜杠 → 脚本启动即抛 `Invalid regular expression`。
   */
  const files = readdirSync('media').filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 10, `media 下的脚本数量异常：${files.length}`);
  for (const file of files) {
    const code = readFileSync(`media/${file}`, 'utf8');
    assertParses(code, file);
  }
});
