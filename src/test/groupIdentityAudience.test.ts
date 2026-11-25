import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  makeGroupMessage,
  parseSyncMessage,
  renderGroupLine,
  requirementPromptForLocal,
  type SyncPeer,
} from '../sync/lanProtocol';
import { narrowToolNames, SYNC_READ_ONLY_PLAYBOOK } from '../agent/toolPlaybooks';

/**
 * 用户 2026-11-25 报的四个问题：
 *  1. 群信息里「绑定仓库」状态不对；
 *  2. 执行结束没回团队群（macOS 说「team_sync 未提供」；Windows 异常结束也没回）；
 *  3. 语音图标要扁平（见 groupPanel 的 SVG，另测）；
 *  4. 报数这种简单问题不该回一大堆；
 *  5. agent 要知道对方身份、用户身份，哪些是说给它听的。
 */

const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

const win: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 't', repo: 'github.com/acme/app' };
const mac: SyncPeer = { id: 'p-mac', name: 'guohongyu', platform: 'darwin', project: 'app', version: 't', repo: 'github.com/acme/app' };

test('1. 对端的 repo 必须过网，否则群信息永远显示「未绑定 GitHub 仓库」', () => {
  const parsed = parseSyncMessage({
    kind: 'group',
    id: 'g1',
    from: { id: 'p-mac', name: 'guohongyu', platform: 'darwin', project: 'app', version: 't', repo: 'https://github.com/Gsaecy/Personal-Workstation-OS.git' },
    author: 'agent',
    phase: 'analysis',
    body: '核对完了',
    requirementId: 'r1',
    at: 1,
  });
  assert.ok(parsed && parsed.kind === 'group');
  assert.equal(parsed.from.repo, 'github.com/gsaecy/personal-workstation-os', '仓库地址要归一化后保留');
});

test('2. 只读执行（项目不一致）时 team_sync 仍必须可用', () => {
  const all = ['read_file', 'write_file', 'run_command', 'team_sync', 'update_todos'];
  const kept = narrowToolNames(all, [SYNC_READ_ONLY_PLAYBOOK], false);
  assert.ok(kept.includes('team_sync'), '沟通能力不该被工具收窄剥夺');
  assert.ok(kept.includes('read_file'));
  assert.ok(!kept.includes('write_file'), '只读仍然不能写');
  assert.ok(!kept.includes('run_command'), '只读仍然不能跑命令');
});

test('2. 「群里的活」在起跑时定下来，回执不靠会丢的需求号', () => {
  assert.match(PANEL, /groupRun\?: boolean/, 'run 上要有群活标记');
  assert.match(PANEL, /options\?\.origin === 'group' \|\| options\?\.origin === 'sync'/, '按来源判定');
  assert.match(PANEL, /const isGroupRun = run\.groupRun === true/, '回执判据用标记');
});

test('4. 简单问题有可数的篇幅上限（不许一律长篇）', () => {
  const requirement = { kind: 'requirement' as const, id: 'r1', from: win, title: '报数', detail: '报数', createdAt: 1 };
  const prompt = requirementPromptForLocal(requirement, mac, [], { fromSelf: true, peers: [win] });
  assert.match(prompt, /最多 3 行/, '给出硬上限');
  assert.match(prompt, /禁止\*\*分节标题/, '禁止三段式模板');
});

test('5. 提示词里写清三方身份与「哪些是说给你听的」', () => {
  const requirement = { kind: 'requirement' as const, id: 'r1', from: win, title: '核对', detail: '核对双端同步', createdAt: 1 };
  const prompt = requirementPromptForLocal(requirement, mac, [], { fromSelf: false, peers: [win] });
  assert.match(prompt, /## 谁在说话/, '要有身份章节');
  assert.match(prompt, /甲方（用户）/, '要说清甲方是谁');
  assert.match(prompt, /你的乙方（产品经理）/.test(prompt) ? /乙方/ : /乙方（产品经理）/, '要说清自己是谁');
  assert.match(prompt, /只是参考\*\*，不要执行/, '说给别人的只参考');
  assert.match(prompt, /队友/, '要提到队友');
});

test('5. 群消息行标出「说给谁」', () => {
  const mine = makeGroupMessage(win, { author: 'user', phase: 'answer', body: '接着做', to: 'p-mac' }, 10, 'a')!;
  const line = renderGroupLine(mine, [win, mac], mac.id);
  assert.match(line, /说给本机/, '给本机的标清楚');

  const other = makeGroupMessage(win, { author: 'user', phase: 'answer', body: '接着做', to: 'p-win' }, 11, 'b')!;
  assert.match(renderGroupLine(other, [win, mac], mac.id), /说给 Windows · MAGICBOOKV14/, '给别人的标出是谁');

  const broadcast = makeGroupMessage(win, { author: 'user', phase: 'requirement', body: '加个开关' }, 12, 'c')!;
  assert.doesNotMatch(renderGroupLine(broadcast, [win, mac], mac.id), /说给/, '广播不加标注');
});

test('5. 回答的收件人过网（另一台据此只参考不执行）', () => {
  const answer = makeGroupMessage(win, { author: 'user', phase: 'answer', body: '接着做', to: 'p-mac', assignee: 'p-mac' }, 10, 'a')!;
  const parsed = parseSyncMessage(JSON.parse(JSON.stringify(answer)));
  assert.ok(parsed && parsed.kind === 'group');
  assert.equal(parsed.to, 'p-mac');
  const sync = readFileSync('src/sync/lanSync.ts', 'utf8');
  assert.match(sync, /message\.to \|\| message\.assignee \|\| question\?\.from\.id/, '接收端三层判据');
  assert.match(sync, /这台只参考不执行/, '不是给自己的只记录');
});

test('4. 收尾必须在群里说清「需要你做的」', () => {
  const requirement = { kind: 'requirement' as const, id: 'r1', from: win, title: '改点东西', detail: '改', createdAt: 1 };
  const prompt = requirementPromptForLocal(requirement, mac, [], { fromSelf: true, peers: [win] });
  assert.match(prompt, /需要你做的/, '要有这一节');
  assert.match(prompt, /不需要你做什么/, '没有也要明写');
});

test('3. 语音/附件按钮是扁平 SVG，不再用彩色 emoji', () => {
  const panel = readFileSync('src/views/groupPanel.ts', 'utf8');
  assert.match(panel, /id="voiceBtn"[\s\S]{0,220}<svg/, '语音按钮里要是 SVG');
  assert.doesNotMatch(panel, /id="voiceBtn"[^>]*>🎤/, '不能再是 emoji');
  assert.match(panel, /id="attachBtn"[\s\S]{0,220}<svg/, '附件按钮也要图标');
});
