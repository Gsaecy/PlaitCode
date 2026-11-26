import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BASE_STATE, mountChatDom, userMessage } from './support/chatDom';

/**
 * 用户 2026-11-25：「气泡消息复制只能第一张附件/图，很不方便，
 * 需要能复制全部附件/图 + 消息内容。团队群聊里面也需要实现这个功能」。
 *
 * 这里**真的点一次复制按钮**（chat.js 挂在 DOM 上），看它到底按几个附件去要字节：
 * 只取第一张就是老 bug，遍历全部才是修好。图片转 PNG 依赖 canvas（测试环境没有），
 * 所以最终会走「纯文本 + 附件清单」的降级路径 —— 那条也要能粘出完整清单。
 */

const IMAGE_ONE = { id: 'a1', kind: 'image', label: 'one.png', path: '/tmp/one.png', mimeType: 'image/png' };
const IMAGE_TWO = { id: 'a2', kind: 'image', label: 'two.png', path: '/tmp/two.png', mimeType: 'image/png' };

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 点一次复制按钮，并如实回应每个字节请求（模拟宿主）。 */
async function clickCopy(): Promise<{ dom: Awaited<ReturnType<typeof mountChatDom>>; button: any }> {
  const dom = await mountChatDom();
  assert.deepEqual(dom.errors, [], `chat.js 挂载不应该报错：${dom.errors.join(' / ')}`);
  dom.push({
    ...BASE_STATE,
    messages: [userMessage('看这两张图', { attachments: [IMAGE_ONE, IMAGE_TWO] })],
  });
  const button = dom.document.querySelector('.message-copy-button');
  assert.ok(button, '气泡上必须有复制按钮');
  button.dispatchEvent(new dom.document.defaultView.Event('click'));

  // 宿主一侧：每个 requestAttachmentData 都回包（真机也是这么回的）。
  const answered = new Set<string>();
  await waitFor(() => {
    for (const message of dom.posted) {
      if (message.type !== 'requestAttachmentData') continue;
      const requestId = String(message.requestId ?? '');
      if (!requestId || answered.has(requestId)) continue;
      answered.add(requestId);
      dom.send({ type: 'attachmentData', requestId, ok: true, dataBase64: 'aGVsbG8=', mimeType: 'image/png' });
    }
    return dom.posted.some((message) => message.type === 'copyText');
  });
  return { dom, button };
}

test('复制会按**全部**图片去要字节，不是只取第一张', async () => {
  const { dom } = await clickCopy();
  const requested = dom.posted
    .filter((message) => message.type === 'requestAttachmentData')
    .map((message) => String(message.id));
  assert.ok(requested.includes('a1'), `第一张要请求：${JSON.stringify(requested)}`);
  assert.ok(requested.includes('a2'), `第二张也必须请求（老 bug 就是漏了它）：${JSON.stringify(requested)}`);
});

test('图片转不了 PNG 时降级成「正文 + 全部附件清单」，而不是静默失败', async () => {
  const { dom } = await clickCopy();
  await waitFor(() => dom.posted.some((message) => message.type === 'copyText'));
  const copy = dom.posted.find((message) => message.type === 'copyText');
  assert.ok(copy, `必须走纯文本降级：${JSON.stringify(dom.posted)}`);
  const text = String(copy.text ?? '');
  assert.match(text, /看这两张图/, '正文要带上');
  assert.match(text, /\[图片\] one\.png：\/tmp\/one\.png/, '清单要有名称与路径');
  assert.match(text, /\[图片\] two\.png：\/tmp\/two\.png/, '第二张同样要在清单里');
});

test('没有附件的消息：直接把正文写进剪贴板（不生成空清单）', async () => {
  const dom = await mountChatDom();
  dom.push({ ...BASE_STATE, messages: [userMessage('只有文字')] });
  dom.document.querySelector('.message-copy-button').dispatchEvent(new dom.document.defaultView.Event('click'));
  await waitFor(() => dom.posted.some((message) => message.type === 'copyText'));
  const copy = dom.posted.find((message) => message.type === 'copyText');
  assert.equal(String(copy?.text ?? '').trim(), '只有文字');
  assert.equal(dom.posted.some((message) => message.type === 'requestAttachmentData'), false, '没有图就不该去要字节');
});

test('能写富格式时：HTML 里内联**全部**图片（一次粘贴带走所有图）', async () => {
  const dom = await mountChatDom();
  // 模拟支持 ClipboardItem 的环境。
  const written: Array<Record<string, unknown>> = [];
  dom.window.ClipboardItem = class {
    constructor(readonly items: Record<string, unknown>) {}
  };
  Object.defineProperty(dom.window.navigator ?? {}, 'clipboard', {
    value: { write: async (items: unknown[]) => { written.push(...(items as Array<Record<string, unknown>>)); } },
    configurable: true,
  });
  dom.push({
    ...BASE_STATE,
    messages: [userMessage('看这两张图', { attachments: [IMAGE_ONE, IMAGE_TWO] })],
  });
  dom.document.querySelector('.message-copy-button').dispatchEvent(new dom.document.defaultView.Event('click'));

  const answered = new Set<string>();
  await waitFor(() => {
    for (const message of dom.posted) {
      if (message.type !== 'requestAttachmentData') continue;
      const requestId = String(message.requestId ?? '');
      if (!requestId || answered.has(requestId)) continue;
      answered.add(requestId);
      dom.send({ type: 'attachmentData', requestId, ok: true, dataBase64: 'aGVsbG8=', mimeType: 'image/png' });
    }
    return written.length > 0;
  });

  if (!written.length) {
    // 环境里转不出 PNG 时走降级路径（上面还有一条用例专门验证降级），这里不强行判定。
    assert.ok(dom.posted.some((message) => message.type === 'copyText'), '降级路径同样要能复制文字');
    return;
  }
  const html = String(await (written[0] as any).items['text/html'].text());
  assert.match(html, /alt="one\.png"/, '第一张图要在 HTML 里');
  assert.match(html, /alt="two\.png"/, '第二张图也要在 HTML 里（这才是「全部附件」）');
});

test('团队群：复制实现与宿主回应都在（脚本现在是真文件，读完核对入口）', () => {
  /*
   * 群脚本已从 `groupPanel.ts` 的内联模板抽成 `media/group.js`（真文件），
   * 群窗口的 DOM 行为在 `groupPanelDom.test.ts` 里执行验证。
   * 这里只确认三条通道都存在：复制按钮、按资产 id 读字节、纯文本回退。
   */
  const group = readFileSync('media/group.js', 'utf8');
  const host = readFileSync('src/views/groupPanel.ts', 'utf8');
  assert.match(group, /async function copyGroupMessage/, '群里要有复制实现');
  assert.match(group, /type: 'requestAssetData'/, '界面按资产 id 向宿主索要字节');
  assert.match(group, /type: 'copyText'/, '富格式不可用时回退纯文本');
  assert.match(group, /class = 'msg-copy'|className = 'msg-copy'/, '每条气泡都要有复制按钮');
  // 宿主一侧的三条对应通道（脚本发出去的消息得有人接）。
  assert.match(host, /record\.type === 'requestAssetData'/, '宿主要回应附件字节请求');
  assert.match(host, /record\.type === 'copyText'/, '纯文本回退由宿主写剪贴板');
});
