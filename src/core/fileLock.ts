import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 跨进程文件锁。
 *
 * 为什么需要（2026-11-08 外部评审 ⑦）：`SingleFlight` 只合并**同一个扩展宿主进程**里的
 * 并发写。开两个 VS Code 窗口就是两个宿主，各自持有一份 manifest 内存快照，
 * 后写覆盖先写 —— 会话会从索引里消失；两个窗口同时跑清理，还可能删掉对方正在
 * 读的 `payloads/`。
 *
 * 实现用 `open(path, 'wx')`（= O_CREAT|O_EXCL），这是 POSIX 与 Windows 上
 * 都能用的原子创建语义，不依赖额外依赖。锁文件里写持有者 token：
 * 释放时先读回内容，只有仍是自己的 token 才删 —— 避免「超时被抢占后又删掉别人的锁」。
 */

export interface LockOptions {
  /** 最多等多久拿锁。0 表示只试一次。 */
  timeoutMs?: number;
  /** 超过这个时长的锁视为陈旧（进程崩溃留下的），允许接管。 */
  staleMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * 陈旧阈值。
 *
 * 临界区只有「读一次 + 两次原子写」，正常是几十毫秒；以前给 30 秒，
 * 意味着扩展被强杀（macOS 上重载窗口很常见）之后留下的锁要等半分钟才能接管，
 * 而拿锁超时是 5 秒 —— 于是必然抛「拿不到文件锁」。
 * 现在主要靠 **pid 判活**（见下），mtime 只作兜底。
 */
const DEFAULT_STALE_MS = 10_000;

/**
 * 锁的持有者进程还活着吗。
 *
 * 锁文件内容是 `pid:timestamp:random`。同机判活用 `process.kill(pid, 0)`：
 * - 抛 `ESRCH` → 进程已不存在 → 锁是崩溃残留，可以立刻接管；
 * - 抛 `EPERM` → 进程存在但没权限发信号 → 仍然算活着；
 * - 解析不出 pid（旧格式/被改写）→ 不知道，交给 mtime 判断。
 *
 * 为什么必须这么做：扩展被强杀 / 重载窗口之后锁文件还在，
 * 只看 mtime 要等满 staleMs，用户看到的就是「拿不到文件锁」的弹窗。
 */
function holderAlive(token: string): boolean | undefined {
  const pid = Number.parseInt(String(token).split(':')[0] ?? '', 10);
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 尝试拿锁；拿到返回释放函数，拿不到返回 `undefined`。
 *
 * `timeoutMs: 0` 时是非阻塞的「只试一次」，用于「选主」类场景（清理主）。
 */
export async function tryFileLock(lockPath: string, options: LockOptions = {}): Promise<(() => Promise<void>) | undefined> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const staleMs = Math.max(1_000, options.staleMs ?? DEFAULT_STALE_MS);
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  await mkdir(dirname(lockPath), { recursive: true });

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(token, 'utf8');
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const current = await readFile(lockPath, 'utf8');
          if (current !== token) return; // 已被别人接管：不能删
          await unlink(lockPath);
        } catch {
          /* 锁文件已不在：说明已被清理，正常。 */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      /*
       * 占着锁的那个进程还在不在。
       *
       * 以前这里只比 mtime：进程崩了（扩展被强杀、重载窗口）留下的锁，
       * 在 staleMs 到期前谁也拿不到 —— 用户看到「拿不到文件锁」。
       * 现在先看 pid：死了就立刻接管，不管它多新。
       */
      let alive: boolean | undefined;
      try {
        const content = await readFile(lockPath, 'utf8');
        alive = holderAlive(content);
        if (alive === false) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
      } catch {
        // 读不到（刚好被释放 / 权限）→ 继续按 mtime 判断
      }
      /*
       * pid 明确活着 → **绝不接管**，哪怕 mtime 很旧。
       *
       * 只看 mtime 的旧行为在这里是危险的：一个健康但写得慢的宿主，
       * 锁会被另一个窗口抢走，两个宿主同时写 manifest —— 会话从索引里消失。
       */
      if (alive === true) {
        if (Date.now() >= deadline) return undefined;
        await sleep(20 + Math.random() * 30);
        continue;
      }
      // 判不出 pid（旧格式锁）时才退回 mtime：陈旧就接管，否则等。
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleMs) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
      } catch {
        continue; // 刚好被释放，立刻重试
      }
      if (Date.now() >= deadline) return undefined;
      await sleep(20 + Math.random() * 30);
    }
  }
}

/**
 * 拿不到锁。
 *
 * 单独一个类型，是为了让调用方能区分「暂时被别人占着」和「真的出错（磁盘满/权限）」：
 * 前者应该稍后重试，**不该弹给用户**（用户看到的就是「拿不到文件锁」的弹窗）。
 */
export class FileLockTimeoutError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string) {
    super(`拿不到文件锁：${lockPath}`);
    this.name = 'FileLockTimeoutError';
    this.lockPath = lockPath;
  }
}

/** 拿锁执行；拿不到就抛错（用于「必须串行」的写路径）。 */
export async function withFileLock<T>(lockPath: string, task: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const release = await tryFileLock(lockPath, options);
  if (!release) throw new FileLockTimeoutError(lockPath);
  try {
    return await task();
  } finally {
    await release();
  }
}
