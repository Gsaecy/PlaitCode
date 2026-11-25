import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';

/**
 * 读「用户在系统设置里看到的那台设备名」。
 *
 * 为什么不能直接用 `os.hostname()`：
 *  - 它是内核主机名（libuv 直接调 `gethostname(3)`），不等于设备名；
 *  - macOS 上常是 `Xxx-MacBook-Pro.local`（Bonjour 名 + 后缀），
 *    甚至可能因为你哪天 `scutil --set HostName` 设过而变成一个 IP；
 *  - Windows 上它是 DNS 主机名，而用户在「设置 → 系统 → 系统信息」里看到的是
 *    NetBIOS 名（≤15 字符），`DESKTOP-XXXXXXX` 这类重名就是这么来的。
 *
 * 所以按平台取用户可见的名字：
 *  - Windows：`COMPUTERNAME`（就是设置里那个名字，无需起进程）；
 *  - macOS：`scutil --get ComputerName`（用户在「共享」里设的名字）；
 *  - Linux：`/etc/hostname` 首行。
 *
 * 这是**唯一**允许在命令执行器之外起进程的地方（只读、固定参数、无 shell、
 * 有超时；见 searchBoundary 测试的白名单）。取不到就退回清理过的主机名。
 */
export function readDeviceName(): string {
  const name = platformName();
  return clean(name) || userFallback();
}

function platformName(): string {
  try {
    if (process.platform === 'win32') {
      return process.env.COMPUTERNAME ?? process.env.COMPUTER_NAME ?? hostname();
    }
    if (process.platform === 'darwin') {
      const computer = run('scutil', ['--get', 'ComputerName']);
      if (computer) return computer;
      const local = run('scutil', ['--get', 'LocalHostName']);
      if (local) return local;
      return hostname();
    }
    return readFileSync('/etc/hostname', 'utf8').split('\n')[0] ?? hostname();
  } catch {
    return hostname();
  }
}

function run(command: string, args: readonly string[]): string {
  try {
    return execFileSync(command, [...args], {
      timeout: 1_500,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).toString('utf8').trim();
  } catch {
    return '';
  }
}

/** 去掉 `.local`、旧格式里的「· win32」后缀和多余空白。 */
function clean(value: string): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  const stripped = text
    .replace(/\.local$/i, '')
    .replace(/\s*[·•]\s*(win32|windows|darwin|macos|osx|linux|android|web)\s*$/i, '')
    .trim();
  // 主机名被设成 IP 时，那不算「设备名」；宁可退回用户名也不显示一串数字。
  if (!stripped || /^\d{1,3}(\.\d{1,3}){3}$/.test(stripped)) return '';
  return stripped;
}

function userFallback(): string {
  try {
    const user = userInfo().username.trim();
    if (user) return user;
  } catch {
    // 取不到用户名只是显示不好看，不影响任何功能
  }
  return hostname().replace(/\.local$/i, '') || '设备';
}
