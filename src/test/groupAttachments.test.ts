import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GROUP_IMAGE_MAX_BYTES, GROUP_IMAGE_MAX_COUNT, planGroupImages, toImageContexts } from '../sync/groupAttachments';

/**
 * 用户实况（2026-11-25）：
 * 「甲方截图说 Windows 与 macOS 之间『还没有实现数据同步』。我这边看不到他发的截图。」
 * 用的是能看图的模型 —— 原因是团队任务那一轮只拿到一句「图片：<本机路径>」，
 * `read_file` 读不了二进制，模型只能照实说看不到。
 *
 * 这里**执行**验证「群里的图片会不会变成模型真的能看的附件」，不靠读源码猜。
 */

const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

const PNG = Buffer.from('fake-png-bytes');
const ref = (id: string, name: string, extra: { kind?: string; mimeType?: string; bytes?: number } = {}) => ({
  id,
  name,
  kind: extra.kind ?? 'image',
  ...(extra.mimeType ? { mimeType: extra.mimeType } : {}),
  ...(extra.bytes !== undefined ? { bytes: extra.bytes } : {}),
});

test('分片到齐 → 图片变成模型能看的附件（带字节，不只是路径）', async () => {
  const result = await planGroupImages({
    refs: [ref('a1', 'Screenshot 2026-11-25.png', { mimeType: 'image/png' })],
    paths: { a1: '/local/asset/a1.png' },
    read: () => PNG,
  });
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0]!.dataBase64, PNG.toString('base64'), '必须带字节，否则模型看不到');
  assert.equal(result.images[0]!.mimeType, 'image/png');
  assert.equal(result.images[0]!.path, '/local/asset/a1.png', '路径仍然保留，方便转存/再读');

  const contexts = toImageContexts(result.images);
  assert.equal(contexts[0]!.kind, 'image');
  assert.equal(contexts[0]!.label, 'Screenshot 2026-11-25.png');
});

test('分片还没到 → 记为 missing，不产生附件（说明里会如实写「还在传输」）', async () => {
  const result = await planGroupImages({
    refs: [ref('a1', '延迟的截图.png')],
    paths: {},
    read: () => PNG,
  });
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.missing, ['延迟的截图.png']);
});

test('超过上限的图不交给模型（按真实字节判断）', async () => {
  const big = Buffer.alloc(GROUP_IMAGE_MAX_BYTES + 1, 1);
  const result = await planGroupImages({
    refs: [ref('a1', '巨大截图.png')],
    paths: { a1: '/local/a1.png' },
    read: () => big,
  });
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.skipped, ['巨大截图.png']);
});

test('元信息里写了字节数超限 → 连读都不读（省内存）', async () => {
  let reads = 0;
  const result = await planGroupImages({
    refs: [ref('a1', '大图.png', { bytes: GROUP_IMAGE_MAX_BYTES + 1 })],
    paths: { a1: '/local/a1.png' },
    read: () => {
      reads += 1;
      return PNG;
    },
  });
  assert.deepEqual(result.images, []);
  assert.equal(reads, 0, '既然元信息已经说明超大，就不该把整个文件读进内存');
});

test('读失败（文件被清掉 / 没权限）不会炸，只是这一张看不到', async () => {
  const result = await planGroupImages({
    refs: [ref('a1', '坏图.png')],
    paths: { a1: '/local/a1.png' },
    read: () => undefined,
  });
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.skipped, ['坏图.png']);
});

test('文本/文件附件不参与（它们走 <attached_file>，不该被当成图片）', async () => {
  const result = await planGroupImages({
    refs: [ref('f1', 'notes.txt', { kind: 'file' }), ref('i1', '图.png')],
    paths: { f1: '/local/f1.txt', i1: '/local/i1.png' },
    read: () => PNG,
  });
  assert.deepEqual(result.images.map((image) => image.id), ['i1']);
});

test('条数上限：多出来的图记为 skipped，而不是悄悄丢掉', async () => {
  const refs = Array.from({ length: GROUP_IMAGE_MAX_COUNT + 2 }, (_value, index) => ref(`i${index}`, `图${index}.png`));
  const paths = Object.fromEntries(refs.map((item) => [item.id, `/local/${item.id}.png`]));
  const result = await planGroupImages({ refs, paths, read: () => PNG });
  assert.equal(result.images.length, GROUP_IMAGE_MAX_COUNT);
  assert.equal(result.skipped.length, 2);
});

test('没写 MIME 时按扩展名补（jpg / webp 都能认）', async () => {
  const result = await planGroupImages({
    refs: [ref('a1', 'a.jpg'), ref('a2', 'b.webp')],
    paths: { a1: '/local/a1.jpg', a2: '/local/a2.webp' },
    read: () => PNG,
  });
  assert.deepEqual(result.images.map((image) => image.mimeType), ['image/jpeg', 'image/webp']);
});

test('面板必须真的把图片挂到这一轮的请求上（否则还是「看不到」）', () => {
  assert.ok(PANEL.includes("from '../sync/groupAttachments'"), '要用这个模块');
  assert.match(PANEL, /const imageAttachments = toImageContexts\(planned\.images\)/, '规划完要转成附件');
  assert.match(PANEL, /attachments: imageAttachments/, '必须传给 send()，否则模型拿不到');
  // 协议提示词里也要说清「已经交给你了」，避免模型自我说服「我看不到」。
  assert.match(PANEL, /已经随这条消息交给你了/);
});
