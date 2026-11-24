/**
 * 网站：首页（`/`）与控制台（`/console`）。
 *
 * 设计基线按成熟产品站的通行做法来做，不自己发明数值：
 *  - 间距 4 / 8 / 16 / 24 / 32 / 48 / 64 / 96，全站只用这几档；
 *  - 圆角只留三档（容器 14 / 控件 10 / 徽标 6），满足「外大内小」；
 *  - 字号只留五档（40 / 22 / 16 / 14 / 12），行高固定比例；
 *  - 深色主题靠 1px 描边分层，不堆阴影；主色只用在主操作与状态；
 *  - 图标统一 20px 网格、1.5px 描边；
 *  - 焦点环、`prefers-reduced-motion`、`aria-current`、跳过导航，缺一不可。
 *
 * 为什么放在中继进程里：域名、证书、身份、数据都已经在，单独做站只会多三处失败点。
 *
 * 安全约定：
 *  - 页面里**不拼任何服务端数据**，浏览器端一律 `textContent`，
 *    设备名 / 成员名是用户输入，绝不能进 innerHTML；
 *  - CSP 与 `/m` 一致：只允许本站 fetch + 内联样式与脚本；
 *  - 登录回跳只认白名单（`/console`、`/m`），不做开放重定向。
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 全站共用的设计令牌与基础组件。
 *
 * 只放两页都用到的东西：令牌、排版、按钮、表格、空状态、页脚。
 * 任何新数值都必须先落成这里的令牌，避免又冒出 13px/17px 这种一次性值。
 */
const BASE_CSS = `
  :root {
    /* 间距：4 的倍数，只留八档 */
    --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px; --s9:96px;
    /* 圆角：容器 / 控件 / 徽标，外大内小 */
    --r-lg:14px; --r-md:10px; --r-sm:6px;
    /* 字号：五档 */
    --fs-hero:40px; --fs-h2:22px; --fs-h3:16px; --fs-body:14px; --fs-sm:13px; --fs-xs:12px;
    /* 颜色 */
    --bg:#0f1115; --surface:#15181f; --surface-2:#1b1f27;
    --line:rgba(255,255,255,.10); --line-strong:rgba(255,255,255,.18);
    --text:rgba(255,255,255,.95); --text-2:rgba(255,255,255,.64); --text-3:rgba(255,255,255,.42);
    --accent:#4c9aff; --accent-ink:#06121f; --ok:#34d399; --warn:#f0b429; --bad:#f87171;
    --container:1120px; --nav-h:56px;
  }
  *, *::before, *::after { box-sizing:border-box; }
  html { -webkit-text-size-adjust:100%; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:var(--fs-body)/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing:antialiased; }
  h1, h2, h3, p { margin:0; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  code, .mono { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:var(--fs-xs); }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:var(--r-sm); }
  .skip { position:absolute; left:-9999px; }
  .skip:focus { left:var(--s4); top:var(--s4); z-index:99; padding:var(--s2) var(--s3);
    background:var(--surface-2); border:1px solid var(--line-strong); border-radius:var(--r-md); }
  .wrap { max-width:var(--container); margin:0 auto; padding:0 var(--s5); }
  .icon { width:20px; height:20px; flex:0 0 auto; stroke:currentColor; stroke-width:1.5;
    stroke-linecap:round; stroke-linejoin:round; fill:none; }
  .icon-sm { width:16px; height:16px; }

  /* 按钮：32px 高（鼠标），触控场景自动涨到 40px */
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:var(--s2);
    min-height:32px; padding:0 var(--s3); border-radius:var(--r-md);
    border:1px solid var(--line-strong); background:var(--surface-2); color:var(--text);
    font:inherit; font-weight:600; font-size:var(--fs-sm); white-space:nowrap; cursor:pointer;
    transition:background-color .16s ease-out, border-color .16s ease-out; }
  .btn:hover { background:#232833; text-decoration:none; }
  .btn-primary { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  .btn-primary:hover { background:#63a9ff; border-color:#63a9ff; }
  .btn-ghost { background:transparent; border-color:transparent; color:var(--text-2); }
  .btn-ghost:hover { background:var(--surface-2); color:var(--text); }
  .btn-danger { background:transparent; border-color:rgba(248,113,113,.45); color:var(--bad); }
  .btn-danger:hover { background:rgba(248,113,113,.10); }
  .btn-lg { min-height:40px; padding:0 var(--s4); font-size:var(--fs-body); }
  .btn[disabled] { opacity:.45; cursor:not-allowed; }
  @media (pointer:coarse) { .btn { min-height:40px; } }

  /* 徽标 / 状态点 */
  .tag { display:inline-flex; align-items:center; gap:var(--s1); padding:0 var(--s2);
    height:20px; border-radius:var(--r-sm); border:1px solid var(--line);
    font-size:var(--fs-xs); color:var(--text-2); white-space:nowrap; }
  .tag-ok { color:var(--ok); border-color:rgba(52,211,153,.40); }
  .tag-bad { color:var(--bad); border-color:rgba(248,113,113,.40); }
  .tag-warn { color:var(--warn); border-color:rgba(240,180,41,.40); }
  .dot { width:6px; height:6px; border-radius:50%; background:currentColor; flex:0 0 auto; }

  /* 导航 */
  .nav { position:sticky; top:0; z-index:10; height:var(--nav-h);
    background:rgba(15,17,21,.86); backdrop-filter:blur(12px); border-bottom:1px solid var(--line); }
  .nav .inner { max-width:var(--container); margin:0 auto; padding:0 var(--s5); height:100%;
    display:flex; align-items:center; gap:var(--s5); }
  .brand { display:inline-flex; align-items:center; gap:var(--s2); color:var(--text); font-weight:600; }
  .brand:hover { text-decoration:none; }
  .brand img { width:24px; height:24px; border-radius:var(--r-sm); }
  .nav-links { display:flex; align-items:center; gap:var(--s5); font-size:var(--fs-sm); }
  .nav-links a { color:var(--text-2); }
  .nav-links a:hover { color:var(--text); text-decoration:none; }
  .nav-actions { margin-left:auto; display:flex; align-items:center; gap:var(--s2); }
  @media (max-width:840px) { .nav-links { display:none; } }

  /* 页面结构 */
  .section { padding:var(--s9) 0; border-top:1px solid var(--line); }
  .section-head { max-width:680px; margin-bottom:var(--s7); }
  .eyebrow { font-size:var(--fs-xs); letter-spacing:.08em; text-transform:uppercase; color:var(--text-3); margin-bottom:var(--s2); }
  .section h2 { font-size:var(--fs-h2); line-height:1.3; font-weight:600; letter-spacing:-.2px; }
  .section .lede { margin-top:var(--s2); color:var(--text-2); }
  .grid-3 { display:grid; gap:var(--s4); grid-template-columns:repeat(3, minmax(0,1fr)); }
  .grid-2 { display:grid; gap:var(--s7); grid-template-columns:repeat(2, minmax(0,1fr)); align-items:start; }
  @media (max-width:840px) { .grid-3, .grid-2 { grid-template-columns:1fr; } .section { padding:var(--s8) 0; } }

  .card { border:1px solid var(--line); border-radius:var(--r-lg); background:var(--surface); padding:var(--s5); }
  .card h3 { display:flex; align-items:center; gap:var(--s2); font-size:var(--fs-h3); font-weight:600; }
  .card h3 .icon { color:var(--accent); }
  a.card { display:block; color:var(--text); transition:border-color .16s ease-out; }
  a.card:hover { border-color:var(--line-strong); text-decoration:none; }
  a.card:hover h3 { color:var(--accent); }
  .card p { margin-top:var(--s2); color:var(--text-2); font-size:var(--fs-sm); }

  /* 表格：只靠 1px 下边线，不加斑马纹 */
  table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
  th { text-align:left; font-weight:500; color:var(--text-3); font-size:var(--fs-xs);
    padding:var(--s2) var(--s3); border-bottom:1px solid var(--line); white-space:nowrap; }
  td { padding:var(--s3); border-bottom:1px solid var(--line); vertical-align:middle; }
  tr:last-child td { border-bottom:0; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }

  footer.site { border-top:1px solid var(--line); padding:var(--s7) 0 var(--s6); color:var(--text-2); font-size:var(--fs-sm); }
  .foot-cols { display:grid; gap:var(--s6); grid-template-columns:repeat(4, minmax(0,1fr)); }
  .foot-cols h4 { margin:0 0 var(--s3); font-size:var(--fs-xs); color:var(--text-3); font-weight:500; }
  .foot-cols ul { list-style:none; margin:0; padding:0; display:grid; gap:var(--s2); }
  .foot-cols a { color:var(--text-2); }
  .foot-bottom { margin-top:var(--s7); padding-top:var(--s4); border-top:1px solid var(--line);
    display:flex; gap:var(--s4); flex-wrap:wrap; align-items:center; color:var(--text-3); font-size:var(--fs-xs); }
  @media (max-width:840px) { .foot-cols { grid-template-columns:repeat(2, minmax(0,1fr)); } }

  .banner { display:flex; gap:var(--s2); margin:var(--s4) 0; padding:var(--s3) var(--s4);
    border-radius:var(--r-md); font-size:var(--fs-sm);
    background:rgba(240,180,41,.10); border:1px solid rgba(240,180,41,.40); color:#f7d68a; }
  .empty { padding:var(--s7) var(--s4); text-align:center; color:var(--text-2); font-size:var(--fs-sm); }
  .empty .icon { width:32px; height:32px; color:var(--text-3); margin-bottom:var(--s3); }
  .empty b { display:block; color:var(--text); font-size:var(--fs-body); margin-bottom:var(--s1); }
  .empty p { max-width:420px; margin:0 auto; }
  tbody tr:hover td { background:rgba(255,255,255,.02); }
  .skeleton { height:14px; border-radius:var(--r-sm); background:var(--surface-2); }
  @media (prefers-reduced-motion:reduce) {
    * { transition:none !important; animation:none !important; scroll-behavior:auto !important; }
  }
`;

