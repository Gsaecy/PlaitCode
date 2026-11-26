import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatSettings } from '../core/types';
import { DeepSeekClient } from '../providers/deepseekClient';
import { isDeepSeekHost, stripReasoningHistory } from '../providers/reasoningHistory';

const settings: ChatSettings = {
  apiProfiles: [{ id: 'default', name: 'Test', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash'], requestHeaders: {} }],
  activeApiProfileId: 'default',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  temperature: 0,
  maxTokens: 0,
  systemPrompt: '',
  sendOnEnter: true,
  historyRetentionDays: 30,
  taskCacheRetentionHours: 24,
  cacheBudgetMB: 100,
  cleanupIntervalMinutes: 10,
  maxMessagesInContext: 20,
  requestHeaders: {},
  requestTimeoutSeconds: 30, proxy: '',
  defaultMode: 'agent',
  agentMaxSteps: 12,
  reasoningEffort: 'default',
  permissionPreset: 'review',
  internetReference: false,
  fileReadPolicy: 'allow',
  fileWritePolicy: 'ask',
  commandPolicy: 'ask',
  dangerousCommandPolicy: 'ask',
  sensitiveFilePolicy: 'deny',
  maxReadBytes: 512_000,
  maxToolOutputBytes: 200_000,
  maxCommandSeconds: 120,
  auditRetentionDays: 30,
  language: 'auto',
};

test('重发历史时不带旧轮次的思考过程（DeepSeek 官方规则）', () => {
  const messages = [
    { role: 'user', content: '看一下这个项目' },
    { role: 'assistant', content: '', reasoning_content: '想了很久'.repeat(500), tool_calls: [{ id: 'c1' }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"status":"success"}' },
    { role: 'assistant', content: '看完了' },
  ];
  const stripped = stripReasoningHistory(messages);
  assert.equal('reasoning_content' in stripped[1]!, false, '旧轮次的 CoT 不能再发回服务端');
  assert.deepEqual((stripped[1] as { tool_calls?: unknown }).tool_calls, [{ id: 'c1' }], '工具调用链必须原样保留');
  assert.equal(stripped[3]?.content, '看完了');

  // 没有可去掉的字段时原样返回（每轮都跑，常态下不该有额外开销）。
  const clean = [{ role: 'user', content: 'hi' }];
  assert.equal(stripReasoningHistory(clean), clean);
});

test('只对 DeepSeek 官方接口生效（兼容网关可能要靠回传思考片段）', () => {
  assert.equal(isDeepSeekHost('https://api.deepseek.com/chat/completions'), true);
  assert.equal(isDeepSeekHost('https://gateway.example.com/v1/chat/completions'), false);
  assert.equal(isDeepSeekHost('not a url'), false);
});

test('DeepSeek 请求体里真的没有 reasoning_content（执行级）', async () => {
  const originalFetch = globalThis.fetch;
  let body: { messages?: Array<Record<string, unknown>> } | undefined;
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body)) as typeof body;
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const client = new DeepSeekClient(async () => 'test-key');
    await client.streamChat(settings, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', reasoning_content: 'x'.repeat(5_000) } as never,
      { role: 'user', content: '继续' },
    ], { onDelta: () => undefined });
    assert.equal(Array.isArray(body?.messages), true);
    assert.equal(
      body?.messages?.some((message) => 'reasoning_content' in message),
      false,
      '发出去的请求体里不能再有 reasoning_content',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
