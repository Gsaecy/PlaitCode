/**
 * 项目身份 = **GitHub 仓库地址**，不是文件夹名。
 *
 * 同一个仓库在两台设备上可以叫不同文件夹名（`app` / `my-app`），
 * 那不算两个项目；反过来，两个不同仓库即使文件夹同名，也不是同一个项目。
 * 所以统一把各种写法归一成 `github.com/owner/repo` 再比较。
 */

/**
 * 归一化仓库地址。
 *
 * 认得的写法：
 *   https://github.com/owner/repo.git
 *   http://github.com/owner/repo/
 *   git@github.com:owner/repo.git
 *   ssh://git@github.com/owner/repo.git
 *   github.com/owner/repo
 *
 * 认不出来（本地路径、没有 remote）返回空串 —— 调用方据此退回「按文件夹名」。
 */
export function normalizeRepoUrl(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';

  let host = '';
  let path = '';

  const scp = raw.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  if (/^[a-zA-Z][\w+.-]*:\/\//.test(raw)) {
    // 带协议的 URL
    try {
      const url = new URL(raw);
      host = url.hostname.toLowerCase();
      path = url.pathname;
    } catch {
      return '';
    }
  } else if (scp && !/^[a-zA-Z]:[\\/]/.test(raw)) {
    // git@host:owner/repo 形式（Windows 盘符已在上面的排除里）
    host = (scp[1] ?? '').toLowerCase();
    path = scp[2] ?? '';
  } else {
    // host/owner/repo（没有协议）
    const plain = raw.replace(/^\/+/, '').match(/^([^/]+\.[^/]+)\/(.+)$/);
    if (!plain) return '';
    host = (plain[1] ?? '').toLowerCase();
    path = plain[2] ?? '';
  }

  const segments = path
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length < 2 || !host) return '';
  // 只要 owner/repo 两段：带上后面的子路径会让同一个仓库变成两个。
  const owner = (segments[0] ?? '').toLowerCase();
  const repo = (segments[1] ?? '').toLowerCase();
  if (!owner || !repo) return '';
  return `${host}/${owner}/${repo}`;
}

/** 给人看的短名：`owner/repo`。 */
export function repoSlug(input: string): string {
  const full = normalizeRepoUrl(input);
  if (!full) return '';
  const parts = full.split('/');
  return parts.slice(-2).join('/');
}

/**
 * 两个设备算不算「同一个项目」。
 *
 * 都认得出仓库地址 → **按仓库地址比**（文件夹名无关）；
 * 有一边认不出（本地没 remote）→ 退回按文件夹名比，避免把能用的场景堵死。
 */
export function sameProject(
  left: { repo?: string; project?: string },
  right: { repo?: string; project?: string },
): boolean {
  const leftRepo = normalizeRepoUrl(left.repo ?? '');
  const rightRepo = normalizeRepoUrl(right.repo ?? '');
  if (leftRepo && rightRepo) return leftRepo === rightRepo;
  return Boolean(left.project) && left.project === right.project;
}

/**
 * 「这个群里的项目对不上」要提示的那句话；对得上就返回空串。
 *
 * 关键：**只在真的对不上时才说**。以前这里拿「本机的仓库地址」直接和
 * 「对方的项目名」比，同一个项目也会被报成不一致 —— 群里明明两边仓库相同，
 * 顶上却挂着一条红字，把真正的差异也一起带偏了。
 */
export function projectMismatchText(
  mine: { repo?: string; project?: string },
  others: readonly { name: string; repo?: string; project?: string }[],
): string {
  const mineRepo = normalizeRepoUrl(mine.repo ?? '');
  const mismatched = others.filter((item) => {
    const theirRepo = normalizeRepoUrl(item.repo ?? '');
    /*
     * 只有**同一口径**才敢下结论：
     *  - 两边都有仓库地址 → 比仓库地址；
     *  - 两边都没有 → 比文件夹名；
     *  - 只有一边有 → 说的是两回事（地址 vs 名字），宁可不说，也不能报假警。
     */
    if (mineRepo && theirRepo) return mineRepo !== theirRepo;
    if (!mineRepo && !theirRepo) return Boolean(item.project) && Boolean(mine.project) && item.project !== mine.project;
    return false;
  });
  if (!mismatched.length) return '';
  const mineLabel = mineRepo || mine.project || '（未选）';
  const theirs = mismatched
    .map((item) => `${item.name} 在做 ${normalizeRepoUrl(item.repo ?? '') || item.project || '（未选）'}`)
    .join('；');
  return `本机 ${mineLabel}；${theirs}`;
}
