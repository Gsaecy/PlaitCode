/**
 * webview「白屏」的判定与自愈。
 *
 * 现场（2026-11-26）：对话框和设置界面同时变成一片空白，而团队群窗口（另一个
 * webview）正常。查证的两件事：
 *  1. 打包出去的界面本身是好的 —— 把 `html()` 的真实产物放进 Chromium，12 个脚本
 *     全部加载、整套 UI 都画出来了，只有 `acquireVsCodeApi` 这一条预期内的报错；
 *  2. 扩展宿主在 07:39 被 VS Code 标成 unresponsive（同一台机器上 00:21、23:17 也出现过）。
 *
 * 也就是说：界面代码没问题，是 webview **没拿到内容**（宿主把 html 赋上去之前被卡住、
 * 或者 webview 的 iframe 被销毁后没有重建）。这种情况在 VS Code 里只有一种确定有效的
 * 修法：**重新赋值 `webview.html`** —— 它会把 iframe 连同里面的脚本整个重建一遍。
 *
 * 所以这里做两件事：
 *  - 面板侧：赋完 html 起一个看门狗，等到 webview 报 `ready`；超时就自己重赋一次
 *    （最多 `WEBVIEW_MAX_RECOVERIES` 次，避免真的坏掉时无限重试）；
 *  - 用户侧：一条命令「重新加载界面」立刻重赋，不必重载整个窗口。
 *
 * 判据是纯函数，测试直接执行它。
 */

/** 等到 `ready` 的最长时间。VS Code 自己的视图解析预算也在秒级，8 秒足够。 */
export const WEBVIEW_READY_TIMEOUT_MS = 8_000;
/** 自动重赋的次数上限：连续两次都不行就说明不是「没拿到内容」，别再刷。 */
export const WEBVIEW_MAX_RECOVERIES = 2;

export interface WebviewHealth {
  /** 上次把 html 赋给 webview 的时刻（0 = 还没赋过）。 */
  htmlSetAt: number;
  /** webview 报 `ready` 的时刻（0 = 还没报过）。 */
  readyAt: number;
  /** 已经自动重赋过几次。 */
  recoveries: number;
}

export function freshWebviewHealth(): WebviewHealth {
  return { htmlSetAt: 0, readyAt: 0, recoveries: 0 };
}

export type WebviewHealthVerdict =
  /** 已经报过 ready（在最近一次赋值之后）。 */
  | 'ready'
  /** 还没到超时，继续等。 */
  | 'waiting'
  /** 超时且还有重试额度：重赋 html。 */
  | 'recover'
  /** 超时但额度用完：只记日志，别再无谓重试。 */
  | 'give-up';

export function webviewHealthVerdict(
  health: WebviewHealth,
  now: number,
  timeoutMs = WEBVIEW_READY_TIMEOUT_MS,
): WebviewHealthVerdict {
  if (!health.htmlSetAt) return 'waiting';
  if (health.readyAt && health.readyAt >= health.htmlSetAt) return 'ready';
  if (now - health.htmlSetAt < timeoutMs) return 'waiting';
  return health.recoveries >= WEBVIEW_MAX_RECOVERIES ? 'give-up' : 'recover';
}

/** 记一次「html 已经赋值」。 */
export function markHtmlSet(health: WebviewHealth, at: number): WebviewHealth {
  return { htmlSetAt: at, readyAt: 0, recoveries: health.recoveries };
}

/** 记一次「webview 报 ready」。 */
export function markReady(health: WebviewHealth, at: number): WebviewHealth {
  return { htmlSetAt: health.htmlSetAt, readyAt: at, recoveries: health.recoveries };
}

/** 记一次「重赋 html」：时刻归零、ready 清掉、额度 +1。 */
export function markRecovered(health: WebviewHealth, at: number): WebviewHealth {
  return { htmlSetAt: at, readyAt: 0, recoveries: health.recoveries + 1 };
}

/**
 * 心跳：界面每 5 秒报一次「我还活着」。
 *
 * 为什么需要它（用户 2026-11-26：「怎么解决呢」）：
 * 白屏最狠的一种形态是 **webview 渲染进程死了**（一次状态推送几十 MB 就够），
 * 而 VS Code 会把那块**已经死掉的** iframe 留着 —— 它不再执行任何脚本，也不会再
 * 调 `resolveWebviewView`。看门狗只等 `ready`，一次就够；死了之后再没有任何信号。
 *
 * 有了心跳，宿主就能发现「它不吭声了」，重新赋一次 `webview.html`（= 重建 iframe）。
 */