/** 图标：统一 20px 网格、1.5px 描边、圆角端点。 */
const ICONS: Record<string, string> = {
  terminal: '<path d="M4 5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="m6 9 2 2-2 2M10 13h4"/>',
  phone: '<rect x="6.5" y="3" width="7" height="14" rx="1.6"/><path d="M9 15h2"/>',
  shield: '<path d="M10 3 4.5 5v4.5c0 3.2 2.2 6.1 5.5 7 3.3-.9 5.5-3.8 5.5-7V5L10 3Z"/><path d="m7.6 9.8 1.7 1.7 3.1-3.2"/>',
  users: '<circle cx="7.5" cy="8" r="2.2"/><path d="M3.8 15.5c.4-2 1.9-3.2 3.7-3.2s3.3 1.2 3.7 3.2"/><path d="M13 6.3a2 2 0 0 1 0 3.7M14 12.6c1.4.2 2.4 1.3 2.7 2.9"/>',
  board: '<rect x="3.5" y="4" width="4.2" height="12" rx="1"/><rect x="8.8" y="4" width="4.2" height="8" rx="1"/><rect x="14.1" y="4" width="2.4" height="10" rx="1"/>',
  key: '<circle cx="7" cy="10" r="3"/><path d="M10 10h7M15 10v3M17.5 10v2"/>',
  server: '<rect x="3.5" y="4" width="13" height="5" rx="1.3"/><rect x="3.5" y="11" width="13" height="5" rx="1.3"/><path d="M6 6.5h.01M6 13.5h.01"/>',
  activity: '<path d="M3 11h3l2-5 3.5 9 2-4h3.5"/>',
  message: '<path d="M3.5 5.5h13v7.5h-7.2L5.6 16v-3H3.5Z"/>',
  question: '<circle cx="10" cy="10" r="6.5"/><path d="M8.1 8.1a1.9 1.9 0 1 1 2.7 1.7c-.5.3-.8.7-.8 1.3v.2M10 14h.01"/>',
  check: '<path d="m4.4 10.6 3.6 3.6 7.6-8.2"/>',
  laptop: '<rect x="4.6" y="4.5" width="10.8" height="7.4" rx="1.2"/><path d="M2.9 14.8h14.2"/>',
};

