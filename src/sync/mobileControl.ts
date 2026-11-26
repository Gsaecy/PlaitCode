/**
 * 手机遥控：进门凭证、状态打包、手机页面。
 *
 * 这里只放**纯逻辑**（不 import vscode、不碰网络），网络那层在 `lanSync.ts`，
 * 这样校验规则和页面都能在 Node 里直接测。
 *
 * 为什么手机端要单独一套凭证：局域网同步用的是「每个请求都带配对码」，
 * 那是机器对机器的用法；浏览器地址栏、历史记录、截图都会留下痕迹，
 * 所以手机走「一次性 6 位码 → 12 小时会话 Cookie」，码可以随时重发、作废。
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { SyncGroupMessage, SyncPeer } from './lanProtocol';

export const MOBILE_PATH = '/m';
export const MOBILE_COOKIE = 'hwchat_m';
/** 6 位码的有效期：够你从电脑走到手机输完，又不至于长期贴在屏幕上。 */
export const MOBILE_CODE_TTL_MS = 10 * 60_000;
/** 会话有效期：一天一换，不用每次进页面都输码。 */
export const MOBILE_SESSION_TTL_MS = 12 * 60 * 60_000;
/** 同一来源连续输错这么多次就锁一段时间。 */
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;

export interface MobileApprovalView {
  id: string;
  title: string;
  summary: string;
  detail: string;
  /** `dangerous` 是删库、`curl | sh` 那类：手机上会单独标红。 */
  risk: 'read' | 'write' | 'command' | 'dangerous';
  at: number;
}

export interface MobileStatePayload {
  device: string;
  /** 本机（电脑那台）的设备 id：回执里显示「你」而不是一串 id。 */
  localId?: string;
  role: 'off' | 'hub' | 'peer';
  peers: SyncPeer[];
  messages: SyncGroupMessage[];
  /** 这一轮在做的项目：手机上也要看得见「在哪个项目里干活」。 */
  projectName?: string;
  /**
   * 每条消息谁读过（消息 id → **设备显示名**）。
   *
   * 桌面群窗口一直有「已读 / 等待确认收到」，手机上不给就没法判断「另一台到底收到没有」。
   * 已经是名字，不是 id —— 手机端不认识 id，直接显示会是一串哈希。
   */
  reads?: Record<string, string[]>;
  /** 设备 id → 统一标识（系统 · 设备名）。手机端任何地方都用它代替 id。 */
  labels?: Record<string, string>;
  /** 当前阶段（谈 / 等确认 / 执行）与它的中文说法。 */
  phase?: 'negotiate' | 'awaiting-approval' | 'implement';
  phaseLabel?: string;
  /**
   * 两个 agent 之间的往来（`team_sync action=send/ask`）。
   *
   * 用户 2026-11-26：「让 agent 的消息也像用户消息一样，能被相互看见，
   * 唯一约束看不看得见的是 @某个 agent 的行为」。以前这些只在电脑的 `team_sync status`
   * 里能看到，手机上完全看不到 —— 于是「两个 agent 在讨论」这件事对甲方是隐形的。
   */
  dialogue?: {
    id: string;
    who: string;
    body: string;
    at: number;
    /** 本机收到它的时刻（排序依据）。 */
    receivedAt?: number;
    replyTo: string;
    /** 点名给谁（设备 id）；空 = 群里每一台。 */
    to?: string;
    toLabel?: string;
  }[];
  openQuestion?: {
    requirementId: string;
    body: string;
    askerId?: string;
    askerLabel?: string;
    options?: string[];
  };
  approvals: MobileApprovalView[];
  canApprove: boolean;
}

/** 6 位数字码 → 会话令牌。 */
export class MobileGate {
  private code = '';
  private codeExpires = 0;
  private readonly sessions = new Map<string, number>();
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 生成（或沿用）当前 6 位码，电脑端显示这个码 / 用它拼二维码。 */
  issueCode(): { code: string; expiresAt: number } {
    if (!this.code || this.now() >= this.codeExpires) {
      this.code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      this.codeExpires = this.now() + MOBILE_CODE_TTL_MS;
    }
    return { code: this.code, expiresAt: this.codeExpires };
  }

  currentCode(): { code: string; expiresAt: number } {
    return this.code ? { code: this.code, expiresAt: this.codeExpires } : this.issueCode();
  }

  /** 换一张新码（旧码立刻作废）。用户担心码泄露时点一下就行。 */
  rotate(): { code: string; expiresAt: number } {
    this.code = '';
    this.codeExpires = 0;
    return this.issueCode();
  }

