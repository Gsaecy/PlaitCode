/**
 * 语音输入的「真实浏览器」桥。
 *
 * 为什么需要它（用户 2026-11-25 实况：点麦克风只弹「语音输入失败: not-allowed」）：
 * VS Code 的 webview 是受限 iframe，宿主没有给它 `microphone` 权限，也没有任何扩展 API
 * 能申请 —— 所以 `webkitSpeechRecognition.start()` 必然以 `not-allowed` 失败。
 * 「在 webview 里做语音输入」这件事本身就不成立，不是代码写错了。
 *
 * 可行做法：把录制放到**用户自己的默认浏览器**里（那里网页可以正常申请麦克风，
 * Chromium / Safari 都自带语音识别），识别结果通过一个只监听 127.0.0.1 的一次性
 * 地址回传给扩展，再插进输入框。全程不出本机，也不需要任何 API key。
 *
 * 安全边界：
 *  - 只监听 `127.0.0.1`（不对外网卡开放）；
 *  - 一次性随机 token，校验不过一律 403；
 *  - 只收纯文本（不收音频），正文上限 4 000 字；
 *  - 默认 10 分钟自动关闭（`dispose()` 可提前关）。
 */

import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

export interface VoiceBridge {
  /** 一次性地址：把它交给系统浏览器打开。 */
  url: string;
  /** 已经收到至少一句识别结果。 */
  readonly received: boolean;
  dispose(): void;
}

export interface VoiceBridgeOptions {
  /** 收到一句识别结果（已 trim、已截断）。 */
  onText: (text: string) => void;
  log?: (line: string) => void;
  ttlMs?: number;
  /** 界面语言，决定页面用中文还是英文。 */
  language?: 'zh' | 'en';
}

const MAX_TEXT_CHARS = 4_000;
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TTL_MS = 10 * 60_000;

/** 起一个只给本机浏览器用的语音页。 */
export async function startVoiceBridge(options: VoiceBridgeOptions): Promise<VoiceBridge> {
  const token = randomBytes(18).toString('hex');
  let received = false;
  let server: Server | undefined;

  const html = renderVoicePage(token, options.language ?? 'zh');

  const handler = async (request: { method?: string; url?: string; on: (event: string, cb: (chunk?: Buffer) => void) => void }, response: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string) => void;
  }): Promise<void> => {
    const url = request.url || '/';
    if (request.method === 'GET') {
      const parsed = new URL(url, 'http://127.0.0.1');
      if (parsed.pathname !== '/' || parsed.searchParams.get('t') !== token) {
        response.statusCode = 403;
        response.setHeader('content-type', 'text/plain; charset=utf-8');
        response.end('链接已失效，请在 VS Code 里重新点一次语音输入。');
        return;
      }
      response.statusCode = 200;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      // 页面自带内联脚本，不需要外部资源；禁止被嵌入、禁止缓存。
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-frame-options', 'DENY');
      response.end(html);
      return;
    }
    if (request.method === 'POST' && url.startsWith('/text')) {
      let size = 0;
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        request.on('data', (chunk?: Buffer) => {
          if (!chunk) return;
          size += chunk.length;
          if (size > MAX_BODY_BYTES) { resolve(); return; }
          chunks.push(chunk);
        });
        request.on('end', () => resolve());
        request.on('error', () => resolve());
      });
      let payload: { t?: unknown; text?: unknown } = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { t?: unknown; text?: unknown };
      } catch {
        payload = {};
      }
      if (payload.t !== token) {
        response.statusCode = 403;
        response.setHeader('content-type', 'text/plain; charset=utf-8');
        response.end('token invalid');
        return;
      }
      const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, MAX_TEXT_CHARS) : '';
      response.statusCode = text ? 200 : 400;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end(text ? 'ok' : 'empty');
      if (text) {
        received = true;
        options.onText(text);
      }
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  };

  server = createServer((request, response) => { void handler(request as never, response as never); });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const timer = setTimeout(() => { options.log?.('[voice] 语音页超时关闭'); close(); }, ttlMs);

  function close(): void {
    clearTimeout(timer);
    try { server?.close(); } catch { /* 已关闭 */ }
    server = undefined;
  }

  return {
    url: `http://127.0.0.1:${port}/?t=${token}`,
    get received(): boolean { return received; },
    dispose: close,
  };
}

/**
 * 页面本身：一个按钮、一段可编辑的识别结果、一个「发送到 VS Code」。
 *
 * 用 `webkitSpeechRecognition` 而不是自己做音频上传：浏览器自带的识别不走我们的服务器，
 * 也不用任何 key；浏览器不支持时明确告诉用户改用系统听写，而不是给一个点了没反应的按钮。
 */