function icon(name: string, cls = 'icon'): string {
  return `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

/**
 * 首页。
 *
 * **冰山原则**（用户 2026-11-24）：
 *  露出水面的只有一句话 + 一个按钮；想深入的人自己往下走，有引导、有文档。
 *
 * 具体到这一页：
 *  水面之上 —— 一句价值主张、两个按钮（装扩展 / 手机端）、一行「需要 GitHub 账号？」；
 *  浅水区   —— 三步开始、为什么"先问清楚"（这是差异化，值得露出）；
 *  深水区   —— 文档入口：多设备设置、企业能力、架构说明、和别的工具的区别。
 *
 * 所以这里**不再**放：功能清单、双设备表格、给程序员的段落、工具对比表 ——
 * 那些都在 docs/ 里，首页只负责让人看懂"这是什么"和"从哪开始"。
 */
export function renderLandingPage(options: {
  relayHost: string;
  /** 服务端是否配了登录；没配时给确切原因，而不是给一个点了就报错的按钮。 */
  consoleEnabled: boolean;
  installUrl: string;
  repoUrl: string;
}): string {
  const host = escapeHtml(options.relayHost);
  const install = escapeHtml(options.installUrl);
  const repo = escapeHtml(options.repoUrl);

  const steps: Array<[string, string]> = [
    ['装扩展', '在 VS Code 里装 PlaitCode，或用 VSIX 离线安装。'],
    ['登录一次', '命令面板执行「开始协作」，浏览器里用 GitHub 授权。不填地址、不要配对码。'],
    ['开始用', '第二台电脑执行同一个命令；手机扫一次码。都在同一条频道里。'],
  ];
  const threeC: Array<[string, string, string]> = [
    ['message', '先说它听懂了什么', '把你要的效果复述一遍：哪个界面、看到什么、什么算做完。不出现文件名和变量名。'],
    ['question', '含糊就问你', '拿不准的地方给二选一，你只要挑一个；没答完它不开始改。'],
    ['check', '做完告诉你怎么验', '用大白话讲改了什么，以及你自己点两下就能确认的步骤。'],
  ];
  const deeper: Array<[string, string, string, string]> = [
    ['terminal', '多设备与手机', '三步上手、电源设置、排查表、安全边界。', `${repo}/blob/main/docs/COLLAB-SETUP.md`],
    ['users', '它和别的工具怎么分工', 'PR、Live Share、Cursor 各自擅长什么，这里补的是哪一段。', `${repo}/blob/main/docs/WEBSITE.md`],
    ['shield', '企业能力', '组织与角色、审计、策略下发、私有化部署。', `${repo}/blob/main/docs/ENTERPRISE.md`],
    ['server', '架构说明', '传输、身份、协作语义三层为什么分开。', `${repo}/blob/main/docs/ARCHITECTURE-REVIEW.md`],
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1115">
<meta name="description" content="PlaitCode：不会写代码也能把想法做出来。用中文提需求，AI 先复述、再追问、确认后才动手，交付时告诉你自己怎么验。">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: 'self'; connect-src 'self'; manifest-src 'self'">
<title>PlaitCode · 你说要什么，它先问清楚再动手</title>
<style>${BASE_CSS}
  .hero { padding:var(--s7) 0 var(--s8); position:relative; }
  .hero::before { content:""; position:absolute; inset:-40% 20% auto; height:420px; pointer-events:none;
    background:radial-gradient(ellipse at 50% 0%, rgba(76,154,255,.16), transparent 68%); }
  .hero .wrap { position:relative; }
  .hero-grid { display:grid; gap:var(--s7); grid-template-columns:minmax(0,1fr) minmax(0,1.05fr); align-items:center; }
  .hero h1 { margin:0 0 var(--s4); font-size:var(--fs-hero); line-height:1.15; letter-spacing:-1px; font-weight:600; }
  .hero .lede { font-size:var(--fs-h3); line-height:1.6; color:var(--text-2); max-width:32em; }
  .hero .actions { display:flex; gap:var(--s3); flex-wrap:wrap; margin-top:var(--s6); align-items:center; }
  .hero .fine { margin-top:var(--s3); color:var(--text-3); font-size:var(--fs-xs); }
  @media (max-width:960px) { .hero-grid { grid-template-columns:1fr; } .hero h1 { font-size:32px; } }

  /* 产品示意图：用真实结构画，不放会过时的截图 */
  .window { border:1px solid var(--line-strong); border-radius:var(--r-lg); background:var(--surface); overflow:hidden; }
  .window-bar { display:flex; align-items:center; gap:var(--s2); height:36px; padding:0 var(--s3);
    border-bottom:1px solid var(--line); color:var(--text-3); font-size:var(--fs-xs); }
  .window-bar .dots { display:flex; gap:var(--s1); }
  .window-bar .dots i { width:8px; height:8px; border-radius:50%; background:var(--line-strong); display:block; }
  .window-body { padding:var(--s4); display:grid; gap:var(--s3); }
  .msg { display:flex; flex-direction:column; gap:var(--s1); max-width:92%; }
  .msg .who { font-size:var(--fs-xs); color:var(--text-3); display:flex; align-items:center; gap:var(--s2); flex-wrap:wrap; }
  .msg .bubble { border:1px solid var(--line); background:var(--surface-2); border-radius:var(--r-md);
    padding:var(--s2) var(--s3); font-size:var(--fs-sm); line-height:1.55; }
  .msg .bubble p + p { margin-top:var(--s2); }
  .msg.mine { align-self:flex-end; }
  .msg.mine .bubble { background:rgba(76,154,255,.14); border-color:rgba(76,154,255,.35); }

  .steps { display:grid; gap:var(--s4); grid-template-columns:repeat(3, minmax(0,1fr)); }
  .step { border-top:1px solid var(--line-strong); padding-top:var(--s4); }
  .step .n { color:var(--text-3); font-size:var(--fs-xs); font-variant-numeric:tabular-nums; }
  .step h3 { margin-top:var(--s2); font-size:var(--fs-h3); font-weight:600; }
  .step p { margin-top:var(--s1); color:var(--text-2); font-size:var(--fs-sm); }
  @media (max-width:840px) { .steps { grid-template-columns:1fr; } }

  .quote { border-left:2px solid var(--accent); padding:var(--s1) 0 var(--s1) var(--s4);
    color:var(--text-2); font-size:var(--fs-sm); }
  .quote b { color:var(--text); }
  .quote cite { display:block; margin-top:var(--s2); color:var(--text-3); font-size:var(--fs-xs); font-style:normal; }
  .note-line { display:flex; gap:var(--s2); align-items:center; margin-top:var(--s5); padding:var(--s3) var(--s4);
    border:1px solid var(--line); border-radius:var(--r-md); background:var(--surface);
    color:var(--text-2); font-size:var(--fs-sm); }
  .note-line .icon { color:var(--accent); }

  /* 安装命令：一行能复制，不解释多余的东西 */
  .install { margin-top:var(--s6); border:1px solid var(--line); border-radius:var(--r-lg);
    background:var(--surface); overflow:hidden; }
  .install-head { display:flex; align-items:center; gap:var(--s3); padding:var(--s2) var(--s3) var(--s2) var(--s4);
    border-bottom:1px solid var(--line); color:var(--text-2); font-size:var(--fs-xs); }
  .install-head button { margin-left:auto; min-height:28px; padding:0 var(--s2); font-size:var(--fs-xs); }
  .install pre { margin:0; padding:var(--s4); overflow-x:auto; color:var(--text); }
  .install pre code { font-size:var(--fs-sm); }
  .install-foot { display:flex; gap:var(--s2) var(--s4); flex-wrap:wrap; align-items:center;
    padding:var(--s3) var(--s4); border-top:1px solid var(--line); color:var(--text-3); font-size:var(--fs-xs); }
  .install-foot a { color:var(--accent); }
  .install-foot code { color:var(--text-2); }

  .cta-band { border-top:1px solid var(--line); padding:var(--s8) 0; }
  .cta-band .inner { display:flex; align-items:center; gap:var(--s5); flex-wrap:wrap; }
  .cta-band h2 { font-size:var(--fs-h2); font-weight:600; }
  .cta-band p { color:var(--text-2); font-size:var(--fs-sm); margin-top:var(--s1); }
  .cta-band .actions { margin-left:auto; display:flex; gap:var(--s3); flex-wrap:wrap; }
</style>
</head>
<body>
<a class="skip" href="#main">跳到主要内容</a>
<header class="nav">
  <div class="inner">
    <a class="brand" href="/"><img src="/icon.svg" alt="">PlaitCode</a>
    <nav class="nav-links" aria-label="主导航">
      <a href="#start">怎么开始</a>
      <a href="#ask">为什么这么用</a>
      <a href="#deeper">文档</a>
    </nav>
    <div class="nav-actions">
      <a class="btn btn-ghost" href="/console">控制台</a>
      <a class="btn btn-primary" href="${install}">安装</a>
    </div>
  </div>
</header>

<main id="main">
  <div class="hero">
    <div class="wrap">
      <div class="hero-grid">
        <div>
          <h1>你说要什么，<br>它先问清楚，再动手。</h1>
          <p class="lede">你不需要会写代码。用中文把想法说出来，它先复述一遍、把含糊的地方问明白，等你点头才开始改。</p>
          <div class="actions">
            <a class="btn btn-primary btn-lg" href="${install}">在 VS Code 安装</a>
            <a class="btn btn-lg" href="/m">手机端 →</a>
          </div>
          <p class="fine">需要一个 GitHub 账号？<a href="https://github.com/signup" target="_blank" rel="noopener">免费注册 →</a></p>
        </div>

        <div class="window" role="img" aria-label="对话示意：用户提一句话需求，AI 复述理解并追问两处含糊的地方，用户回答后确认执行">
          <div class="window-bar"><span class="dots"><i></i><i></i><i></i></span>团队群</div>
          <div class="window-body">
            <div class="msg mine">
              <span class="who">你</span>
              <span class="bubble">会员快到期的时候要能提醒用户续费，不然他们就直接不用了。</span>
            </div>
            <div class="msg">
              <span class="who">AI <span class="tag tag-warn"><span class="dot"></span>等你回复</span></span>
              <span class="bubble"><p>我理解成：到期前 7 天，在 App 里提示一次，并给一个续费按钮。</p><p>还有两处要你定：① 只在 App 里提示，还是也发短信？② 到期之后还能不能看以前的内容？</p></span>
            </div>
            <div class="msg mine">
              <span class="who">你</span>
              <span class="bubble">只在 App 里提示。到期后还能看，但不能新增。</span>
            </div>
            <div class="msg">
              <span class="who">AI <span class="tag tag-ok"><span class="dot"></span>已确认</span></span>
              <span class="bubble">按这个来：到期前 7 天提示 + 续费按钮，到期后只读。做完告诉你怎么验。</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <section class="section" id="start">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">怎么开始</div>
        <h2>三步，然后只说人话</h2>
      </div>
      <div class="steps">
        ${steps.map(([title, body], index) => `<div class="step"><div class="n">0${index + 1}</div><h3>${title}</h3><p>${body}</p></div>`).join('')}
      </div>

      <div class="install">
        <div class="install-head">
          <span>在终端里装（macOS / Windows / Linux 一样）</span>
          <button class="btn btn-ghost" type="button" id="copyInstall" data-command="code --install-extension plaitcode.plaitcode">复制</button>
        </div>
        <pre><code id="installCommand">code --install-extension plaitcode.plaitcode</code></pre>
        <div class="install-foot">
          <span>找不到 <code>code</code> 命令？在 VS Code 里 <code>Ctrl+Shift+P</code> 执行 <code>Shell Command: Install 'code' command in PATH</code>。</span>
          <a href="${repo}/releases/latest">或下载 .vsix 离线安装 →</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="ask">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">为什么这么用</div>
        <h2>先把需求问清楚，是正规协作的拆法</h2>
        <p class="lede">行业里把一条需求拆成三段，这里只是把这三段固定在流程里，让它不能被跳过。</p>
      </div>
      <div class="grid-3">
        ${threeC.map(([name, title, body]) => `<div class="card"><h3>${icon(name)}${title}</h3><p>${body}</p></div>`).join('')}
      </div>
      <div class="quote" style="margin-top:var(--s6)">
        需求卡 Card → 澄清对话 Conversation → 验收标准 Confirmation。需求用非技术语言写，细节在双方确认之后才补。
        <cite>Atlassian《User stories with examples and a template》</cite>
      </div>
    </div>
  </section>

  <section class="section" id="deeper">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">想深入的时候</div>
        <h2>这些不用读也能用</h2>
        <p class="lede">下面每一条都是给想知道细节的人准备的。</p>
      </div>
      <div class="grid-3">
        ${deeper.map(([name, title, body, href]) => `<a class="card" href="${escapeHtml(href)}"><h3>${icon(name)}${title}</h3><p>${body}</p></a>`).join('')}
      </div>
      <div class="note-line">
        ${icon('key', 'icon icon-sm')}
        <span>协作内容端到端加密：服务器只转发密文，解不开你的消息。服务端 ${host}</span>
      </div>
      ${options.consoleEnabled ? '' : `<div class="banner">${icon('shield', 'icon icon-sm')}<span>这台服务器还没开放登录，控制台暂时打不开。</span></div>`}
    </div>
  </section>

  <div class="cta-band">
    <div class="wrap inner">
      <div>
        <h2>现在就可以试</h2>
        <p>装好、登录一次，就能开始。</p>
      </div>
      <div class="actions">
        <a class="btn btn-primary btn-lg" href="${install}">安装扩展</a>
        <a class="btn btn-lg" href="/m">手机端</a>
      </div>
    </div>
  </div>
</main>

<footer class="site">
  <div class="wrap">
    <div class="foot-bottom" style="margin-top:0;border-top:0;padding-top:0">
      <span>© 2026 PlaitCode</span>
      <span><a href="${repo}">GitHub</a></span>
      <span><a href="${repo}/tree/main/docs">全部文档</a></span>
      <span style="margin-left:auto">只转发密文 · 不存代码</span>
    </div>
  </div>
</footer>
<script>
(function () {
  var button = document.getElementById('copyInstall');
  var command = document.getElementById('installCommand');
  if (!button || !command) return;
  var label = button.textContent;
  button.addEventListener('click', function () {
    var text = button.getAttribute('data-command') || command.textContent || '';
    var done = function () {
      button.textContent = '已复制';
      setTimeout(function () { button.textContent = label; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      return;
    }
    fallback(text, done);
  });
  // 非 https 或旧浏览器没有 clipboard API 时，退回到选中文本
  function fallback(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (error) { button.textContent = '请手动选中复制'; }
    document.body.removeChild(area);
  }
})();
</script>
</body>
</html>`;
}
/**
 * 登录结果页：浏览器里走完 GitHub 登录后给用户看的那一屏。
 *
 * 只用于「设备码」流程 —— 用户此刻的注意力在浏览器，要一眼看懂
 * 「可以关掉了，回 VS Code 继续」。所以只有一句话 + 一个状态图标。
 */
