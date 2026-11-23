/**
 * 「手机加入团队群」窗口：给跨网络用的二维码。
 *
 * 与局域网那个「手机遥控」窗口的区别：这里的手机和电脑**不需要同一个 WiFi**，
 * 手机扫的是 `https://plaitcode.com/m#k=…`，密钥放在 fragment 里（不会发给服务器）。
 */

import * as vscode from 'vscode';
import { qrSvg } from '../sync/qr';

export class RelayPhonePanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: {
      /** 返回手机要打开的地址；没加入频道时返回 undefined。 */
      link: () => string | undefined;
    },
  ) {}

  async open(): Promise<void> {
    const link = this.callbacks.link();
    if (!link) {
      void vscode.window.showWarningMessage('还没有加入跨网频道。先执行「PlaitCode: 新建跨网频道」或「加入跨网频道」。');
      return;
    }
    if (this.panel) {
      this.panel.reveal(undefined, true);
      await this.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'plaitcode.relayPhone',
      '手机加入团队群',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.extensionUri] },
    );
    this.panel = panel;
    panel.webview.html = this.html();
    this.disposables.push(panel.webview.onDidReceiveMessage((message: unknown) => {
      const record = (message ?? {}) as { type?: unknown };
      if (record.type === 'ready') void this.refresh();
      if (record.type === 'copy') {
        const current = this.callbacks.link();
        if (!current) return;
        void vscode.env.clipboard.writeText(current).then(() => {
          void this.panel?.webview.postMessage({ type: 'toast', text: '链接已复制，可以发到手机上打开' });
        });
      }
    }));
    panel.onDidDispose(() => { this.panel = undefined; }, null, this.disposables);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.panel) return;
    const link = this.callbacks.link() ?? '';
    await this.panel.webview.postMessage({
      type: 'state',
      link,
      qr: link ? qrSvg(link, { module: 6 }) : '',
    });
  }

  private readonly disposables: vscode.Disposable[] = [];

  private html(): string {
    const nonce = [...Array(32)].map(() => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;`;
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; --muted: var(--vscode-descriptionForeground); --line: var(--vscode-panel-border, rgba(128,128,128,.25)); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .wrap { max-width: 520px; margin: 0 auto; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .lead { color: var(--muted); font-size: 12.5px; margin: 0 0 20px; line-height: 1.6; }
  .card { border: 1px solid var(--line); border-radius: 12px; padding: 20px; text-align: center; }
  #qr { display: inline-block; line-height: 0; background: #fff; padding: 10px; border-radius: 10px; }
  #qr svg { display: block; }
  .url { margin-top: 14px; font-size: 11.5px; color: var(--muted); word-break: break-all; }
  .row { display: flex; gap: 10px; margin-top: 16px; }
  button { flex: 1; padding: 8px 12px; border-radius: 7px; cursor: pointer; font-size: 12.5px;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid transparent; }
  button.ghost { color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.16)); }
  .note { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; line-height: 1.7; }
  .toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 12px; opacity: 0; transition: opacity .2s; }
  .toast.on { opacity: 1; }
</style></head>
<body><div class="wrap">
  <h1>手机加入团队群</h1>
  <p class="lead">手机和电脑**不需要同一个 WiFi**。用手机相机扫下面的码，就会打开团队群；消息端到端加密，服务器只看到密文。</p>
  <div class="card">
    <div id="qr"></div>
    <div class="url" id="url"></div>
    <div class="row"><button id="copy">复制链接</button></div>
  </div>
  <div class="note">
    · 扫码后浏览器会记住这台手机，下次打开页面直接进入；<br>
    · 链接里的 <code>#k=…</code> 是频道钥匙，<b>不要发给别人</b>（等于让别人也能指挥你的电脑）；<br>
    · 手机打不开就先确认它能访问 <code>plaitcode.com</code>（部分公司 WiFi 会拦）。
  </div>
  <div class="toast" id="toast"></div>
</div>
<script nonce="${nonce}">
(function () {
  var api = acquireVsCodeApi();
  var qr = document.getElementById('qr');
  var url = document.getElementById('url');
  var toast = document.getElementById('toast');
  function say(text) { toast.textContent = text; toast.className = 'toast on'; setTimeout(function () { toast.className = 'toast'; }, 2400); }
  document.getElementById('copy').onclick = function () { api.postMessage({ type: 'copy' }); };
  window.addEventListener('message', function (event) {
    var message = event.data || {};
    if (message.type === 'state') { qr.innerHTML = message.qr || ''; url.textContent = message.link || ''; }
    if (message.type === 'toast') say(message.text || '');
  });
  api.postMessage({ type: 'ready' });
})();
</script>
</body></html>`;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.panel?.dispose();
    this.panel = undefined;
  }
}
