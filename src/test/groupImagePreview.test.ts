import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import type { SyncPeer } from '../sync/lanProtocol';

/**
 * 群里的图片必须**看得见**。
 *
 * 用户实况（2026-11-25）：「贴进团队群对话框和团队任务对话框里面的图片，只显示占位图，
 * 看不到预览」。查下来是两件事叠加：
 *
 * 1. 群窗口的 `localResourceRoots` 只有扩展目录，而图片落在 `globalStorage/assets` ——
 *    `asWebviewUri` 生成的地址被资源服务拒绝，`<img>` 只剩 alt 文字（就是「占位图」）；
 * 2. `assetPaths`（资产 id → 本机路径）只在内存里，重载窗口后查不到，界面只能画占位。
 *
 * 这里钉住：路径能按 id 从磁盘上找回来（不依赖内存表）、目录进得了资源根、
 * 以及两个界面都有「向宿主要字节」的最后一级兜底。
 */

const GROUP = readFileSync('src/views/groupPanel.ts', 'utf8');
/** 群窗口界面脚本（真文件）；宿主侧仍在 groupPanel.ts。 */
const GROUP_SCRIPT = readFileSync('media/group.js', 'utf8');
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
const CHAT_JS = readFileSync('media/chat.js', 'utf8');

const win: SyncPeer = { id: 'p-win', name: 'PC', platform: 'win32', project: 'app', version: 't' };

async function makeService(): Promise<{ service: LanSyncService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-assets-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => win,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    localProjects: () => ['app'],
    localProjectRepos: () => ['github.com/acme/app'],
    log: () => undefined,
  }, { discoveryPort: 48_983 });
  await service.load();
  return { service, dir };
}

test('图片落盘后能按资产 id 找回路径；重载（内存表没了）也照样找得到', async () => {
  const { service, dir } = await makeService();
  try {
    const ref = await service.shareAsset({
      name: 'image.png',
      mimeType: 'image/png',
      kind: 'image',
      dataBase64: Buffer.from('fake-png-bytes').toString('base64'),
    });
    assert.ok(ref, '要返回附件元信息');
    const first = service.assetPath(ref!.id);
    assert.ok(first && first.endsWith('.png'), `要有本机路径：${first}`);

    // 换一个服务实例（等价于重载窗口：内存里的映射没了），仍要能找回同一个文件。
    const reloaded = new LanSyncService(join(dir, 'state.json'), {
      peer: () => win,
      runRequirement: async () => true,
      runNote: async () => true,
      writeLedger: async () => undefined,
      writeTranscript: async () => undefined,
      localProjects: () => ['app'],
      localProjectRepos: () => ['github.com/acme/app'],
      log: () => undefined,
    }, { discoveryPort: 48_984 });
    await reloaded.load();
    try {
      assert.equal(reloaded.assetPath(ref!.id), first, '按文件名前缀在磁盘上找回来');
      assert.equal(reloaded.assetPath('a000000000000'), '', '不存在的 id 返回空串，不瞎猜');
    } finally {
      reloaded.dispose();
    }
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('群窗口把附件目录加进资源根，否则图片地址会被资源服务拒掉', () => {
  assert.match(GROUP, /assetDirectory\(\)/, '服务要能给出附件目录');
  assert.match(GROUP, /localResourceRoots: \[this\.extensionUri, \.\.\.\(assetRoot \? \[assetRoot\] : \[\]\)\]/, '附件目录必须进 localResourceRoots');
  assert.match(PANEL, /joinPath\(this\.attachmentStorageUri, 'assets'\)/, '主面板也要把 assets 加进去');
});

test('两个界面都有「向宿主要字节」的最后兜底（不依赖资源协议）', () => {
  // 团队群
  assert.match(GROUP_SCRIPT, /img\.addEventListener\('error'/, '群里的图加载失败要能自救');
  assert.match(GROUP_SCRIPT, /requestAssetData\(asset\.id\)\.then/, '失败时向宿主索取原始字节');
  assert.match(GROUP_SCRIPT, /'data:' \+ \(data\.mimeType \|\| 'image\/png'\) \+ ';base64,' \+ data\.dataBase64/, '用 data URL 显示');

  // 主对话框（团队任务也在这个 webview 里）
  assert.match(CHAT_JS, /async function recoverWithBytes/, '要有字节级兜底');
  assert.match(CHAT_JS, /requestAttachmentData\(attachment\.id\)/, '向宿主索要字节');
  assert.match(CHAT_JS, /image\.src = `data:\$\{data\.mimeType \|\| attachment\.mimeType \|\| 'image\/png'\};base64,\$\{data\.dataBase64\}`/, '用 data URL 显示');
  // 不能因为多了这一级就无限重试：每一级只走一次。
  assert.match(CHAT_JS, /if \(stage === 'bytes-ok' \|\| stage === 'thumb'\) \{/, '试到底就停，别循环');
});

test('图片附件永远带着一份内联缩略图，地址失效也不会只剩破图', () => {
  /*
   * 用户实况（2026-11-25，第二次）：「团队任务对话框的图片附件，还是占位符，没有显示预览图片」。
   *
   * 三级兜底里最后一级依赖 `thumbnailDataUrl`；群资产、从对端传过来的图片**没有**
   * 前端生成的缩略图，于是那一级是空的 —— 兜底链走到头仍然是一张破图。
   * 现在宿主下发附件时，磁盘上还有原文件就顺手做一份内联缩略图。
   */
  assert.match(PANEL, /thumbnailDataUrl: context\.thumbnailDataUrl \?\? this\.inlineThumbnailFor\(context\)/, '缺缩略图时补一份内联的');
  assert.match(PANEL, /private inlineThumbnailFor\(context: MessageContext\): string \| undefined/, '要有生成入口');
  const start = PANEL.indexOf('private inlineThumbnailFor(');
  const body = PANEL.slice(start, start + 1_400);
  assert.match(body, /context\.kind !== 'image'/, '只对图片做');
  assert.match(body, /info\.size > INLINE_THUMB_MAX_BYTES/, '太大的原图不进消息状态');
  assert.match(body, /`data:\$\{mime\};base64,\$\{data\.toString\('base64'\)\}`/, '生成 data URL');
  assert.match(body, /this\.inlineThumbCache\.set/, '要缓存，避免每次重绘都读盘');
  assert.match(PANEL, /INLINE_THUMB_CACHE_LIMIT/, '缓存要有上限');
});

test('监听要先挂上再设 src，否则 error 可能一次兜底都跑不到', () => {
  const start = CHAT_JS.indexOf('const image = document.createElement(\'img\'); image.alt = attachment.label;');
  assert.ok(start > 0, '附件图片的创建位置');
  const body = CHAT_JS.slice(start, start + 420);
  assert.ok(
    body.indexOf('attachImageRecovery(image, attachment)') < body.indexOf('image.src = imageSrc'),
    '必须先 attachImageRecovery 再赋 src',
  );
});