export function renderAuthResultPage(options: { ok: boolean; title: string; body: string }): string {
  const tone = options.ok ? 'var(--ok)' : 'var(--bad)';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1115">
<title>${escapeHtml(options.title)} · PlaitCode</title>
<style>${BASE_CSS}
  .stage { min-height:100vh; display:grid; place-items:center; padding:var(--s5); }
  .card { max-width:420px; width:100%; border:1px solid var(--line); border-radius:var(--r-lg);
    background:var(--surface); padding:var(--s6); text-align:center; }
  .mark { width:48px; height:48px; margin:0 auto var(--s4); border-radius:50%;
    display:grid; place-items:center; border:1px solid ${tone}; color:${tone}; }
  h1 { font-size:var(--fs-h2); font-weight:600; }
  p { margin-top:var(--s2); color:var(--text-2); font-size:var(--fs-sm); line-height:1.7; }
</style>
</head>
<body>
<div class="stage">
  <div class="card">
    <div class="mark">${options.ok ? icon('check') : icon('question')}</div>
    <h1>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.body)}</p>
  </div>
</div>
</body>
</html>`;
}

/**
 * 控制台外壳。数据全部由 `/v1/console/*` 取，页面本身不含任何服务端数据。
 *
 * 结构沿用成熟后台的通行做法：左侧固定导航 + 右侧内容区，
 * 内容区顶上是「标题 + 说明」，下面是统计卡与表格；危险操作二次确认。
 */
