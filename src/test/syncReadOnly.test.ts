import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SYNC_READ_ONLY_PLAYBOOK, blockedToolReason, narrowToolNames } from '../agent/toolPlaybooks';

/**
 * 项目不一致时要能「答」但不能「改」（用户 2026-11-24）：
 * 「同样的报数要求，macOS 直接回复了两个项目不一致，Windows 打开对话框去执行了」
 * —— 以前项目门禁直接拒绝，连「报数」这种不用改代码的话都被挡住。
 *
 * 现在改成只读执行：能读、能答、能查，不能写。写意图也不能撤销收窄。
 */
const LAN = readFileSync('src/sync/lanSync.ts', 'utf8');

const ALL = [
  'read_file', 'search_files', 'list_directory', 'update_todos',
  'write_file', 'delete_file', 'apply_patch', 'run_command', 'run_in_terminal',
];

test('只读档保留读工具，拿走写工具', () => {
  const kept = narrowToolNames(ALL, [SYNC_READ_ONLY_PLAYBOOK], false);
  for (const name of ['read_file', 'search_files', 'list_directory', 'update_todos']) {
    assert.ok(kept.includes(name), `只读时应当保留 ${name}`);
  }
  for (const name of ['write_file', 'delete_file', 'apply_patch']) {
    assert.ok(!kept.includes(name), `只读时必须拿走 ${name}`);
  }
});

test('即使这句话里有写意图，只读收窄也不撤销', () => {
  // writingRequested = true 表示用户说了「改/修/加」这类词。
  const kept = narrowToolNames(ALL, [SYNC_READ_ONLY_PLAYBOOK], true);
  assert.ok(!kept.includes('write_file'), '只读档是安全阀，写意图不能把它撤销');
  assert.equal(SYNC_READ_ONLY_PLAYBOOK.narrowWrites, false, 'narrowWrites 必须是 false');
});

test('执行期硬拒：模型硬调写工具会被拒绝', () => {
  assert.ok(blockedToolReason('write_file', [SYNC_READ_ONLY_PLAYBOOK], true), '写工具必须被拒');
  assert.equal(blockedToolReason('read_file', [SYNC_READ_ONLY_PLAYBOOK], true), undefined, '读工具要放行');
});

test('项目不一致不再直接拒绝，而是只读执行', () => {
  assert.match(LAN, /readOnly: true/, '要走只读执行');
  assert.match(LAN, /照常回答/, '并且要在群里说明「照常回答，但只读」');
});

test('只读执行仍然要报需求号，否则对端账本永远停在「已开始」', () => {
  assert.match(LAN, /runRequirement\(item, \{ readOnly: true \}\)/, '只读也要真的跑一轮');
});
