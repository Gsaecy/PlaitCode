/**
 * 旧轮次的思考过程（`reasoning_content`）不再回传给服务端。
 *
 * DeepSeek 官方文档（Chat Completions · Multi-round Conversation）写得很明确：
 * 「In each round of the conversation, the model outputs the CoT (`reasoning_content`)
 * and the final answer (`content`). In the next round of the conversation, the CoT from
 * previous rounds is **not** concatenated into the context.」
 *
 * 我们却把每一轮的 `reasoning_content` 都塞回 `requestMessages`，然后逐轮累积着发回去 ——
 * 一次 552 轮的团队任务运行里，光是「已经想过的思考」就有几十 KB，而且**每一轮都要重发一遍**。
 * 2026-11-26 实测：那条团队任务对话累计 **5.6 亿 tokens**、单次运行 6934 万，
 * 其中这一项是纯粹的重复付费。去掉它不改变任何行为：模型下一轮该知道的结论都在
 * `content` 与工具结果里。
 *
 * 只对 DeepSeek 自己的接口生效：部分 OpenAI 兼容网关要靠回传思考片段维持工具调用链，
 * 那些配置一律保持原样。
 */

/** 这是不是 DeepSeek 官方接口。 */
export function isDeepSeekHost(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname.toLowerCase() === 'api.deepseek.com';
  } catch {
    return false;
  }
}

/**
 * 去掉消息里的 `reasoning_content`。
 *
 * 没有可去掉的字段时**原样返回入参**（不复制数组）：这个函数在每一次请求前都会跑一遍，
 * 常态下不应该有任何额外开销。
 */
export function stripReasoningHistory<T extends object>(messages: readonly T[]): T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!('reasoning_content' in message) && !('reasoning' in message)) return message;
    changed = true;
    const copy = { ...message } as Record<string, unknown>;
    delete copy.reasoning_content;
    delete copy.reasoning;
    return copy as T;
  });
  return changed ? next : (messages as unknown as T[]);
}
