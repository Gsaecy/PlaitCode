import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 跑完必须回群（用户 2026-11-24）：
 * 「macos 端的，执行完任务后没有回答我消息（我暂停改了权限，它们自动继续运行了，运行完没回消息）」
 *
 * 根因：一轮结束只写了账本（`report`），**没写群**；而群里的结果全靠模型自己调
 * `team_sync`，它没调（或被暂停后续跑）群里就静悄悄的。
 *
 * 这条测试盯住「确定性回执」这件事，防止以后又被改回「靠模型自觉」。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

test('一轮跑完会确定性回群，不只写账本', () => {
  const index = PANEL.indexOf('private async reportSyncOutcome');
  assert.ok(index > 0, '找不到 reportSyncOutcome');
  const body = PANEL.slice(index, index + 1_800);
  assert.match(body, /postGroupOutcome/, '跑完必须调用回群逻辑');
  assert.match(PANEL, /phase: 'result'/, '成功回 result');
});

test('模型已经自己报过结果就不重复发', () => {
  const index = PANEL.indexOf('private async postGroupOutcome');
  assert.ok(index > 0, '找不到 postGroupOutcome');
  const body = PANEL.slice(index, index + 1_600);
  assert.match(body, /already/, '要有去重判断');
  assert.match(body, /item\.phase === 'result' \|\| item\.phase === 'blocked'/, '按 result/blocked 去重');
  assert.match(body, /if \(already\) return;/, '已报过就直接返回');
});

test('项目信息进结构化 meta，不再拼进正文', () => {
  const index = PANEL.indexOf('private async postGroupOutcome');
  const body = PANEL.slice(index, index + 3_000);
  assert.match(body, /meta: \{/, '项目/用时/文件走 meta');
  assert.match(body, /\.\.\.\(project \? \{ project \} : \{\}\)/, '项目进 meta');
  assert.doesNotMatch(body, /【项目 \$\{project/, '正文里不再写【项目 X】');
  assert.match(body, /requirementId/, '要带上需求号，才能和任务对上');
});