  /**
   * 用 6 位码换会话令牌。
   *
   * 输错要计数：有人在同一 WiFi 上穷举六位数的话，最多试五次就被锁五分钟，
   * 穷举一百万种可能得花几年。
   */
  redeem(input: string, client = ''): { ok: true; token: string; expiresAt: number } | { ok: false; error: string } {
    const locked = this.lockUntil(client);
    if (locked > this.now()) return { ok: false, error: '试错太多次，请等几分钟再试。' };
    const current = this.currentCode();
    if (this.now() >= current.expiresAt) {
      this.issueCode();
      return { ok: false, error: '验证码已过期，请让电脑上重新显示。' };
    }
    const expected = Buffer.from(current.code, 'utf8');
    const actual = Buffer.from(String(input ?? '').replace(/\D/g, '').slice(0, 6).padEnd(expected.length, '\0'), 'utf8');
    const match = actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!match) {
      this.fail(client);
      return { ok: false, error: '验证码不对，请看电脑上「手机遥控」窗口里的 6 位数字。' };
    }
    this.failures.delete(client);
    // 一个码只用一次：换完就失效，别人再看到这张码也进不来。
    this.code = '';
    const token = randomBytes(24).toString('hex');
    const expiresAt = this.now() + MOBILE_SESSION_TTL_MS;
    this.sessions.set(token, expiresAt);
    return { ok: true, token, expiresAt };
  }

  /** 会话是否还有效（顺手清掉过期的）。 */
  authorize(token: string | undefined): boolean {
    if (!token) return false;
    const expiresAt = this.sessions.get(token);
    if (!expiresAt) return false;
    if (this.now() >= expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  lockUntil(client: string): number {
    return this.failures.get(client)?.until ?? 0;
  }

  private fail(client: string): void {
    const entry = this.failures.get(client) ?? { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.count = 0;
      entry.until = this.now() + LOCK_MS;
    }
    this.failures.set(client, entry);
  }
}

/** 浏览器 Cookie 头 → 键值对。 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    result[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

/**
 * 会话 Cookie。
 *
 * `HttpOnly` 防页面脚本偷；`SameSite=Strict` 防别的网站拿用户的浏览器发请求。
 * 局域网是明文 HTTP，所以这里没有 `Secure` —— 手机上会看到「不安全」，
 * 这是局域网直连的真实代价，走隧道时才有 HTTPS。
 */
export function mobileCookie(token: string, maxAgeSeconds: number): string {
  const base = `${MOBILE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
  return base;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 手机页面：一个文件装完，没有外部资源，断网也能打开（只是看不到新消息）。
 *
 * 排版按飞书 / 微信的即时通讯习惯（用户 2026-11-26：「按照飞书、微信的对话显示逻辑」）：
 *  - 别人的消息：左侧头像 + 名字，气泡贴着左边；自己的消息贴右边，不画头像；
 *  - 同一个人的连续几条**合并成一组**：只有第一条带名字，间距收紧；
 *  - 时间不是每条都写：间隔超过 5 分钟插一条居中时间分隔，跨天写「昨天 / M月D日」；
 *  - 二维码 / 阶段这类元信息收进气泡里的小标签，不占据对话主视线；
 *  - 底部是输入条：圆角输入框 + 圆形发送键，安全区留白；指派与停止收在其上一行。
 *
 * 另一条硬规则：自己刚发的那条**立刻出现**（微信就是这样），不等服务端回声 ——
 * 否则等待期间看到的是「乙方的回复先到、我的话还没出现」，看起来像回复跑到了提问上面。
 */
export function renderMobilePage(options: { device: string; authed: boolean; canApprove: boolean }): string {
  const device = escapeHtml(options.device);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1115">
<meta name="color-scheme" content="dark">
<title>HWChat · ${device}</title>
<style>
  :root {
    --bg: #0d0f13; --panel: #14171d; --panel2: #1c2029; --panel3: #232833;
    --line: #262b35; --text: #e8eaee; --muted: #8b93a1; --faint: #6b7383;
    --brand: #4c9aff; --brand-ink: #05121f; --warn: #f0b429; --ok: #34d399; --bad: #f87171;
    --out: #1f4b7d; --out-line: #2b5f9b;
    --radius: 16px;
    --safe-b: env(safe-area-inset-bottom, 0px);
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  /*
   * 手机自适应（用户 2026-11-26：「手机上的显示没有自适应手机屏幕尺寸」）。
   *
   * 三个要点：
   *  1. 高度用 100dvh（用 100% 时，带地址栏或键盘的移动浏览器会算错，底部输入条被推到屏幕外）；
   *  2. 字号 / 间距在窄屏（≤380px）收紧一档，宽屏（≥600px，平板 / 横屏）放宽；
   *  3. 气泡宽度按百分比 + 强制换行，长英文 / 路径绝不撑出横向滚动。
   */
  html, body { margin: 0; height: 100%; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    background: var(--bg); color: var(--text);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    display: flex; flex-direction: column; overscroll-behavior-y: contain;
    min-height: 100vh; height: 100dvh; width: 100%; overflow: hidden;
  }
  /* 顶部：标题 + 状态 + 当前项目（飞书那种紧凑两行头） */
  header {
    padding: 10px 14px calc(10px + 2px); background: rgba(20,23,29,.92);
    border-bottom: 1px solid var(--line); backdrop-filter: blur(12px);
    position: sticky; top: 0; z-index: 20;
    display: grid; grid-template-columns: auto 1fr auto; gap: 2px 8px; align-items: center;
  }
  header .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); grid-row: span 2; }
  header .dot.on { background: var(--ok); box-shadow: 0 0 0 3px rgba(52,211,153,.16); }
  header .name { font-weight: 600; font-size: 15px; letter-spacing: .2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header .role { font-size: 11px; color: var(--faint); justify-self: end; }
  header .where { grid-column: 2 / 4; font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header .where:empty { display: none; }
  header .agents { grid-column: 2 / 4; font-size: 11px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header .agents:empty { display: none; }

  main { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 12px 18px; -webkit-overflow-scrolling: touch; scroll-behavior: smooth; scrollbar-width: none; }
  main::-webkit-scrollbar { width: 0; height: 0; }
  /* 窄屏（大多数手机竖屏）收紧一档；宽屏（平板 / 横屏）放宽并给内容一个上限宽度。 */
  @media (max-width: 380px) {
    main { padding: 10px 8px 14px; }
    .bubble { font-size: 14.5px; padding: 7px 10px; }
    .col { max-width: 82%; }
    header { padding: 8px 10px; }
    footer { padding: 6px 8px calc(6px + var(--safe-b)); }
  }
  @media (min-width: 600px) {
    main { padding: 16px 20px 20px; }
    .col { max-width: 66%; }
    footer { padding: 10px 20px calc(10px + var(--safe-b)); }
    header { padding: 12px 20px; }
  }

  /* 时间分隔：居中细字，和微信一致 */
  .divider { text-align: center; margin: 14px 0 10px; font-size: 11.5px; color: var(--faint); letter-spacing: .3px; }
  .divider:first-child { margin-top: 0; }

  .msg { display: flex; gap: 8px; margin: 0 0 4px; align-items: flex-start; }
  .msg.group-start { margin-top: 12px; }
  .msg.out { justify-content: flex-end; }
  .avatar {
    flex: 0 0 30px; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
    font-size: 12.5px; font-weight: 700; color: #0b1220; background: #8ea7c8; user-select: none;
  }
  .avatar.blank { visibility: hidden; }
  .col { min-width: 0; max-width: 78%; display: flex; flex-direction: column; gap: 3px; }
  .msg.out .col { align-items: flex-end; }
  .who { font-size: 11.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; padding-left: 2px; min-width: 0; }
  .who .name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bubble {
    position: relative; padding: 8px 11px; border-radius: var(--radius);
    background: var(--panel2); border: 1px solid var(--line);
    white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; font-size: 15px; line-height: 1.55;
  }
  /* 尖端：自己贴右下、别人贴左上，形成微信式的「气泡尾巴」 */
  .msg.in .bubble { border-top-left-radius: 6px; }
  .msg.out .bubble { border-top-right-radius: 6px; background: var(--out); border-color: var(--out-line); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
  .chip-tag { font-size: 10.5px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--line); color: var(--muted); }
  .chip-tag.question { color: var(--warn); border-color: rgba(240,180,41,.45); }
  .chip-tag.result { color: var(--ok); border-color: rgba(52,211,153,.45); }
  .chip-tag.requirement { color: var(--brand); border-color: rgba(76,154,255,.45); }
  .msg.out .chip-tag { color: rgba(255,255,255,.72); border-color: rgba(255,255,255,.24); }
  .foot { font-size: 10.5px; color: var(--faint); padding: 0 2px; }
  .msg.out .foot { text-align: right; }
  .foot.waiting { color: var(--warn); }

  /* 追问 / 授权：做成飞书那种卡片，主操作在右侧 */
  .card { border: 1px solid var(--line); background: var(--panel); border-radius: 14px; padding: 11px 12px; margin: 0 0 12px; }
  .card.ask { border-color: rgba(240,180,41,.45); background: rgba(240,180,41,.07); }
  .card.danger { border-color: rgba(248,113,113,.5); background: rgba(248,113,113,.07); }
  .card .title { font-size: 13.5px; font-weight: 650; margin-bottom: 5px; display: flex; gap: 6px; align-items: center; }
  .card .body { font-size: 13px; color: var(--muted); white-space: pre-wrap; word-break: break-word; max-height: 8em; overflow: auto; }
  .card .actions { display: flex; gap: 8px; margin-top: 10px; }
  .opts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .opts button { flex: 0 0 auto; font-size: 13px; padding: 7px 13px; border-radius: 999px;
    border: 1px solid rgba(240,180,41,.55); background: transparent; color: #f3d08a; }
  .card-close { margin-left: auto; width: 26px; height: 26px; border: 0; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; }

  button { font: inherit; }
  .btn { flex: 1; padding: 10px 14px; border-radius: 11px; font-size: 14.5px; font-weight: 600;
    border: 1px solid var(--line); background: var(--panel3); color: var(--text); }
  .btn.primary { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
  .btn.danger { background: transparent; border-color: rgba(248,113,113,.6); color: var(--bad); }
  .btn:disabled { opacity: .5; }

  /* 底部：指派 chip → 输入条 → 停止 */
  footer {
    position: sticky; bottom: 0; z-index: 20; background: rgba(20,23,29,.96);
    border-top: 1px solid var(--line); backdrop-filter: blur(12px);
    padding: 8px 12px calc(8px + var(--safe-b)); display: flex; flex-direction: column; gap: 7px;
  }
  .assign { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  .assign::-webkit-scrollbar { display: none; }
  .assign .chip { flex: 0 0 auto; padding: 5px 11px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
    border: 1px solid var(--line); background: var(--panel2); color: var(--muted); }
  .assign .chip.on { background: rgba(76,154,255,.18); border-color: rgba(76,154,255,.6); color: #a8cdfd; }
  .assign .hint { flex: 0 0 auto; font-size: 12px; color: var(--faint); align-self: center; }
  .compose { display: flex; gap: 8px; align-items: flex-end; }
  textarea {
    flex: 1; resize: none; min-height: 40px; max-height: 120px; padding: 9px 13px; border-radius: 20px;
    background: var(--panel2); color: var(--text); border: 1px solid var(--line); font: inherit; font-size: 15px; line-height: 1.4;
  }
  textarea:focus { outline: none; border-color: rgba(76,154,255,.55); }
  .send-btn {
    flex: 0 0 42px; width: 42px; height: 42px; border-radius: 50%; border: 0; padding: 0;
    background: var(--brand); color: var(--brand-ink); display: grid; place-items: center; font-size: 17px; font-weight: 700;
  }
  .send-btn:disabled { opacity: .45; }
  .stop-row { display: flex; justify-content: center; }
  .stop-row .btn { flex: 0 0 auto; font-size: 12px; padding: 5px 14px; border-radius: 999px; border-color: rgba(248,113,113,.45); background: transparent; }

  #jump { position: fixed; right: 14px; bottom: calc(112px + var(--safe-b)); width: 38px; height: 38px; border-radius: 50%;
    border: 1px solid var(--line); background: var(--panel3); color: var(--text); display: none; place-items: center; font-size: 15px; }
  .empty { color: var(--faint); text-align: center; font-size: 13.5px; padding: 48px 24px; }

  form.login { padding: 32px 20px; }
  form.login h1 { font-size: 19px; margin: 0 0 8px; letter-spacing: .2px; }
  form.login p { color: var(--muted); font-size: 13.5px; margin: 0 0 24px; line-height: 1.6; }
  input.code { width: 100%; padding: 15px; border-radius: 14px; background: var(--panel2); color: var(--text);
    border: 1px solid var(--line); font-size: 30px; letter-spacing: 10px; text-align: center; font-variant-numeric: tabular-nums; }
  form.login .btn { width: 100%; margin-top: 14px; padding: 13px; }
  .err { color: var(--bad); font-size: 13px; min-height: 20px; margin-top: 12px; text-align: center; }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <span class="name">HWChat · ${device}</span>
  <span class="role" id="role"></span>
  <span class="where" id="where"></span>
  <span class="agents" id="agents"></span>
</header>
${options.authed ? '<main id="main"><div class="empty">正在连接…</div></main><button id="jump" type="button" aria-label="回到最新">↓</button><footer>'
  + '<div class="assign" id="assign"></div>'
  + '<div class="compose"><textarea id="input" rows="1" placeholder="说点什么…"></textarea>'
  + '<button class="send-btn" id="send" type="button" aria-label="发送">↑</button></div>'
  + '<div class="stop-row"><button class="btn danger" id="stop" type="button">停止执行（群里所有设备）</button></div>'
  + '</footer>' : `<main><form class="login" id="login">
  <h1>连接到这台电脑</h1>
  <p>在电脑上打开「HWChat：手机遥控」，把那里的 6 位数字填进来。也可以直接扫那张二维码。</p>
  <input class="code" id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000">
  <button class="btn primary" type="submit">进入团队群</button>
  <div class="err" id="err"></div>
</form></main>`}
<script>
(function () {
  var authed = ${options.authed ? 'true' : 'false'};
  var canApprove = ${options.canApprove ? 'true' : 'false'};
  var PHASES = { requirement: '需求', analysis: '解析', question: '追问', answer: '回复', confirm: '确认', progress: '进度', result: '结果' };
  /** 两条消息间隔超过它才插时间分隔（微信是 5 分钟）。 */
  var GAP_MS = 5 * 60 * 1000;
  /** 同一个人的连续消息在这个时间内合并成一组（不重复画名字、间距收紧）。 */
  var GROUP_MS = 2 * 60 * 1000;

  if (!authed) {
    var params = new URLSearchParams(location.search);
    var preset = params.get('c');
    var codeInput = document.getElementById('code');
    if (preset && /^[0-9]{6}$/.test(preset)) {
      codeInput.value = preset;
      history.replaceState(null, '', location.pathname);
      login(preset);
    }
    document.getElementById('login').addEventListener('submit', function (event) {
      event.preventDefault();
      login(codeInput.value);
    });
    return;
  }

  var main = document.getElementById('main');
  var input = document.getElementById('input');
  var send = document.getElementById('send');
  var assignBar = document.getElementById('assign');
  var stopButton = document.getElementById('stop');
  var jump = document.getElementById('jump');
  /* 选中「由谁执行」的设备 id；null = 所有人（和其它设备上的语义一致）。 */
  var assignee = null;
  var signature = '';
  /* 本机收起过的那条「等你回答」（只影响显示，不影响问题本身）。 */
  var dismissedQuestion = '';
  var busy = false;
  /** 本机设备 id：回执里「你自己」要显示成「你」而不是一串 id。 */
  var localId = '';
  /* 自己刚发出、还没在服务端状态里出现的消息（先画出来，微信也是这样）。 */
  var pendingLocal = null;
  var lastPeers = [];

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hwchat-mobile': '1' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    }).then(function (response) { return response.json().catch(function () { return {}; }); });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function pad(value) { return ('0' + value).slice(-2); }

  function timeOf(at) {
    var date = new Date(at);
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  /**
   * 时间分隔的文字：今天只给「HH:MM」，昨天写「昨天 HH:MM」，更早写日期。
   * 微信/飞书都是这个规则 —— 每条都印时间只会把对话切碎。
   */
  function dividerText(at) {
    var date = new Date(at);
    var now = new Date();
    var sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    if (sameDay) return timeOf(at);
    var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    var isYesterday = date.getFullYear() === yesterday.getFullYear()
      && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate();
    if (isYesterday) return '昨天 ' + timeOf(at);
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + timeOf(at);
  }

  /* 身份标识：系统类型 · 设备名（与电脑端同一写法）。 */
  function deviceLabelOf(peer) {
    if (!peer) return '乙方';
    var raw = String(peer.name || '').trim();
    var name = raw.replace(/\\s*[·•]\\s*(win32|windows|darwin|macos|osx|linux|android|web)\\s*$/i, '').trim() || raw;
    if (peer.version === 'web' || /浏览器/.test(name)) return '手机 · 浏览器';
    var os = peer.platform === 'darwin' ? 'macOS' : (peer.platform === 'win32' ? 'Windows' : 'Linux');
    return name ? os + ' · ' + name : os;
  }

  /**
   * 设备 id → 名字。
   *
   * 用户 2026-11-26：「手机上显示的设备都是一串字母数字」—— 主机现在会把
   * labels（id → 系统 · 设备名）一起发过来，这里优先用它；实在查不到就给可读兜底，
   * **绝不把 id 显示到界面上**。
   */
  function labelOfId(id, peer) {
    if (!id) return '';
    var labels = (lastState && lastState.labels) || {};
    if (labels[id]) return labels[id];
    /* 消息自带 from（含 name / platform）时优先用它：对端刚断线也照样显示得出来。 */
    if (peer && peer.name) return deviceLabelOf(peer);
    var known = lastPeers.filter(function (item) { return item.id === id; })[0];
    return known ? deviceLabelOf(known) : '已离开的设备';
  }

  /**
   * 回执里的「谁读过」。
   *
   * 主机发的 reads 已经是**名字**（lanSync.mobileState() 用 labelForPeerId 翻好），
   * 所以这里只把「本机自己」写成「你」，其余原样显示。
   */
  function readLabelOf(name) {
    var text = String(name || '');
    if (!text) return '';
    /* 主机给本机打的是「名字（本机）」；手机上显示「本机」比显示一长串更清楚。 */
    return /（本机）$/.test(text) ? '本机' : text;
  }

  /**
   * 头像文字：取**设备名**的首字，不要拿「Windows ·」这种前缀。
   *
   * 之前直接取 label 首字母，于是每台都显示成 'W' / 'M'（系统名的首字母），
   * 两台设备分不出来 —— 用户 2026-11-26 的反馈里就是「一堆分不清的东西」。
   */
  function avatarLetterOf(label) {
    var text = String(label || '').replace(/（本机）$/, '').trim();
    var tail = text.split(/[·•]/).pop() || text;
    var cleaned = tail.trim().replace(/^[^0-9A-Za-z\u4e00-\u9fa5]+/, '');
    return (cleaned || text || '乙').slice(0, 1).toUpperCase();
  }

  /** 头像：取设备名首字，配上按 id 派生的稳定底色。 */
  var AVATAR_COLORS = ['#8ea7c8', '#c8a68e', '#9ec89e', '#c89ea7', '#a79ec8', '#c8c29e'];
  function avatarFor(peer, label) {
    var seed = String((peer && peer.id) || label || '');
    var sum = 0;
    for (var i = 0; i < seed.length; i += 1) sum = (sum + seed.charCodeAt(i)) % 9973;
    var node = el('span', 'avatar', avatarLetterOf(label));
    node.style.background = AVATAR_COLORS[sum % AVATAR_COLORS.length];
    return node;
  }

  function render(state) {
    lastState = state;
    document.getElementById('dot').className = 'dot' + (state.role === 'off' ? '' : ' on');
    document.getElementById('role').textContent = state.phaseLabel
      ? state.phaseLabel
      : (state.role === 'hub' ? '主机' : state.role === 'peer' ? '已连接' : '单机');
    var where = document.getElementById('where');
    where.textContent = state.projectName ? '项目：' + state.projectName : '';
    where.title = state.projectName || '';
    /*
     * 群里有哪些 agent：电脑端是「群聊中 · 2 台设备」，手机上补一行名字，
     * 甲方才看得清这句需求会被哪几台接（用户 2026-11-26：要和电脑端对齐）。
     */
    var agents = document.getElementById('agents');
    var roster = (state.peers || []).filter(function (peer) { return peer.version !== 'web'; });
    agents.textContent = roster.length
      ? roster.length + ' 台设备：' + roster.map(deviceLabelOf).join('、')
      : '这台还没有其它设备加入';
    agents.title = agents.textContent;
    document.title = 'HWChat · ' + state.device;

    /*
     * 「由谁执行」先刷新：它不在消息签名里，但设备掉线后必须退回「所有人」，
     * 否则手机会发出一条**没人接**的需求（电脑端早就是这个规则）。
     */
    lastPeers = state.peers || [];
    localId = state.localId || '';
    renderAssign(state);

    var stick = main.scrollHeight - main.scrollTop - main.clientHeight < 90;
    var next = JSON.stringify([state.messages, state.dialogue, state.approvals, state.openQuestion, state.reads, pendingLocal]);
    if (next === signature) return;
    signature = next;

    main.innerHTML = '';
    var now = Date.now();
    var peers = state.peers || [];
    var byId = {};
    peers.forEach(function (peer) { byId[peer.id] = peer; });

    /* 收起过的追问不再占地方；同一台提了新问题（正文变了）会重新弹出来。 */
    var questionKey = state.openQuestion
      ? String(state.openQuestion.requirementId || '') + '|' + String(state.openQuestion.body || '')
      : '';
    if (state.openQuestion && questionKey !== dismissedQuestion) {
      var ask = el('div', 'card ask');
      var head = el('div', 'title', state.openQuestion.askerLabel
        ? state.openQuestion.askerLabel + ' 的乙方在等你回答'
        : '乙方在等你回答');
      var close = el('button', 'card-close', '×');
      close.type = 'button';
      close.addEventListener('click', function () {
        dismissedQuestion = questionKey;
        signature = '';
        ask.remove();
      });
      head.appendChild(close);
      ask.appendChild(head);
      ask.appendChild(el('div', 'body', state.openQuestion.body));
      if (state.openQuestion.options && state.openQuestion.options.length) {
        var opts = el('div', 'opts');
        state.openQuestion.options.forEach(function (option) {
          var button = el('button', null, option);
          button.type = 'button';
          button.addEventListener('click', function () {
            post('/m/send', { text: option, assignee: state.openQuestion.askerId }).catch(function () {});
          });
          opts.appendChild(button);
        });
        ask.appendChild(opts);
      }
      main.appendChild(ask);
    }
    (state.approvals || []).forEach(function (approval) {
      var risky = approval.risk === 'dangerous' || approval.risk === 'command';
      var card = el('div', 'card' + (risky ? ' danger' : ''));
      card.appendChild(el('div', 'title', (risky ? '⚠ ' : '') + approval.title));
      /* 换行必须是两个字符反斜杠+n：单写会被模板字符串换成真换行，把这一行劈断。 */
      card.appendChild(el('div', 'body', approval.summary + (approval.detail ? '\\n' + approval.detail : '')));
      if (canApprove) {
        var row = el('div', 'actions');
        var deny = el('button', 'btn danger', '拒绝');
        var allow = el('button', 'btn primary', '允许这次');
        deny.type = 'button';
        allow.type = 'button';
        deny.onclick = function () { decide(approval.id, false, row); };
        allow.onclick = function () { decide(approval.id, true, row); };
        row.appendChild(deny);
        row.appendChild(allow);
        card.appendChild(row);
      } else {
        card.appendChild(el('div', 'body', '这段需要在电脑上确认。'));
      }
      main.appendChild(card);
    });

    /*
     * 一条时间线里混两类东西：群发言（需求 / 解析 / 追问 / 进度 / 结果）与
     * **agent 之间的往来**（state.dialogue）。
     *
     * 用户 2026-11-26：「让 agent 的消息也像用户消息一样，能被相互看见，
     * 唯一约束看不看得见的是 @某个 agent 的行为」。所以这里把往来当成普通气泡画出来，
     * 只是左边标「队友对话 / 回复队友」，并注明有没有点名给谁。
     * 注意：这段注释在 TS 模板字符串里，注释里不能出现反引号（会提前结束模板）。
     */
    var messages = (state.messages || []).slice();
    (state.dialogue || []).forEach(function (note) {
      messages.push({
        id: note.id,
        author: 'agent',
        phase: note.replyTo ? 'answer' : 'analysis',
        body: note.body,
        at: note.at,
        receivedAt: note.receivedAt,
        from: { id: '', name: note.who },
        note: true,
        toLabel: note.toLabel || ''
      });
    });
    if (pendingLocal) messages.push(pendingLocal);
    messages.sort(function (left, right) {
      var a = Number(left.receivedAt) || Number(left.at) || 0;
      var b = Number(right.receivedAt) || Number(right.at) || 0;
      if (a !== b) return a - b;
      return (Number(left.at) || 0) - (Number(right.at) || 0);
    });
    var previous = null;
    var lastAt = 0;
    messages.forEach(function (message, index) {
      var mine = message.author === 'user';
      var at = Number(message.at) || Date.now();
      var peer = message.from || byId[message.from && message.from.id] || null;
      /*
       * 名字：优先用主机给的 labels（id → 系统 · 设备名）；
       * agent 之间的往来（dialogue）主机已经给好了整串标识，直接用，不要再拼一次平台前缀。
       */
      var label = mine ? '你' : (message.note ? String(message.from && message.from.name || '队友') : labelOfId(message.from && message.from.id, message.from));
      /* 时间分隔：跨天或间隔超过 5 分钟。 */
      var dayChanged = !previous || new Date(previous.at).toDateString() !== new Date(at).toDateString();
      if (!previous || dayChanged || at - lastAt > GAP_MS) {
        main.appendChild(el('div', 'divider', dividerText(at)));
        previous = null;
      }
      var sameSender = previous
        && previous.author === message.author
        && previous.from && peer && previous.from.id === peer.id
        && at - lastAt <= GROUP_MS;
      var wrap = el('div', 'msg ' + (mine ? 'out' : 'in') + (sameSender ? '' : ' group-start'));
      wrap.appendChild(mine ? el('span', 'avatar blank') : avatarFor(peer, label));
      var col = el('div', 'col');
      if (!mine && !sameSender) {
        col.appendChild(el('div', 'who', label));
      }
      var bubble = el('div', 'bubble');
      /* 阶段标签收进气泡顶部：需求 / 追问 / 结果才有信息量，其余折叠成小字。 */
      if (message.phase !== 'requirement' || !mine) {
        var chips = el('div', 'chips');
        chips.appendChild(el('span', 'chip-tag ' + message.phase, message.note
          ? (message.phase === 'answer' ? '回复队友' : '队友对话')
          : (PHASES[message.phase] || message.phase)));
        if (message.meta && message.meta.seconds) chips.appendChild(el('span', 'chip-tag', message.meta.seconds + 's'));
        /* 「@」是唯一能挡住「谁要处理」的东西，所以点名必须显示出来。 */
        if (message.toLabel) chips.appendChild(el('span', 'chip-tag', '@' + message.toLabel));
        bubble.appendChild(chips);
      }
      bubble.appendChild(el('div', null, message.body));
      col.appendChild(bubble);
      /*
       * 气泡下那一行：**每一条**都写已读状态。
       *
       * 用户 2026-11-26：「不管是 agent 还是用户的消息气泡下面都要显示已读状态，
       * 哪些 agent 已读了」。所以别人的气泡也点名「已读：X、Y」，不再只给甲方自己的话。
       * 没有回执时：自己的话写「等待确认收到」，别人的话只写时间。
       */
      var readBy = (state.reads && state.reads[message.id]) || [];
      var others = peers.filter(function (item) {
        var fromId = (message.from && message.from.id) || '';
        return item.id !== fromId && item.version !== 'web';
      });
      var nextMessage = messages[index + 1];
      var groupEnds = !nextMessage
        || nextMessage.author !== message.author
        || !nextMessage.from || !peer || nextMessage.from.id !== peer.id
        || (Number(nextMessage.at) || at) - at > GROUP_MS;
      if (message.pending) {
        col.appendChild(el('div', 'foot', '发送中…'));
      } else if (readBy.length) {
        /*
         * 自己的话里「本机已读」是废话，滤掉后只列别的设备；
         * 滤完为空就退到「等待确认收到」。
         */
        var shown = mine ? readBy.map(readLabelOf).filter(function (item) { return item !== '本机'; }) : readBy.map(readLabelOf);
        if (shown.length) {
          col.appendChild(el('div', 'foot', timeOf(at) + ' · 已读：' + shown.join('、')));
        } else if (mine && others.length) {
          col.appendChild(el('div', 'foot waiting', '等待确认收到：' + others.map(deviceLabelOf).join('、')));
        } else {
          col.appendChild(el('div', 'foot', timeOf(at)));
        }
      } else if (mine && others.length) {
        col.appendChild(el('div', 'foot waiting', '等待确认收到：' + others.map(deviceLabelOf).join('、')));
      } else if (groupEnds) {
        col.appendChild(el('div', 'foot', timeOf(at)));
      }
      wrap.appendChild(col);
      main.appendChild(wrap);
      previous = { author: message.author, from: message.from, at: at };
      lastAt = at;
    });
    if (!main.childNodes.length) {
      main.appendChild(el('div', 'empty', '还没有发言。说一句话，频道里的乙方都会收到。'));
    }
    if (stick) main.scrollTop = main.scrollHeight;
  }

  function decide(id, allow, row) {
    Array.prototype.forEach.call(row.children, function (node) { node.disabled = true; });
    post('/m/approve', { id: id, allow: allow }).then(function (result) {
      if (!result.ok) {
        Array.prototype.forEach.call(row.children, function (node) { node.disabled = false; });
        alert(result.error || '操作没成功，请在电脑上处理。');
      }
    }).catch(function () {
      Array.prototype.forEach.call(row.children, function (node) { node.disabled = false; });
    });
  }

  function refresh() {
    if (busy) return;
    busy = true;
    fetch('/m/state', { credentials: 'same-origin' })
      .then(function (response) {
        if (response.status === 401) { location.reload(); return undefined; }
        return response.json();
      })
      .then(function (state) {
        if (!state || !state.device) return;
        /* 服务端已经有了我刚才那条：撤掉本地预览，避免出现两条一样的。 */
        if (pendingLocal && (state.messages || []).some(function (message) {
          return message.author === 'user' && message.body === pendingLocal.body;
        })) {
          pendingLocal = null;
        }
        render(state);
      })
      .catch(function () { document.getElementById('dot').className = 'dot'; })
      .finally(function () { busy = false; });
  }

  function submit() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    send.disabled = true;
    /*
     * 自己的话**立刻**出现在最下面（微信就是这样）。
     *
     * 不这么做的话，等待期间看到的会是「乙方先回了」，用户会以为回复排到了自己
     * 那条上面 —— 这正是 2026-11-26 报的那个现象的一半成因。
     */
    pendingLocal = { id: 'pending-' + Date.now(), author: 'user', phase: 'requirement', body: text, at: Date.now(), from: null, pending: true };
    main.scrollTop = main.scrollHeight;
    signature = '';
    render(lastStateForRender());
    post('/m/send', assignee ? { text: text, assignee: assignee } : { text: text }).then(function (result) {
      if (!result.ok) {
        pendingLocal = null;
        input.value = text;
        alert(result.error || '没发出去，请重试。');
      }
      signature = '';
      refresh();
    }).catch(function () {
      pendingLocal = null;
      input.value = text;
      signature = '';
      refresh();
      alert('网络没连上。');
    }).finally(function () {
      send.disabled = false;
      input.focus();
    });
  }

  /** 重画用：把上一次的状态留一份（本地预览需要整份状态才能重排）。 */
  var lastState = null;
  function lastStateForRender() {
    return lastState || { device: '', role: 'off', peers: lastPeers, messages: [], approvals: [], reads: {} };
  }

  /**
   * 「由谁执行」：和电脑团队群同一套语义。
   *
   * - 默认「所有人」（广播）；点某台就只派给它；
   * - 选中的设备掉线了要**自动退回所有人**，否则手机发出一条没人接的需求；
   * - 设备名称用统一标识（系统 · 设备名），和电脑端显示一致。
   */
  function renderAssign(state) {
    var peers = (state.peers || []).filter(function (peer) { return peer.version !== 'web'; });
    if (assignee && !peers.some(function (peer) { return peer.id === assignee; })) assignee = null;
    assignBar.innerHTML = '';
    var all = el('button', 'chip' + (assignee ? '' : ' on'), '所有人');
    all.type = 'button';
    all.addEventListener('click', function () {
      assignee = null;
      signature = '';
      renderAssign(state);
    });
    assignBar.appendChild(all);
    peers.forEach(function (peer) {
      var chip = el('button', 'chip' + (assignee === peer.id ? ' on' : ''), deviceLabelOf(peer));
      chip.type = 'button';
      chip.addEventListener('click', function () {
        assignee = peer.id;
        signature = '';
        renderAssign(state);
      });
      assignBar.appendChild(chip);
    });
    if (!peers.length) assignBar.appendChild(el('span', 'hint', '只有本机'));
  }

  send.addEventListener('click', submit);
  /* 停止执行：和电脑群窗口那颗按钮走同一条服务端通道（broadcastStop），群里所有设备都停。 */
  if (stopButton) {
    stopButton.addEventListener('click', function () {
      if (!confirm('停止群里所有设备正在执行的任务？')) return;
      stopButton.disabled = true;
      post('/m/stop', {}).then(function (result) {
        alert(result.message || (result.ok ? '已通知各设备停手。' : '停止没成功，请在电脑上处理。'));
        signature = '';
        refresh();
      }).catch(function () { alert('网络没连上。'); })
        .finally(function () { stopButton.disabled = false; });
    });
  }
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  /* 滚上去看历史时显示「回到最新」，别让人自己滑回底部。 */
  main.addEventListener('scroll', function () {
    var away = main.scrollHeight - main.scrollTop - main.clientHeight > 200;
    jump.style.display = away ? 'grid' : 'none';
  });
  jump.addEventListener('click', function () { main.scrollTop = main.scrollHeight; });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  setInterval(refresh, 2500);
  refresh();

  function login(code) {
    var err = document.getElementById('err');
    err.textContent = '';
    post('/m/login', { code: code }).then(function (result) {
      if (result.ok) { location.replace('/m'); return; }
      err.textContent = result.error || '验证码不对。';
    }).catch(function () { err.textContent = '连不上这台电脑。'; });
  }
})();
</script>
</body>
</html>`;
}
