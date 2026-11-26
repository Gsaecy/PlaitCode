/**
 * 打完包之后清掉旧的安装包。
 *
 * 用户要求：「每次生成安装包就把旧的删掉」。
 *
 * 目录里同时躺着多个版本的 `.vsix` 时，人和 Agent 都会装错版本 ——
 * 装错版本造成的「两台行为不一致」极难查（每次都以为是代码问题）。
 * 所以只保留 `package.json` 当前版本那一个，其余一律删除。
 *
 * 只删 `hwchat-*.vsix` 与 `<name>-<version>.vsix` 这类本扩展的产物，
 * 不碰其它文件。
 */
import { readdir, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const keep = `${manifest.name}-${manifest.version}.vsix`;

const entries = await readdir(root);
const removed = [];
for (const name of entries) {
  if (!name.toLowerCase().endsWith('.vsix')) continue;
  if (name === keep) continue;
  // 只清理本扩展的产物：`<package name>-<version>.vsix`
  if (!name.startsWith(`${manifest.name}-`)) continue;
  await unlink(join(root, name));
  removed.push(name);
}

if (removed.length) {
  console.log(`[clean-vsix] 已删除旧安装包：${removed.join('、')}`);
} else {
  console.log(`[clean-vsix] 只保留 ${keep}，没有需要清理的旧包`);
}
