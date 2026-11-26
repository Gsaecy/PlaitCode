import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fitMessagesForWebview,
  trimMessageForWebview,
  webviewMessageBytes,
  WEBVIEW_MESSAGES_BUDGET_BYTES,
  WEBVIEW_TOOL_OUTPUT_CHARS,
} from '../views/webviewPayload';

/**
 * 用户 2026-11-26：「两个版本之前的从没出现白屏，你检查一下，看看根本问题是什么。」
 *
 * 我用她机器上的真实存档量了一遍（`history-v1/conversations`）：
 *  - 一条团队任务对话 **355 条消息 / 31.45 MB**；
 *  - **单条消息 2.2 MB**（几百个 `toolExecutions`，每个 output 上限 200 KB）。
 *
 * 而 `sendState()` 每次推最近 **80 条**、原样带着这些 output。一次推送几十 MB，
 * 结构化克隆足以让 webview 渲染进程死掉；`retainContextWhenHidden: true` 又会把那块
 * **已经死掉的** iframe 留着，于是界面白着不再恢复 —— 这就是「装完是好的，
 * 用着用着变白」的真正原因（对话越大越容易撞线）。
 *
 * 下面用她的真实数量级把这两道闸钉死。
 */

/** 造一条和她机器上一样量级的消息：200 次工具调用，每次 200 KB 输出（≈2.2 MB 档位）。 */
function heavyMessage(id: string, tools = 12, outputChars = 200_000): Record<string, unknown> {
  return {
    id,
    role: 'assistant',
    content: '做完了。',
    status: 'complete',
    toolExecutions: Array.from({ length: tools }, (_, index) => ({
      callId: `${id}-${index}`,
      name: 'run_command',
      summary: `第 ${index} 条命令`,
      input: `npm run check --flag=${index} ${'i'.repeat(1_000)}`,
      output: `${index}: ${'x'.repeat(outputChars)}`,
      status: 'success',
      startedAt: 1,
      finishedAt: 2,
    })),
  };
}

test('单条消息裁剪：工具输出只留预览，存档语义里的其它字段一个不动', () => {
  const original = heavyMessage('m1');
  const originalBytes = webviewMessageBytes(original);
  assert.ok(originalBytes > 2_000_000, `样本要够大（实际 ${originalBytes}）`);

  const trimmed = trimMessageForWebview(original);
  const bytes = webviewMessageBytes(trimmed);
  assert.ok(bytes < 150_000, `裁剪后必须小一个量级（实际 ${bytes}）`);
  assert.equal(trimmed.toolsTrimmed, true);
  assert.equal(trimmed.content, '做完了。', '正文不动');
  const tools = trimmed.toolExecutions as Array<Record<string, unknown>>;
  assert.equal(tools.length, 12, '步骤条数不变（界面还要按条显示）');
  assert.equal((tools[0]!.output as string).length, WEBVIEW_TOOL_OUTPUT_CHARS, '输出留预览长度');
  assert.equal(tools[0]!.outputTruncated, true, '要标记「这只是预览」');
  assert.equal(tools[0]!.outputTotal, 200_003, '要知道原来多长（`0: ` + 200000 个字符）');
  // 原对象没有被改动（存档那一份必须是全文）。
  assert.equal((original.toolExecutions as Array<{ output: string }>)[0]!.output.length, 200_003);
});

test('小消息原样返回（不为了省字节把正常内容也改掉）', () => {
  const small = { id: 'm2', content: '你好', toolExecutions: [{ callId: 'c', output: 'ok', status: 'success' }] };
  assert.equal(trimMessageForWebview(small as never), small, '没有超限就返回同一个对象');
});

test('整页按预算裁剪：永远保住最新那条，且总量不超预算', () => {
  /*
   * 两道闸是配合的：单条裁剪先把 2 MB 级消息压成几十 KB；如果**仍然**超预算
   * （例如 80 条各 150 MB 的正文，正文不该被裁），就丢更早的，保住最新那条。
   */
  const fat = Array.from({ length: 80 }, (_, index) => ({
    id: `fat${index}`,
    content: 'y'.repeat(150_000),
    toolExecutions: [],
  }));
  const total = fat.reduce((sum, item) => sum + webviewMessageBytes(item), 0);
  assert.ok(total > 10_000_000, `样本本来有 ${Math.round(total / 1048576)} MB`);

  const { messages: kept, dropped } = fitMessagesForWebview(fat);
  const budget = kept.reduce((sum, item) => sum + webviewMessageBytes(item), 0);
  assert.ok(budget <= WEBVIEW_MESSAGES_BUDGET_BYTES, `推送量要落在预算内（实际 ${budget}）`);
  assert.ok(dropped > 0, '超预算时确实丢了更早的');
  assert.equal(kept.at(-1), fat.at(-1), '最新那条必须留着（用户正在看它）');
  assert.deepEqual(kept, fat.slice(fat.length - kept.length), '留下的是连续的一段（更早的才丢）');
});

test('真实数量级端到端：355 条 / 31 MB 的对话推给界面也要落在预算内', () => {
  // 按用户机器上那条团队任务对话的规模造数据（355 条、单条 2.2 MB 档位）。
  const heavy = Array.from({ length: 40 }, (_, index) => trimMessageForWebview(heavyMessage(`h${index}`)));
  const light = Array.from({ length: 315 }, (_, index) => ({ id: `l${index}`, content: '一句话', toolExecutions: [] }));
  const page = [...light, ...heavy].slice(-80);
  const { messages: kept } = fitMessagesForWebview(page);
  const bytes = kept.reduce((sum, item) => sum + webviewMessageBytes(item), 0);
  assert.ok(bytes <= WEBVIEW_MESSAGES_BUDGET_BYTES, `裁剪后要落在预算内（实际 ${Math.round(bytes / 1024)} KB）`);
  assert.ok(kept.length >= 1);
});

test('极端单条（比预算还大）也要发出去，不能把界面变成空白', () => {
  const huge = trimMessageForWebview({
    id: 'huge',
    content: 'y'.repeat(9_000_000),
    toolExecutions: [],
  });
  const { messages } = fitMessagesForWebview([{ id: 'a', content: 'small' }, huge]);
  assert.equal(messages.length, 1, '只剩最新那条');
  assert.equal((messages[0] as { id: string }).id, 'huge', '哪怕它自己就超预算，也必须发最新那条');
});

test('预算判定是纯函数：空数组 / 单条都不炸', () => {
  assert.deepEqual(fitMessagesForWebview([]), { messages: [], dropped: 0 });
  const one = { id: 'one', content: 'x' };
  assert.deepEqual(fitMessagesForWebview([one]), { messages: [one], dropped: 0 });
  assert.equal(webviewMessageBytes(undefined), 0, '不可序列化的一律按 0 算，别把整次推送打死');
});
