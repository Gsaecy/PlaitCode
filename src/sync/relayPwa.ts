/**
 * PWA 静态资源：manifest / service worker / 图标。
 *
 * 为什么走 PWA 而不做原生 App：这个产品是「一个人多台设备 + 小团队」的工具，
 * 原生 App 要两个开发者账号、每次改动都过审核、还要维护两套 UI；
 * PWA 能"加到主屏幕 + 全屏无地址栏 + 记住登录"，达到 90% 的体验，
 * 而成本是一天。
 *
 * 图标用 SVG：Android/Chrome 支持 `sizes: any`，iOS 会退回截图缩略图 ——
 * 可接受，比在构建期引入 PNG 编码器要划算。
 */

export const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="HWChat">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4c9aff"/>
      <stop offset="1" stop-color="#7c5cff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0f1115"/>
  <path d="M150 372V140h96c52 0 88 32 88 80s-36 80-88 80h-44v72zm52-116h40c24 0 40-14 40-36s-16-36-40-36h-40z"
        fill="url(#g)"/>
  <circle cx="352" cy="352" r="26" fill="#4c9aff"/>
</svg>`;

export function renderManifest(): string {
  return JSON.stringify({
    name: 'HWChat · 团队群',
    short_name: 'HWChat',
    description: '在手机上指挥电脑上的编码 agent：提需求、看进度、批准操作。',
    start_url: '/m',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f1115',
    theme_color: '#0f1115',
    lang: 'zh-CN',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }, null, 2);
}

/**
 * Service worker：只为「可安装」而存在。
 *
 * **绝不经手 /v1/**：那些是轮询和发送密文的请求，被 SW 缓存或延迟会造成
 * 「消息丢了但不报错」，排障代价极高。
 */
export const SERVICE_WORKER_JS = `/* HWChat PWA service worker */
self.addEventListener('install', function (event) { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // 接口一律直连：缓存会让轮询看起来正常但拿不到新消息
  if (url.pathname.indexOf('/v1/') === 0) return;
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;
  event.respondWith(
    fetch(event.request).catch(function () {
      if (event.request.mode === 'navigate') {
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<body style="background:#0f1115;color:#e5e7eb;font:16px/1.6 system-ui;padding:40px 20px;text-align:center">'
          + '<h1 style="font-size:18px">当前没有网络</h1>'
          + '<p style="color:#9aa3b2">连上网络后刷新页面即可继续。</p></body>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      return new Response('', { status: 504 });
    }),
  );
});
`;
