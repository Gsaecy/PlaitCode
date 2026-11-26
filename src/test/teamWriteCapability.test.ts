import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { requirementPromptForLocal, type SyncPeer } from '../sync/lanProtocol';
import { TEAM_CONVERSATION_MODE, needsTeamModeHeal, resolveModeForSend } from '../sync/teamTask';

/**
 * 「团队任务里的 agent 没有写文件能力」（用户实况 2026-11-25）
 *
 * agent 在群里说的是：「本轮会话只给了我读代码和跑命令两样，没有写文件那一项」。
 * 写工具本身是有的，能被两条独立机制悄悄拿掉：
 *  1. 团队任务对话落在**计划模式**（plan）—— 只下发只读工具；
 *  2. 群里的活没有被强制成执行模式。
 *
 * 以前这两条只能「读源码 + 正则」验证（源码改个写法就红、行为坏了却可能绿）。
 * 规则已经抽到 `sync/teamTask.ts`，这里**真的执行**它；提示词那段直接跑真实生成函数。
 */

const win: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 't' };
const mac: SyncPeer = { id: 'p-mac', name: 'guohongyu', platform: 'darwin', project: 'app', version: 't' };
const requirement = { kind: 'requirement', id: 'r1', from: win, title: '改点东西', detail: '改', createdAt: 1 } as never;

test('团队任务对话固定用执行模式（计划模式 = 只读，等于不给写工具）', () => {
  assert.equal(TEAM_CONVERSATION_MODE, 'agent');
  // 建对话用的就是它；钉住这一点，避免有人改回按界面模式/默认模式建。
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /createConversation\(title, settings\.model, TEAM_CONVERSATION_MODE\)/);
  assert.doesNotMatch(panel, /createConversation\(title, settings\.model, resolveActiveMode/);
});

test('历史上建成别的模式的团队任务对话，进来时修回执行模式（已经是就不重复写盘）', () => {
  assert.equal(needsTeamModeHeal('plan'), true, '计划模式必须修');
  assert.equal(needsTeamModeHeal('chat'), true);
  assert.equal(needsTeamModeHeal(undefined), true, '没有模式的旧记录也要修');
  assert.equal(needsTeamModeHeal('agent'), false, '已经是执行模式就不动它');
});

test('群里的活强制执行模式；普通对话仍然按存档 / 草稿 / 默认模式', () => {
  const draft = { defaultMode: 'chat' as const, draftMode: 'plan' as const };
  assert.equal(resolveModeForSend({ origin: 'sync', ...draft }), 'agent', '对端需求 → 干活');
  assert.equal(resolveModeForSend({ origin: 'group', ...draft }), 'agent', '群里发的 → 干活');
  assert.equal(resolveModeForSend({ ...draft }), 'plan', '普通对话行为不变：草稿优先于默认');
  assert.equal(resolveModeForSend({ ...draft, conversationMode: 'agent' }), 'agent', '存档优先于草稿');
  assert.equal(resolveModeForSend({ defaultMode: 'agent' }), 'agent');
});

test('只读档的提示词说清「授权解不开」，别让 agent 向甲方要改文件权限', () => {
  const withProject = { ...(requirement as object), project: 'app' } as never;
  const options = { fromSelf: true, peers: [win], projectName: 'app', projectRoot: '/work/app' } as const;
  const readOnly = requirementPromptForLocal(withProject, mac, [], { ...options, readOnly: true });
  assert.match(readOnly, /本轮是\*\*只读\*\*/, '要明确这一轮只读');
  assert.match(readOnly, /不看授权/, '要写明这一档不看授权');
  assert.match(readOnly, /不要向甲方索取/, '否则 agent 会去要一个根本给不出的权限');
  assert.match(readOnly, /切到需求所属项目/, '要告诉它真正的解锁办法');

  // 非只读档不能出现这段，否则 agent 会以为自己不能改文件。
  const normal = requirementPromptForLocal(withProject, mac, [], options);
  assert.doesNotMatch(normal, /本轮是\*\*只读\*\*/);
});
