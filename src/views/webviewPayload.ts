/**
 * 发给 webview 的载荷必须**有上限**。
 *
 * 用户 2026-11-26：「两个版本之前的从没出现白屏，你检查一下，看看根本问题是什么。」
 *
 * 复核对话存档后看到的真实数据（`history-v1/conversations`）：
 *  - 一条团队任务对话 **355 条消息 / 31.45 MB**；
 *  - **单条消息 2.2 MB**（几百个 `toolExecutions`，每个 output 最多 200 KB）；
 *  - 而 `sendState()` 每次推 **最近 80 条**、并且**原样带着这些 output**。
 *
 * 也就是说一次状态推送可能就有几十 MB —— 结构化克隆 + JSON 序列化足以让 webview
 * 渲染进程直接死掉。死了之后 iframe 就停在空白上（`retainContextWhenHidden: true`
 * 还会让 VS Code 保留这块**死掉的** iframe，不再重建），于是「界面白屏」。
 *
 * 这解释了两件事：
 *  1. 为什么「装完是好的，用着用着变白」—— 对话越大、单条消息越大，迟早超过渲染进程的承受线；
 *  2. 为什么「两个版本之前没有」—— 那时群消息还没被一条条写进团队任务对话，
 *     单条消息的 toolExecutions 也没这么长，推送量远小于现在。
 *
 * 所以两道闸都在这里（纯函数，测试直接执行）：
 *  - 单个工具输出只推**预览**（正文完整存档不变，需要时仍可从存档读取）；
 *  - 整页消息按字节预算裁剪，永远保住最新那条。
 */

/** 单个工具输出推给界面的字符上限（正文之外的展示用，4 KB 足够看清结论）。 */
export const WEBVIEW_TOOL_OUTPUT_CHARS = 4_000;
/** 单条工具输入（命令 / 参数）推给界面的字符上限。 */
export const WEBVIEW_TOOL_INPUT_CHARS = 4_000;
/**
 * 一次状态推送里消息部分的总字节预算。
 *
 * 取 6 MB：80 条普通消息远用不到，而 2 MB 的单条消息会被裁到只剩最新几条 ——
 * 宁可「历史要往上翻才加载」，也不要让渲染进程被一份几十 MB 的载荷打死。
 */
export const WEBVIEW_MESSAGES_BUDGET_BYTES = 6 * 1024 * 1024;

/** 裁剪字符串，返回是否真的裁过。 */
function clipText(value: string | undefined, max: number): { text: string | undefined; clipped: boolean } {
  if (typeof value !== 'string') return { text: value, clipped: false };
  if (value.length <= max) return { text: value, clipped: false };
  return { text: value.slice(0, max), clipped: true };
}

/**
 * 把一条消息裁剪成「够界面显示」的副本（不改存档）。
 *
 * 只裁 `toolExecutions` 里的 `output` / `input`：它们才是体积来源（单条 command 输出
 * 上限 200 KB × 几百次调用）。正文、附件、状态一律不动。
 */
export function trimMessageForWebview<T extends {
  toolExecutions?: ReadonlyArray<{ output?: string; input?: string }>;
}>(message: T): T & { toolsTrimmed?: boolean } {
  const tools = message.toolExecutions;
  if (!tools?.length) return message;
  let trimmed = false;
  const next = tools.map((tool) => {
    const output = clipText(tool.output, WEBVIEW_TOOL_OUTPUT_CHARS);
    const input = clipText(tool.input, WEBVIEW_TOOL_INPUT_CHARS);
    if (!output.clipped && !input.clipped) return tool;
    trimmed = true;
    return {
      ...tool,
      ...(output.text !== undefined ? { output: output.text } : {}),
      ...(input.text !== undefined ? { input: input.text } : {}),
      ...(output.clipped
        ? {
          outputTruncated: true,
          outputTotal: typeof tool.output === 'string' ? tool.output.length : 0,
        }
        : {}),
    };
  });
  if (!trimmed) return message;
  return { ...message, toolExecutions: next, toolsTrimmed: true };
}

/** 一条消息的大致字节数（只算会把界面撑大的部分）。 */
export function webviewMessageBytes(message: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(message));
  } catch {
    // 循环引用 / 不可序列化：按 0 算，别让它把整次推送打死。
    return 0;
  }
}

/**
 * 按字节预算裁剪消息页：从**最旧的**开始丢，永远保住最新那条。
 *
 * @returns `messages` 是能发出去的那部分，`dropped` 是丢掉的条数（界面据此提示「往上翻加载更早」）。
 */
export function fitMessagesForWebview<T>(
  messages: readonly T[],
  budgetBytes = WEBVIEW_MESSAGES_BUDGET_BYTES,
): { messages: T[]; dropped: number } {
  if (!messages.length) return { messages: [], dropped: 0 };
  const kept: T[] = [];
  let total = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const size = webviewMessageBytes(message);
    // 最新那条无条件保留：它是用户此刻正在看的内容。
    if (kept.length > 0 && total + size > budgetBytes) break;
    kept.push(message);
    total += size;
  }
  kept.reverse();
  return { messages: kept, dropped: messages.length - kept.length };
}
