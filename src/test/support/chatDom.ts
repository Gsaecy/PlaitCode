/**
 * 把 `media/chat.js` 真的挂到一个 DOM 上（linkedom），用来**执行**界面行为。
 *
 * 为什么需要它：`media/chat.js` 是个 IIFE，内部函数拿不到；以前只能
 * 「读源码 + 正则断言」——源码改个写法就红、行为坏了却可能绿。
 * 这里按真机协议推 `{ type: 'state', state }`，然后直接读 DOM（class / 属性 / 文本）。
 *
 * 用法：
 * ```ts
 * const dom = await mountChatDom();
 * dom.push({ ...BASE, messages: [...] });
 * dom.document.querySelector('.message.user')...
 * ```
 */

import { readFileSync } from 'node:fs';
import { messageScriptTag } from '../../core/i18n';

const CHAT_JS = readFileSync('media/chat.js', 'utf8');

/** chat.js 用一个 id 列表一次性取节点（`Object.fromEntries([...])`）。 */
export function elementIds(): string[] {
  const start = CHAT_JS.indexOf('const elements = Object.fromEntries([');
  if (start < 0) throw new Error('chat.js 里找不到元素清单');
  const end = CHAT_JS.indexOf('].map((id) => [id,', start);
  if (end <= start) throw new Error('元素清单缺少结束标记');
  return [...CHAT_JS.slice(start, end).matchAll(/'([A-Za-z0-9_-]+)'/g)].map((m) => String(m[1]));
}

function tagFor(id: string): string {
  if (id === 'promptInput' || id === 'messageEditorInput') return 'textarea';
  if (/Input$/.test(id)) return 'select';
  if (/Button$/.test(id)) return 'button';
  return 'div';
}

/** 不在元素清单里、但 chat.js 会用 `getElementById` 直接取的元素。 */
const EXTRA_IDS = ['teamTaskBar', 'teamTaskProject', 'teamTaskTitle', 'teamTaskStop'];

function buildMarkup(): string {
  const body = [...elementIds(), ...EXTRA_IDS]
    .map((id) => `<${tagFor(id)} id="${id}"></${tagFor(id)}>`)
    .join('');
  // 真机把翻译表作为 `<script id="hwchat-i18n">` 嵌进页面；用同一个生成器，
  // 否则 `t()` 只能拿到 key，断言就看不出提示文案到底写了什么。
  return `<!DOCTYPE html><html><head>${messageScriptTag('zh')}</head><body>${body}</body></html>`;
}

export interface MountedChatDom {
  document: any;
  window: any;
  /** chat.js 挂载期或运行期抛出的错误（应当为空）。 */
  errors: string[];
  /** 发给扩展的消息（`vscode.postMessage`）。 */
  posted: Array<Record<string, unknown>>;
  /** 推一条 `{ type: 'state', state }` 给界面。 */
  push: (state: Record<string, unknown>, streamingConversationId?: string | null) => void;
  /** 推任意消息（附件字节回包、语音状态等）。 */
  send: (data: Record<string, unknown>) => void;
}

export async function mountChatDom(): Promise<MountedChatDom> {
  const { parseHTML } = await import('linkedom');
  const { window, document } = parseHTML(buildMarkup()) as any;
  const errors: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (message: Record<string, unknown>) => posted.push(message),
    getState: () => undefined,
    setState: () => undefined,
  });
  window.addEventListener('error', (event: any) => {
    errors.push(String(event?.error?.message ?? event?.message ?? event));
  });
  window.matchMedia = window.matchMedia
    ?? (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  window.requestAnimationFrame = window.requestAnimationFrame ?? ((cb: () => void) => setTimeout(cb, 0));
  window.ResizeObserver = window.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
  /*
   * chat.js 复制图片时会用 `FileReader` 把 Blob 转成 data URL（HTML 里内联图片用）。
   * linkedom 没有它，缺了就会在「复制」路径上抛 ReferenceError —— 补一个最小实现。
   */
  if (!window.FileReader) {
    window.FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      async readAsDataURL(blob: any): Promise<void> {
        try {
          const bytes = Buffer.from(await blob.arrayBuffer());
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${bytes.toString('base64')}`;
          this.onload?.();
        } catch {
          this.onerror?.();
        }
      }
    };
  }
  // chat.js 会读 `<select>` 的 selectedOptions / options，linkedom 没有。
  for (const element of document.querySelectorAll('select')) {
    if (element.selectedOptions === undefined) {
      Object.defineProperty(element, 'selectedOptions', { value: [], configurable: true });
    }
    if (element.options === undefined) {
      Object.defineProperty(element, 'options', { value: [], configurable: true });
    }
  }

  try {
    const run = new Function('window', 'document', 'acquireVsCodeApi', CHAT_JS);
    run(window, document, window.acquireVsCodeApi);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const send = (data: Record<string, unknown>): void => {
    const event = new window.Event('message');
    (event as any).data = data;
    window.dispatchEvent(event);
  };
  const push = (state: Record<string, unknown>, streamingConversationId: string | null = null): void => {
    send({ type: 'state', state: { ...state }, streamingConversationId });
  };
  return { document, window, errors, posted, push, send };
}

/** 一份够用的基础状态（每个用例只覆盖自己关心的字段）。 */
export const BASE_STATE = {
  conversation: { id: 'c1', title: '对话', archived: false },
  messages: [] as unknown[],
  tasks: [],
  settings: { sendOnEnter: true },
  streaming: false,
  runningConversationIds: [] as string[],
};

/** 造一条用户消息（可带附件）。 */
export function userMessage(content: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const at = new Date('2026-11-25T12:00:00Z').getTime();
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content,
    status: 'complete',
    at,
    createdAt: at,
    ...extra,
  };
}
