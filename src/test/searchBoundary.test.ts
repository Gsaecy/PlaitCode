/**
 * 架构边界：搜索与子进程必须走统一入口。
 *
 * 这些断言不看「代码写得对不对」，只看「有没有人绕过唯一入口」：
 * - 任何 `workspace.findFiles` 都必须经过 `workspaceSearch` 的调度层
 *   （并发上限 / single-flight / 缓存失效 / 退避重试都只在那里实现）；
 * - 任何子进程都只能由 `toolExecutor` 的命令执行器发起（统一登记、整组终止）；
 * - 递归文件监听只允许出现在技能清单上（且已合并事件）。
 *
 * 为什么用静态断言：一旦有人图省事在别处直接调 `findFiles`，行为测试仍然会通过，
 * 只有真机上出现 `spawn rg EAGAIN` 时才会暴露。把边界钉在测试里，改动时就会红。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { DEFAULT_SEARCH_EXCLUDED_DIRS } from '../agent/workspaceSearch';

// 测试产物是 CJS（esbuild bundling），所以用 __dirname 而不是 import.meta.url。
const sourceRoot = join(dirname(__dirname), '..', 'src');

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'test') continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.name.endsWith('.ts')) files.push(full);
    }
  };
  await visit(sourceRoot);
  return files;
}

async function filesMatching(pattern: RegExp): Promise<string[]> {
  const matches: string[] = [];
  for (const file of await sourceFiles()) {
    const text = await readFile(file, 'utf8');
    if (pattern.test(text)) matches.push(relative(sourceRoot, file).split('\\').join('/'));
  }
  return matches.sort();
}

test('boundary: workspace.findFiles is only called by the search scheduler entry point', async () => {
  assert.deepEqual(await filesMatching(/workspace\.findFiles\s*\(/), ['agent/workspaceSearch.ts']);
});

test('boundary: child processes are only spawned by the command executor', async () => {
  /*
   * 两个例外，都是「扩展自己要跟系统说话」，不是替 agent 跑命令：
   *
   *  - `sync/deviceInfo.ts`：读「用户在系统设置里看到的那台设备名」
   *    （macOS 只有 `scutil --get ComputerName` 拿得到）；
   *  - `core/voiceWinRecognition.ts`：Windows 语音输入。麦克风只能由原生进程采集，
   *    而 VS Code 的 webview 没有麦克风权限（用户 2026-11-25 的 `not-allowed`）。
   *
   * 约束仍然是硬的：固定可执行文件、固定参数、**不拼 shell**、不吞用户输入、
   * 有超时/有上限，失败就如实上报。
   */
  assert.deepEqual(
    await filesMatching(/\bspawn\s*\(/),
    ['agent/toolExecutor.ts', 'core/voiceWinRecognition.ts'],
  );
  assert.deepEqual(
    await filesMatching(/from 'node:child_process'/),
    ['agent/toolExecutor.ts', 'core/voiceWinRecognition.ts', 'sync/deviceInfo.ts'],
  );

  // 语音那条路必须守住「固定参数、无 shell」：否则等于给 agent 开了一个后门。
  const voice = await readFile(join(sourceRoot, 'core/voiceWinRecognition.ts'), 'utf8');
  assert.match(voice, /spawn\('powershell\.exe', \['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file\]/);
  assert.doesNotMatch(voice, /shell:\s*true/, '语音子进程绝不允许走 shell');
  assert.doesNotMatch(voice, /exec\s*\(|execSync\s*\(/, '不要用 exec 把命令拼成字符串');
});

test('boundary: recursive file watching stays confined to the skill registry', async () => {
  assert.deepEqual(await filesMatching(/createFileSystemWatcher\s*\(/), ['agent/skillRegistry.ts']);
});

test('boundary: default search exclusions cover dependencies, build output and caches', () => {
  for (const required of ['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', '.venv', '__pycache__', 'DerivedData']) {
    assert.ok(DEFAULT_SEARCH_EXCLUDED_DIRS.includes(required), `默认排除列表缺少 ${required}`);
  }
});

/** 取一个类方法的方法体（按花括号配对，只用于静态断言）。 */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `找不到方法：${signature}`);
  const open = source.indexOf('{', start);
  assert.ok(open >= 0, `方法没有方法体：${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`方法体没有闭合：${signature}`);
}

test('boundary: re-sending panel state never starts a skill (workspace) scan', async () => {
  const panel = await readFile(join(sourceRoot, 'views/chatPanel.ts'), 'utf8');
  // 每次状态重发都全工作区扫技能是真实故障：一次操作链里状态会重发十几遍。
  assert.doesNotMatch(methodBody(panel, 'private async sendState('), /skills\.refresh/);
  // 但发送消息前依然要刷新一次，保证模型拿到的是最新技能清单。
  assert.match(panel, /prepareSkillsForSend\(/);
});
