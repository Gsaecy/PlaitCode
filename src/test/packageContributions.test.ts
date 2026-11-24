/**
 * 扩展会写哪些配置项，`package.json` 就必须声明哪些。
 *
 * 漏声明的后果不是"读不到默认值"，而是**命令直接抛错**：
 * `settings.update()` 遇到未注册的 key 会报
 * `没有注册配置 plaitcode.xxx，因此无法写入 用户设置`。
 * 「新建跨网频道」就这么坏过一次——读的时候没问题，一写就崩。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SRC = join(process.cwd(), 'src');

/** 递归列出所有 .ts 源文件（跳过测试目录：测试里的 update 是 mock，不写真实配置）。 */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'test') continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (name.endsWith('.ts')) found.push(full);
  }
  return found;
}

/** 源码里所有 `getConfiguration('plaitcode').update('<key>'` 的 key。 */
function writtenKeys(): string[] {
  const keys = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/getConfiguration\('plaitcode'\)\.update\(\s*'([^']+)'/g)) {
      keys.add(`plaitcode.${match[1]}`);
    }
  }
  return [...keys].sort();
}

test('扩展写过的每个配置项都在 package.json 里声明了', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    contributes?: { configuration?: { properties?: Record<string, unknown> } };
  };
  const properties = pkg.contributes?.configuration?.properties;
  assert.ok(properties, 'package.json 里找不到 contributes.configuration.properties');

  const keys = writtenKeys();
  assert.ok(keys.length > 0, '没扫到任何配置写入，正则或目录结构可能变了');
  const missing = keys.filter((key) => !(key in properties));
  assert.deepEqual(missing, [], `这些配置项被代码写入但没声明：${missing.join(', ')}`);
});

test('跨网中继地址是可写的字符串配置（「新建 / 加入跨网频道」靠它落盘）', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    contributes?: { configuration?: { properties?: Record<string, { type?: string; default?: unknown }> } };
  };
  const relay = pkg.contributes?.configuration?.properties?.['plaitcode.relay.url'];
  assert.ok(relay, '缺少 plaitcode.relay.url');
  assert.equal(relay.type, 'string');
  assert.equal(relay.default, '');
});