export function renderConsolePage(options: { relayHost: string; sessionAuth: boolean }): string {
  const host = escapeHtml(options.relayHost);
  const sessionAuth = options.sessionAuth ? 'true' : 'false';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1115">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: 'self'; connect-src 'self'; manifest-src 'self'">
<title>PlaitCode 控制台</title>
<style>${BASE_CSS}
  .shell { display:grid; grid-template-columns:216px minmax(0,1fr); min-height:100vh; }
  .side { border-right:1px solid var(--line); padding:var(--s4) var(--s3); display:flex; flex-direction:column; gap:var(--s4); }
  .side-head { display:flex; align-items:center; gap:var(--s2); padding:0 var(--s2) var(--s2); }
  .side-head img { width:24px; height:24px; border-radius:var(--r-sm); }
  .side-head b { font-size:var(--fs-sm); font-weight:600; display:block; }
  .side-head span { color:var(--text-3); font-size:var(--fs-xs); }
  .side nav { display:grid; gap:2px; }
  .side nav a { display:flex; align-items:center; gap:var(--s2); height:32px; padding:0 var(--s2);
    border-radius:var(--r-md); color:var(--text-2); font-size:var(--fs-sm); }
  .side nav a:hover { background:var(--surface-2); color:var(--text); text-decoration:none; }
  .side nav a[aria-current="page"] { background:var(--surface-2); color:var(--text); font-weight:600; }
  .side nav a[aria-current="page"] .icon { color:var(--accent); }
  .side-foot { margin-top:auto; padding:var(--s3) var(--s2) 0; border-top:1px solid var(--line);
    display:grid; gap:var(--s1); color:var(--text-3); font-size:var(--fs-xs); }
  .side-foot a { color:var(--text-2); }
  .main { min-width:0; }
  .main-head { position:sticky; top:0; z-index:5; height:var(--nav-h); display:flex; align-items:center;
    gap:var(--s3); padding:0 var(--s6); border-bottom:1px solid var(--line);
    background:rgba(15,17,21,.86); backdrop-filter:blur(12px); }
  .main-head .who { margin-left:auto; display:flex; align-items:center; gap:var(--s3);
    color:var(--text-2); font-size:var(--fs-sm); }
  .main-head .who a { color:var(--text-2); }
  .main-body { padding:var(--s6); max-width:1040px; }
  .page-head { display:flex; align-items:flex-start; gap:var(--s4); flex-wrap:wrap; margin-bottom:var(--s6); }
  .page-head h1 { font-size:var(--fs-h2); font-weight:600; letter-spacing:-.2px; }
  .page-head p { margin-top:var(--s1); color:var(--text-2); font-size:var(--fs-sm); max-width:60ch; }
  .page-head .actions { margin-left:auto; display:flex; gap:var(--s2); }

  .stats { display:grid; gap:var(--s3); grid-template-columns:repeat(4, minmax(0,1fr)); margin-bottom:var(--s6); }
  .stat { border:1px solid var(--line); border-radius:var(--r-lg); background:var(--surface); padding:var(--s4); }
  .stat b { display:block; font-size:24px; line-height:1.2; font-weight:600; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--text-2); font-size:var(--fs-xs); }
  @media (max-width:1000px) { .stats { grid-template-columns:repeat(2, minmax(0,1fr)); } }

  .panel { border:1px solid var(--line); border-radius:var(--r-lg); background:var(--surface); overflow:hidden; }
  .panel + .panel { margin-top:var(--s5); }
  .panel-head { display:flex; align-items:center; gap:var(--s3); padding:var(--s3) var(--s4);
    border-bottom:1px solid var(--line); }
  .panel-head h2 { font-size:var(--fs-h3); font-weight:600; }
  .panel-head .count { color:var(--text-3); font-size:var(--fs-xs); }
  .panel-head .actions { margin-left:auto; display:flex; gap:var(--s2); }
  .cell-main { display:flex; align-items:center; gap:var(--s2); }
  .cell-main b { font-weight:600; }
  .cell-sub { color:var(--text-3); font-size:var(--fs-xs); margin-top:2px; }
  .cell-right { text-align:right; white-space:nowrap; }
  .err { padding:var(--s5) var(--s4); color:var(--bad); font-size:var(--fs-sm); }

  @media (max-width:840px) {
    .shell { grid-template-columns:1fr; }
    .side { border-right:0; border-bottom:1px solid var(--line); padding:var(--s3); }
    .side nav { grid-auto-flow:column; grid-auto-columns:max-content; overflow-x:auto; }
    .side-foot { display:none; }
    .main-head { padding:0 var(--s4); }
    .main-body { padding:var(--s4); }
  }
