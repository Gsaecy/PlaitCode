/**
 * 群里发的图片，怎么**真的交到这一端的模型手上**。
 *
 * 用户实况（2026-11-25）：「甲方截图说 Windows 与 macOS 之间还没有实现数据同步，
 * 我这边看不到他发的截图」。用的是能看图的模型，为什么看不到？
 *
 * 因为团队任务那一轮只拿到一句「图片：<本机路径>」。`read_file` 读不了二进制，
 * 于是模型只能照实回答「我这边看不到」。而普通对话框里粘贴的图是走
 * `MessageContext.dataBase64` → 请求里的 `image_url` 交给模型的 ——
 * 群里的图少了这一步。
 *
 * 这里把「哪些分片已经落到本地、要不要读成附件」这件事变成纯函数，
 * 好让它在任何机器上都能被测试执行到（不依赖真实网络与文件系统）。
 */

import type { MessageContext } from '../core/types';

/** 单张图交给模型的上限：与普通对话框粘贴图片的上限一致（6 MB）。 */
export const GROUP_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

/** 一条需求最多带几张图给模型：再多就是在烧上下文，也会拖慢这一轮。 */
export const GROUP_IMAGE_MAX_COUNT = 6;

/** 需求里附件的元信息（`GroupAssetRef` 里这张图需要的字段）。 */
export interface GroupAssetLike {
  id: string;
  name?: string;
  kind: string;
  mimeType?: string;
  bytes?: number;
}

export interface PlannedGroupImage {
  id: string;
  label: string;
  mimeType: string;
  path: string;
  dataBase64: string;
}

export interface PlanGroupImagesResult {
  /** 已经读到字节、可以直接挂到请求上的图片附件。 */
  images: PlannedGroupImage[];
  /** 分片还没到 / 找不到本机路径：这一轮看不到它，要如实告诉模型。 */
  missing: string[];
  /** 到齐了但没交出去（太大 / 读失败 / 超条数）。 */
  skipped: string[];
}

/** 按扩展名猜 MIME（分片元信息里没写时用）。 */
function mimeForPath(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const table: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
  };
  return table[extension] ?? 'image/png';
}

/**
 * 规划「这条需求里的哪些图能交给模型」。
 *
 * `read` 由调用方注入（正式代码读文件，测试给假的），所以本函数没有副作用，
 * 也能在 Windows / macOS 上得到同一组结论。读文件是 **async** 的：一张上限 6 MB，
 * 同步读会把扩展宿主卡住（那正是「发送后界面卡一下」的来源）。
 */
export async function planGroupImages(input: {
  refs: readonly GroupAssetLike[];
  /** 分片落地后的本机路径：`{ [assetId]: path }`。 */
  paths: Readonly<Record<string, string>>;
  read: (path: string) => Promise<Buffer | undefined> | Buffer | undefined;
  maxBytes?: number;
  maxCount?: number;
}): Promise<PlanGroupImagesResult> {
  const maxBytes = input.maxBytes ?? GROUP_IMAGE_MAX_BYTES;
  const maxCount = input.maxCount ?? GROUP_IMAGE_MAX_COUNT;
  const images: PlannedGroupImage[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];

  for (const ref of input.refs) {
    if (ref.kind !== 'image') continue;
    const path = input.paths[ref.id];
    const label = (ref.name ?? '').trim() || '截图';
    if (!path) {
      missing.push(label);
      continue;
    }
    if (images.length >= maxCount) {
      skipped.push(label);
      continue;
    }
    /*
     * 元信息里写了字节数就先挡一次，省掉「读进内存才发现太大」；
     * 真实字节数仍然以读到的为准（分片元信息可能是发送端的估算）。
     */
    if (typeof ref.bytes === 'number' && ref.bytes > maxBytes) {
      skipped.push(label);
      continue;
    }
    const bytes = await input.read(path);
    if (!bytes || bytes.length === 0 || bytes.length > maxBytes) {
      skipped.push(label);
      continue;
    }
    images.push({
      id: ref.id,
      label,
      mimeType: ref.mimeType?.startsWith('image/') ? ref.mimeType : mimeForPath(path),
      path,
      dataBase64: bytes.toString('base64'),
    });
  }

  return { images, missing, skipped };
}

/** 把规划结果转成请求用的附件（`MessageContext`）。 */
export function toImageContexts(images: readonly PlannedGroupImage[]): MessageContext[] {
  return images.map((image) => ({
    label: image.label,
    kind: 'image' as const,
    mimeType: image.mimeType,
    path: image.path,
    dataBase64: image.dataBase64,
  }));
}
