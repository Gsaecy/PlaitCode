import assert from 'node:assert/strict';
import test from 'node:test';
import { readDeviceName } from '../sync/deviceInfo';
import { defaultDeviceName, defaultDeviceSeed, defaultPlatform } from '../sync/lanSync';

/**
 * 设备名用的是「用户在系统设置里看到的名字」，不是内核主机名。
 *
 * 依据：Node 的 `os.hostname()` 只是 libuv 调 `gethostname(3)`，
 * macOS 上常是 `Xxx.local` 甚至被设成 IP；Windows 上它是 DNS 主机名，
 * 而设置里显示的是 NetBIOS 名（≤15 字符，`DESKTOP-XXXXXXX` 重名的来源）。
 * 所以：Windows 用 `COMPUTERNAME`、macOS 用 `scutil --get ComputerName`、Linux 读 `/etc/hostname`。
 */

test('设备名不为空，且不是内核主机名那种 .local / IP 形式', () => {
  const name = readDeviceName();
  assert.ok(name.length > 0, '必须有名字');
  assert.doesNotMatch(name, /\.local$/i, '不能带 .local 后缀');
  assert.doesNotMatch(name, /^\d{1,3}(\.\d{1,3}){3}$/, '不能是一串 IP');
  assert.equal(name, name.trim());
});

test('defaultDeviceName 用同一套规则', () => {
  assert.equal(defaultDeviceName(), readDeviceName());
});

test('身份 id 的种子保持旧格式：升级不换身份', () => {
  const seed = defaultDeviceSeed();
  assert.match(seed, / · (win32|darwin|linux)$/, '必须是「主机名 · 平台」的旧格式');
  assert.ok(seed.endsWith(defaultPlatform()));
});

test('边界：起进程只允许命令执行器和这个只读取名的模块', () => {
  // 由 searchBoundary 测试守住白名单；这里只钉住「它确实是只读、有超时」。
  const source = require('node:fs').readFileSync('src/sync/deviceInfo.ts', 'utf8') as string;
  assert.match(source, /timeout: 1_500/, '必须有超时，不能卡住激活');
  assert.match(source, /execFileSync/, '不许走 shell');
  assert.doesNotMatch(source, /execSync\(|shell:\s*true/, '不许拼接命令行');
});
