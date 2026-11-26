import assert from 'node:assert/strict';
import test from 'node:test';
import { pruneToolPayloads, ToolLoopGuard } from '../agent/agentRunner';
import type { ChatRequestMessage, ToolCall } from '../core/types';

/**
 * 用户 2026-11-26：「hwchat 会反复循环调用」——贴回来的执行过程是
 * **287 个步骤**，其中 **267 次 `read_file`** 全在同一个 145.9 KB 文件上，
 * 按行窗口来回读：175 → 1650 → 1790 → 1880 → 1700 → 1860 → 175 → 1650 …
 *
 * 用对话存档里的真实参数复核后确认两个通用成因（跟具体项目、系统都无关）：
 *
 *  1. **钉住是按路径的**：同一个文件只钉住**最后一个窗口**，之前读过的窗口全被折掉；
 *     活跃预算 96 KB，两个 48 KB 的窗口就超了 —— 于是模型**永远只能看见一个窗口**，
 *     想对照两段就得再读一遍，形成闭环。
 *  2. **重复判定太松**：读文件是幂等的，同样的参数第二次拿到逐字节相同的结果，
 *     就已经证明「再读也没有新信息」，却要等到第三次才拦。
 *
 * 下面两条用例分别钉住这两件事。
 */

const WINDOW = 48 * 1024;

/**
 * 造一条 read_file 的 tool 载荷。
 *
 * 尺寸按**真实数据**来：贴回来的执行过程里那 6 个窗口分别是
 * 2905 / 1981 / 5271 / 4069 / 3351 / 5243 字节（模型自己挑的小范围）。
 */
function readPayload(path: string, startLine: number, bytes: number): ChatRequestMessage {
  return {
    role: 'tool',
    tool_call_id: `call-${startLine}`,
    name: 'read_file',
    content: JSON.stringify({
      status: 'success',
      summary: `读取 ${path}（第 ${startLine} 行起）`,
      result: `${startLine}: ${'x'.repeat(Math.max(1, bytes))}`,
      path,
    }),
  };
}

const isFolded = (message: ChatRequestMessage): boolean => {
  const payload = JSON.parse(String(message.content)) as { folded?: boolean };
  return payload.folded === true;
};

test('同一个文件的多个窗口必须能同时留在上下文里（否则模型只能反复重读）', () => {
  const file = 'Personal-Workstation-OS/Windows版本/app/src-tauri/src/mail/sync.rs';
  // 真实顺序与真实大小：六个不同窗口，然后开始第二轮（这轮才是「重复」）。
  const starts = [175, 1650, 1790, 1880, 1700, 1860];
  const sizes = [2905, 1981, 5271, 4069, 3351, 5243];
  const messages: ChatRequestMessage[] = [
    { role: 'user', content: '只回四行，不改文件' },
    ...starts.map((start, index) => readPayload(file, start, sizes[index]!)),
  ];

  pruneToolPayloads(messages, 3, 128_000 * 4);

  const toolMessages = messages.filter((message) => message.role === 'tool');
  const kept = toolMessages.filter((message) => !isFolded(message));
  assert.equal(kept.length, 6, '同一个文件的这 6 个窗口应当全部留住（它们总共才 ~23 KB）');
  const keptStarts = kept.map((message) => {
    const payload = JSON.parse(String(message.content)) as { summary?: string };
    return Number(/第 (\d+) 行起/.exec(String(payload.summary))?.[1] ?? 0);
  });
  assert.deepEqual(keptStarts, starts, '留下的就是最近读的那几段，顺序不变');
  assert.equal(toolMessages.length, 6, '载荷条数不变（响应 tool_call，结构不能少）');
});

test('大窗口也至少留住最近 4 段（一个 145.9 KB 的文件按 48 KB 窗口正好 4 段）', () => {
  const messages: ChatRequestMessage[] = [
    { role: 'user', content: '只回四行' },
    ...Array.from({ length: 8 }, (_, index) => readPayload('sync.rs', index * 500 + 1, WINDOW)),
  ];
  pruneToolPayloads(messages, 3, 128_000 * 4);
  const toolMessages = messages.filter((message) => message.role === 'tool');
  const kept = toolMessages.filter((message) => !isFolded(message));
  assert.ok(kept.length >= 4, `大窗口至少要留住 4 段（实际 ${kept.length}）`);
});

test('超预算时先折最早的，最新那一段永远留（折掉它下一步就要重读）', () => {
  const messages: ChatRequestMessage[] = [
    { role: 'user', content: 'x' },
    ...Array.from({ length: 30 }, (_, index) => readPayload('big.rs', index * 100 + 1, WINDOW)),
  ];
  pruneToolPayloads(messages, 3, 0);
  const toolMessages = messages.filter((message) => message.role === 'tool');
  assert.equal(isFolded(toolMessages.at(-1)!), false, '最新一段必须还在');
  assert.equal(isFolded(toolMessages.at(-2)!), false);
  assert.equal(isFolded(toolMessages.at(-4)!), false);
});

test('幂等读工具：同样的参数第二次拿到同样的结果就拦下（不必等到第三次）', () => {
  const read = (path: string, startLine: number): ToolCall => ({
    id: 'c1',
    type: 'function',
    function: { name: 'read_file', arguments: JSON.stringify({ path, startLine }) },
  });
  const guard = new ToolLoopGuard();
  const call = read('sync.rs', 175);
  assert.equal(guard.futile(call), false, '第一次当然要放行');
  guard.record(call, 'success', '同样的内容');
  assert.equal(guard.futile(call), false, '第二次还没执行过，不能说它空转');
  guard.record(call, 'success', '同样的内容');
  assert.equal(guard.futile(call), true, '第二次拿到逐字节相同的结果就该拦');
  // 内容变了（文件确实改过）就不算空转。
  guard.record(call, 'success', '内容变了');
  assert.equal(guard.futile(call), false, '文件变了就重新放行');
  // 参数不同（不同窗口）互不影响。
  assert.equal(guard.futile(read('sync.rs', 1650)), false, '不同的窗口是不同调用');
});

test('会改状态的工具仍按三次判定（读和写不能一刀切）', () => {
  const guard = new ToolLoopGuard();
  const run: ToolCall = { id: 'c2', type: 'function', function: { name: 'run_command', arguments: '{"command":"git status"}' } };
  guard.record(run, 'success', 'clean');
  guard.record(run, 'success', 'clean');
  assert.equal(guard.futile(run), false, '命令类保持原有节奏');
  guard.record(run, 'success', 'clean');
  assert.equal(guard.futile(run), true);
});