export const WEBVIEW_HEARTBEAT_INTERVAL_MS = 5_000;
/** 多久没心跳就认定渲染进程已经死了。留出三次的余量，避免偶发卡顿就重建。 */
export const WEBVIEW_HEARTBEAT_TIMEOUT_MS = 16_000;
/** 一次会话里最多靠心跳重建几次（真坏了也别无限重建）。 */
export const WEBVIEW_HEARTBEAT_MAX_RECOVERIES = 3;

export type HeartbeatVerdict = 'ok' | 'waiting' | 'rebuild' | 'give-up';

/**
 * 心跳判定。
 *
 * @param lastPingAt 最后一次收到心跳的时刻（0 = 还没收到过）
 * @param htmlSetAt 最后一次赋 HTML 的时刻（0 = 还没赋过，那就不是心跳能管的问题）
 * @param rebuilds 已经因为心跳重建过几次
 */
export function heartbeatVerdict(input: {
  visible: boolean;
  lastPingAt: number;
  htmlSetAt: number;
  rebuilds: number;
  now: number;
}): HeartbeatVerdict {
  // 没赋过 HTML：这不是「渲染进程死了」，是视图没被解析 —— 交给 `shouldHealStaleView`。
  if (!input.htmlSetAt) return 'ok';
  // 视图不可见时不判：后台标签页的定时器会被节流，误判会白重建。
  if (!input.visible) return 'ok';
  const reference = Math.max(input.lastPingAt, input.htmlSetAt);
  const silent = input.now - reference;
  if (silent < WEBVIEW_HEARTBEAT_TIMEOUT_MS) return input.lastPingAt ? 'ok' : 'waiting';
  return input.rebuilds >= WEBVIEW_HEARTBEAT_MAX_RECOVERIES ? 'give-up' : 'rebuild';
}

/** 界面侧未捕获错误：只记一行日志（不进群、不进对话）。 */
export function webviewErrorMessage(payload: { kind?: unknown; message?: unknown; detail?: unknown } | undefined): string {
  const kind = typeof payload?.kind === 'string' ? payload.kind : 'error';
  const message = typeof payload?.message === 'string' ? payload.message.slice(0, 400) : '（没有消息）';
  const detail = typeof payload?.detail === 'string' ? payload.detail.replace(/\s+/g, ' ').slice(0, 300) : '';
  return `[webview] 界面报错（${kind}）：${message}${detail ? `｜${detail}` : ''}`;
}

/** 用户手动点「重新加载界面」：额度重新给满（人明确要求了，就不该被自动额度挡住）。 */
export function markManualReload(health: WebviewHealth, at: number): WebviewHealth {
  return { htmlSetAt: at, readyAt: 0, recoveries: 0 };
}

/**
 * 宿主重启后「视图还在、但已经没人管」的自救判定。
 *
 * 现场（用户 2026-11-26 亲口纠正）：「我装完 0.4.32 版本扩展刚开始界面是好的、正常的，
 * 后面才变成空白的。」
 *
 * 日志时间线印证了这句话，也印证了另一个更严重的状态：
 *  - 09:04:01 宿主 A → 09:04:07 终止 → 09:04:08 宿主 B → 09:04:27 `HWChat activated.`；
 *  - 宿主 B 里**没有任何 `[webview] 开始解析`** —— 视图没有被重新解析；
 *  - 但界面上那块面板看起来是好的。
 *
 * 结论：那块面板是**宿主 A 留下的 iframe**。它渲染正常，却已经和新宿主断开（`postMessage`
 * 无处可去，状态永远停在旧画面）。等 VS Code 真把这块 iframe 回收掉，就只剩空白。
 * 「刚开始是好的，后面才空白」正是这个过程。
 *
 * 所以要在激活后主动查一次：**上次打开过这个视图、但这次没拿到句柄** ⇒ 说明视图是残留的，
 * 立刻重新解析并重赋 HTML。判据在这里，行为在 `ChatPanel`/`extension.ts`。
 */
export const STALE_VIEW_CHECK_DELAY_MS = 2_500;
/** 最多主动自救几次（两次之间隔一个检查周期），避免真的不允许显示时反复抢焦点。 */
export const STALE_VIEW_MAX_HEALS = 2;

export function shouldHealStaleView(input: {
  /** 上次会话里这个视图被打开过（workspaceState 里记的标记）。 */
  wasOpen: boolean;
  /** 本次激活后是否已经拿到视图句柄（= VS Code 已经重新解析）。 */
  hasView: boolean;
  /** 已经主动自救过几次。 */
  attempts: number;
}): boolean {
  if (input.hasView) return false;
  if (!input.wasOpen) return false;
  return input.attempts < STALE_VIEW_MAX_HEALS;
}