</style>
</head>
<body>
<a class="skip" href="#main">跳到主要内容</a>
<div class="shell">
  <aside class="side">
    <div class="side-head">
      <img src="/icon.svg" alt="">
      <div><b>PlaitCode 控制台</b><span>${host}</span></div>
    </div>
    <nav aria-label="控制台导航" id="tabs">
      <a href="#overview" data-tab="overview" aria-current="page">${icon('activity', 'icon icon-sm')}概览</a>
      <a href="#devices" data-tab="devices">${icon('terminal', 'icon icon-sm')}设备</a>
      <a href="#channels" data-tab="channels">${icon('board', 'icon icon-sm')}通道</a>
      <a href="#audit" data-tab="audit">${icon('shield', 'icon icon-sm')}审计</a>
    </nav>
    <div class="side-foot">
      <a href="/">返回首页</a>
      <a href="/m">手机端</a>
      <a href="#" id="logout">退出登录</a>
    </div>
  </aside>

  <div class="main">
    <div class="main-head">
      <span class="tag" id="conn"><span class="dot"></span>读取中</span>
      <div class="who"><span id="who">未登录</span></div>
    </div>
    <div class="main-body" id="main">
      <div id="notice"></div>
      <div id="view">
        <div class="skeleton" style="width:180px;margin-bottom:16px"></div>
        <div class="skeleton" style="width:60%"></div>
      </div>
    </div>
  </div>
</div>