export function renderVoicePage(token: string, language: 'zh' | 'en'): string {
  const zh = language !== 'en';
  const text = {
    title: zh ? 'HWChat 语音输入' : 'HWChat voice input',
    hint: zh
      ? '点一下麦克风开始说，说完点「发送到 VS Code」。识别结果可以在这里先改。'
      : 'Tap the microphone, speak, then press “Send to VS Code”. You can edit the text first.',
    start: zh ? '开始说话' : 'Start speaking',
    stop: zh ? '停止' : 'Stop',
    send: zh ? '发送到 VS Code' : 'Send to VS Code',
    sent: zh ? '已发送，可以关掉这个页面了。' : 'Sent. You can close this page now.',
    empty: zh ? '还没有识别到文字。' : 'Nothing recognised yet.',
    noSupport: zh
      ? '这个浏览器不支持网页语音识别。请换用 Edge / Chrome / Safari，或直接用系统听写（Windows：Win+H；macOS：连按两下麦克风键）。'
      : 'This browser does not support web speech recognition. Use Edge / Chrome / Safari, or system dictation (Windows: Win+H; macOS: press the microphone key twice).',
    failed: zh ? '识别失败：' : 'Recognition failed: ',
  };
  const payload = JSON.stringify({ token, text }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text.title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.6 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         margin: 0; padding: 28px 20px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
  h1 { font-size: 18px; margin: 0; }
  p { max-width: 560px; margin: 0; opacity: .75; text-align: center; }
  button { font: inherit; border-radius: 10px; border: 1px solid rgba(128,128,128,.5); background: transparent;
           color: inherit; padding: 10px 18px; cursor: pointer; }
  button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
  button.mic { width: 88px; height: 88px; border-radius: 50%; font-size: 30px; }
  button.mic.live { background: #d93a3a; border-color: #d93a3a; color: #fff; }
  textarea { width: min(560px, 92vw); min-height: 120px; font: inherit; padding: 10px 12px; border-radius: 10px;
             border: 1px solid rgba(128,128,128,.5); background: transparent; color: inherit; resize: vertical; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .status { min-height: 1.4em; font-size: 13px; opacity: .8; }
</style></head>
<body>
  <h1>${text.title}</h1>
  <p>${text.hint}</p>
  <button id="mic" class="mic" type="button" title="${text.start}">🎙</button>
  <div class="status" id="status"></div>
  <textarea id="out" spellcheck="false" placeholder="${zh ? '识别结果会出现在这里' : 'Transcript appears here'}"></textarea>
  <div class="row">
    <button id="send" class="primary" type="button">${text.send}</button>
    <button id="close" type="button">${zh ? '关闭页面' : 'Close'}</button>
  </div>
<script>
  const cfg = ${payload};
  const t = {
    start: ${JSON.stringify(text.start)},
    stop: ${JSON.stringify(text.stop)},
    sent: ${JSON.stringify(text.sent)},
    empty: ${JSON.stringify(text.empty)},
    noSupport: ${JSON.stringify(text.noSupport)},
    failed: ${JSON.stringify(text.failed)},
  };
  const mic = document.getElementById('mic');
  const out = document.getElementById('out');
  const status = document.getElementById('status');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    status.textContent = t.noSupport;
    mic.disabled = true;
    mic.style.opacity = '.4';
  }

  let recognition = null;
  let live = false;
  function stop() {
    live = false;
    mic.classList.remove('live');
    mic.textContent = '🎙';
    mic.title = t.start;
    try { recognition && recognition.stop(); } catch (e) {}
    recognition = null;
  }

  mic.addEventListener('click', () => {
    if (live) { stop(); return; }
    if (!Recognition) return;
    recognition = new Recognition();
    live = true;
    mic.classList.add('live');
    mic.textContent = '■';
    mic.title = t.stop;
    recognition.lang = navigator.language || 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = true;
    const base = out.value;
    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const item = event.results[i];
        if (item.isFinal) finalText += item[0].transcript;
        else interim += item[0].transcript;
      }
      out.value = (base + finalText + interim).trim();
    };
    recognition.onerror = (event) => {
      const code = event.error || 'unknown';
      status.textContent = t.failed + code;
      // 权限被拒时不要继续装作在听：直接停下来并给出可行的替代方案。
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        status.textContent = t.failed + code + ' — ' + t.noSupport;
        stop();
      }
    };
    recognition.onend = () => { if (live) { status.textContent = ''; } };
    try { recognition.start(); } catch (error) { stop(); status.textContent = t.failed + (error && error.message || error); }
  });

  document.getElementById('send').addEventListener('click', async () => {
    const text = out.value.trim();
    if (!text) { status.textContent = t.empty; return; }
    const response = await fetch('/text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: cfg.token, text })
    }).catch(() => null);
    if (response && response.ok) {
      status.textContent = t.sent;
      stop();
    } else {
      status.textContent = 'HTTP ' + (response ? response.status : '?');
    }
  });
  document.getElementById('close').addEventListener('click', () => window.close());
</script>
</body></html>`;
}
