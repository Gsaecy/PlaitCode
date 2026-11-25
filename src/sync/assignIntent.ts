/**
 * 从一句话里认出「这条活派给哪台设备」。
 *
 * 用户实况（2026-11-24）：「它们区分不了语言的意思，我让 macos 执行任务，
 * Windows 这边也跑起来了」——他是在消息正文里说「macos 那边 agent」，
 * 而系统只认界面上那个「由谁执行」下拉框，于是两台都跑。
 *
 * 这里把「让 mac 做 / 交给 Windows / 在 macOS 上执行」这类话认出来，
 * 转成已有的 `assignee`（只让那一台执行）。识别刻意保守：
 * 必须同时出现**设备线索**和**指派词**，否则不算。
 */

export interface AssignCandidate {
  id: string;
  name: string;
  platform: string;
}

/** 平台别名：用户嘴上说的是「mac / 苹果 / Windows」，不是 `darwin`。 */
const PLATFORM_ALIASES: { platform: string; words: string[] }[] = [
  { platform: 'darwin', words: ['macos', 'mac os', 'mac', 'macbook', 'imac', 'darwin', '苹果', 'mac端'] },
  { platform: 'win32', words: ['windows', 'window', 'win11', 'win10', 'win', '微软', 'win端'] },
  { platform: 'linux', words: ['linux', 'ubuntu', 'linux端'] },
];

/**
 * 指派词：出现这些才认为是在指派，而不是在讨论。
 *
 * 「Windows 也能跑吗」是在提问，不该把任务硬塞给 Windows。
 */
const ASSIGN_WORDS = [
  '让', '交给', '由', '指派', '安排', '负责', '去执行', '来执行', '那边', '那台',
  '执行', '做这个', '来做', '跑这', '在',
];

function fold(value: string): string {
  return (value ?? '').toLocaleLowerCase();
}

/**
 * 认出这句话把活派给谁。
 *
 * 返回 `undefined` 表示「没指名道姓」→ 调用方保持原行为（所有人各自做）。
 * 只有**唯一命中**时才返回：一句话点了两台设备时不猜。
 */
export function resolveAssigneeFromText(
  message: string,
  devices: readonly AssignCandidate[],
): AssignCandidate | undefined {
  const text = fold(message);
  if (!text || !devices.length) return undefined;
  // 没有指派词就不是指派（「Windows 和 mac 的差异是什么」不该变成派活）。
  if (!ASSIGN_WORDS.some((word) => text.includes(word))) return undefined;

  const hits = devices.filter((device) => {
    /*
     * 设备名要**分段**比对。
     *
     * 名字形如 `MagicBookV14 · win32`，用户只会说「MagicBookV14」——
     * 拿整串去匹配永远对不上。
     */
    const tokens = [device.name, ...String(device.name ?? '').split(/[·|]/)]
      .map((part) => fold(part).trim())
      .filter((part) => part.length >= 3);
    if (tokens.some((token) => text.includes(token))) return true;
    // 平台别名出现（「macos」「苹果」「windows」）。
    const aliases = PLATFORM_ALIASES.find((item) => item.platform === device.platform)?.words ?? [];
    return aliases.some((word) => text.includes(word));
  });

  // 两台都命中（「mac 传给 windows」）→ 不猜。
  if (hits.length !== 1) return undefined;
  return hits[0];
}