<script>
(function () {
  var sessionAuth = ${sessionAuth};
  var data = null;
  var tab = 'overview';
  var view = document.getElementById('view');
  var notice = document.getElementById('notice');
  var who = document.getElementById('who');
  var conn = document.getElementById('conn');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function svg(name) {
    var paths = {
      terminal: 'M4 5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 4 2 2-2 2m4-2h4',
      shield: 'M10 3 4.5 5v4.5c0 3.2 2.2 6.1 5.5 7 3.3-.9 5.5-3.8 5.5-7V5L10 3Z',
      board: 'M3.5 4h4.2v12H3.5zM8.8 4h4.2v8H8.8zM14.1 4h2.4v10h-2.4z',
      activity: 'M3 11h3l2-5 3.5 9 2-4h3.5'
    };
    var ns = 'http://www.w3.org/2000/svg';
    var node = document.createElementNS(ns, 'svg');
    node.setAttribute('viewBox', '0 0 20 20');
    node.setAttribute('class', 'icon');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.5');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', paths[name] || '');
    node.appendChild(path);
    return node;
  }

  function when(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function relative(ts) {
    if (!ts) return '从未';
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    return Math.round(diff / 86400000) + ' 天前';
  }

  function banner(text) {
    notice.textContent = '';
    if (!text) return;
    var box = el('div', 'banner');
    box.appendChild(el('span', null, text));
    notice.appendChild(box);
  }

  function fail(message) {
    view.textContent = '';
    view.appendChild(el('div', 'err', message));
  }

  function emptyState(iconName, title, body) {
    var box = el('div', 'empty');
    box.appendChild(svg(iconName));
    box.appendChild(el('b', null, title));
    box.appendChild(el('p', null, body));
    return box;
  }

  function pageHead(title, desc, actions) {
    var node = el('div', 'page-head');
    var left = el('div');
    left.appendChild(el('h1', null, title));
    left.appendChild(el('p', null, desc));
    node.appendChild(left);
    if (actions && actions.length) {
      var right = el('div', 'actions');
      actions.forEach(function (button) { right.appendChild(button); });
      node.appendChild(right);
    }
    return node;
  }

  function stat(value, label) {
    var node = el('div', 'stat');
    node.appendChild(el('b', null, value));
    node.appendChild(el('span', null, label));
    return node;
  }

  function panel(title, count) {
    var node = el('div', 'panel');
    var head = el('div', 'panel-head');
    head.appendChild(el('h2', null, title));
    if (count !== undefined && count !== null) head.appendChild(el('span', 'count', String(count)));
    node.appendChild(head);
    var body = el('div');
    node.appendChild(body);
    return { node: node, body: body };
  }

  function table(headers) {
    var t = el('table');
    var thead = el('thead');
    var tr = el('tr');
    headers.forEach(function (header) {
      var th = el('th', header.num ? 'num' : null, header.label);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = el('tbody');
    t.appendChild(tbody);
    return { node: t, body: tbody };
  }

  function row(children) {
    var tr = el('tr');
    children.forEach(function (child) {
      var td = el('td', child && child.className === 'cell-right' ? 'num' : null);
      if (child) td.appendChild(child);
      tr.appendChild(td);
    });
    return tr;
  }

  function renderOverview() {
    view.appendChild(pageHead('概览', '这条频道上谁在线、设备够不够用、最近发生了什么。'));

    var stats = el('div', 'stats');
    stats.appendChild(stat(data.counts.devices, '设备（未吊销）'));
    stats.appendChild(stat(data.counts.online, '当前在线'));
    stats.appendChild(stat(data.counts.channels, '通道'));
    stats.appendChild(stat(data.counts.members, '成员'));
    view.appendChild(stats);

    var recent = panel('最近活动', data.audit.length + ' 条');
    if (!data.audit.length) {
      recent.body.appendChild(emptyState('shield', '还没有记录',
        '设备连上中继后，这里会出现发布、在线、被拒绝等事件；审计只记元数据，不含正文。'));
    } else {
      var t = table([{ label: '时间' }, { label: '事件' }, { label: '频道' }, { label: '详情' }]);
      data.audit.slice(0, 12).forEach(function (item) {
        var name = el('div', 'cell-main');
        name.appendChild(el('b', null, String(item.event || '')));
        t.body.appendChild(row([
          el('span', 'cell-sub', when(item.ts)),
          name,
          el('span', 'mono', item.channel ? String(item.channel).slice(0, 10) : '—'),
          el('span', 'cell-sub', item.detail ? String(item.detail) : '—')
        ]));
      });
      recent.body.appendChild(t.node);
    }
    view.appendChild(recent.node);
  }

  function renderDevices() {
    var invite = el('button', 'btn', '怎么加入新设备');
    invite.addEventListener('click', function () {
      alert('在已授权的设备上执行：\\n\\nPlaitCode: 给另一台设备发配对信息（含设备令牌）\\n\\n把复制出来的那一行粘到新设备的「加入跨网频道」即可。控制台不发令牌 —— 频道密钥只存在你的设备上。');
    });
    view.appendChild(pageHead('设备', '每台设备一条记录（Windows 版、macOS 版各一条）。换机器时先在这里吊销旧的，再让新设备接入。', [invite]));

    var list = panel('设备', data.devices.length);
    if (!data.devices.length) {
      list.body.appendChild(emptyState('terminal', '还没有设备',
        '在 VS Code 里执行「PlaitCode: 新建跨网频道」，这台设备会自动登记进来。'));
    } else {
      var t = table([{ label: '设备' }, { label: '平台' }, { label: '成员' }, { label: '最近在线' }, { label: '状态' }, { label: '操作', num: true }]);
      data.devices.forEach(function (device) {
        var name = el('div', 'cell-main');
        var stack = el('div');
        stack.appendChild(el('b', null, device.name));
        stack.appendChild(el('div', 'cell-sub', (device.grants || []).map(function (g) {
          return String(g.channelId).slice(0, 8) + ' · ' + g.role;
        }).join('  ')));
        name.appendChild(stack);

        var status = el('span', 'tag' + (device.revokedAt ? ' tag-bad' : (device.online ? ' tag-ok' : '')));
        status.appendChild(el('span', 'dot'));
        status.appendChild(el('span', null, device.revokedAt ? '已吊销' : (device.online ? '在线' : '离线')));

        var actions = el('div', 'cell-right');
        if (!device.revokedAt) {
          var revoke = el('button', 'btn btn-danger', '吊销');
          revoke.addEventListener('click', function () {
            if (!confirm('吊销后这台设备立刻失去频道访问。确定要吊销「' + device.name + '」吗？')) return;
            revoke.disabled = true;
            revoke.textContent = '吊销中…';
            fetch('/v1/console/devices/revoke', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ deviceId: device.id })
            }).then(function (res) {
              if (res.status === 401) { location.href = '/v1/auth/feishu/start?next=console'; return; }
              return res.json().then(function (payload) {
                if (!payload.ok) {
                  revoke.disabled = false;
                  revoke.textContent = '吊销';
                  alert(payload.error || '吊销失败，请稍后重试');
                  return;
                }
                load();
              });
            }).catch(function () {
              revoke.disabled = false;
              revoke.textContent = '吊销';
              alert('网络错误，请重试');
            });
          });
          actions.appendChild(revoke);
        } else {
          actions.appendChild(el('span', 'cell-sub', when(device.revokedAt)));
        }

        t.body.appendChild(row([
          name,
          el('span', 'cell-sub', device.platform || '未知'),
          el('span', 'cell-sub', device.memberName || '—'),
          el('span', 'cell-sub', relative(device.lastSeenAt)),
          status,
          actions
        ]));
      });
      list.body.appendChild(t.node);
    }
    view.appendChild(list.node);
  }

  function renderChannels() {
    view.appendChild(pageHead('通道', '一条通道对应一条协作线。频道 ID 由密钥派生，服务端反推不出密钥。'));

    var list = panel('通道', data.channels.length);
    if (!data.channels.length) {
      list.body.appendChild(emptyState('board', '还没有通道',
        '在 VS Code 里执行「PlaitCode: 新建跨网频道」后，这里会出现第一条通道。'));
    } else {
      var t = table([{ label: '频道 ID' }, { label: '在线 / 设备' }, { label: '最近消息' }, { label: '设备' }]);
      data.channels.forEach(function (channel) {
        var id = el('div', 'cell-main');
        id.appendChild(el('b', 'mono', channel.channelId));
        t.body.appendChild(row([
          id,
          el('span', 'cell-sub', channel.online + ' / ' + channel.devices),
          el('span', 'cell-sub', when(channel.lastMessageAt)),
          el('span', 'cell-sub', (channel.deviceNames || []).join(' / ') || '—')
        ]));
      });
      list.body.appendChild(t.node);
    }
    view.appendChild(list.node);
  }

  function renderAudit() {
    view.appendChild(pageHead('审计', '只记元数据：谁、哪台设备、什么时间、多大密文。正文从不落库。'));

    var list = panel('最近事件', data.audit.length + ' 条');
    if (!data.audit.length) {
      list.body.appendChild(emptyState('shield', '还没有审计记录',
        '需要服务端配置 PLAITCODE_AUDIT_PATH 才会落盘；没配时事件只写到 stdout 交给 journald。'));
    } else {
      var t = table([{ label: '时间' }, { label: '事件' }, { label: '设备' }, { label: '频道' }, { label: '详情' }]);
      data.audit.forEach(function (item) {
        t.body.appendChild(row([
          el('span', 'cell-sub', when(item.ts)),
          el('b', null, String(item.event || '')),
          el('span', 'mono', item.device || '—'),
          el('span', 'mono', item.channel ? String(item.channel).slice(0, 10) : '—'),
          el('span', 'cell-sub', item.detail ? String(item.detail) : '—')
        ]));
      });
      list.body.appendChild(t.node);
    }
    view.appendChild(list.node);
  }

  function render() {
    view.textContent = '';
    if (!data) return;
    who.textContent = data.member.name + (data.org ? ' · ' + data.org.name : '') + ' · ' + data.member.role;
    conn.textContent = '';
    conn.appendChild(el('span', 'dot'));
    conn.appendChild(el('span', null, data.counts.online > 0 ? data.counts.online + ' 台在线' : '无设备在线'));
    conn.className = 'tag' + (data.counts.online > 0 ? ' tag-ok' : '');
    if (tab === 'overview') renderOverview();
    else if (tab === 'devices') renderDevices();
    else if (tab === 'channels') renderChannels();
    else renderAudit();
  }

  function load() {
    fetch('/v1/console/state', { credentials: 'same-origin' }).then(function (res) {
      if (res.status === 401) {
        if (sessionAuth) { location.href = '/v1/auth/feishu/start?next=console'; return; }
        conn.textContent = '未启用登录';
        fail('这台服务器没有开启飞书登录（PLAITCODE_AUTH_APP_ID / SECRET / REDIRECT_URI），控制台不可用。');
        return;
      }
      return res.json().then(function (payload) {
        if (!payload.ok) { fail(payload.error || '读取失败'); return; }
        data = payload;
        render();
      });
    }).catch(function () { fail('读取失败：中继没有响应，请检查服务是否在运行。'); });
  }

  function selectTab(name) {
    tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (link) {
      if (link.getAttribute('data-tab') === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      selectTab(link.getAttribute('data-tab'));
      if (history.replaceState) history.replaceState(null, '', '#' + tab);
      render();
    });
  });

  document.getElementById('logout').addEventListener('click', function (event) {
    event.preventDefault();
    fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(function () {
      location.href = '/';
    });
  });

  var initial = (location.hash || '').replace('#', '');
  if (initial && document.querySelector('#tabs a[data-tab="' + initial + '"]')) selectTab(initial);

  if (!sessionAuth) banner('服务端未配置飞书登录，控制台数据接口会拒绝请求。配置 PLAITCODE_AUTH_APP_ID / SECRET / REDIRECT_URI 后重启中继即可。');
  load();
})();
</script>
</body>
</html>`;
}
