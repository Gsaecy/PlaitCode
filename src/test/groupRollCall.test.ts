import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isRollCallCommand, rollCallNumber } from '../sync/groupIntent';
import { requirementPromptForLocal, type SyncPeer } from '../sync/lanProtocol';

/**
 * 用户 2026-11-25：「报数不是应该报 1、2、3、4 吗？为什么 agent 回复这么复杂」
 *
 * 报数是喊号，不是任务：每台只回自己的序号，不跑 agent、不建需求、
 * 不报项目 / 分支 / 提交。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');

const win: SyncPeer = { id: 'p-win', name: 'MAGICBOOKV14', platform: 'win32', project: 'app', version: 't' };
const mac: SyncPeer = { id: 'p-mac', name: 'guohongyu', platform: 'darwin', project: 'app', version: 't' };

test('报数口令：整句才算，带任务的话不算', () => {
  for (const text of ['报数', ' 报数！', '报数。', '报到', '点名', 'roll call', 'ROLL-CALL']) {
    assert.equal(isRollCallCommand(text), true, `${text} 应该认成报数`);
  }
  assert.equal(isRollCallCommand('报数之后把结果写进 README'), false, '带任务的话不能当喊号');
  assert.equal(isRollCallCommand('报一下情况'), false, '要汇报情况就走正常问答');
  assert.equal(isRollCallCommand(''), false);
});

test('序号按设备 id 排，两台各算各的也不会撞号', () => {
  const roster = [win, mac];
  const forward = [rollCallNumber(win.id, roster), rollCallNumber(mac.id, roster)];
  assert.deepEqual([...forward].sort(), [1, 2], '两台各占一个号');
  assert.deepEqual(
    [rollCallNumber(win.id, [mac, win]), rollCallNumber(mac.id, [mac, win])],
    forward,
    '连接顺序反过来结果一样',
  );
  assert.equal(rollCallNumber('unknown', roster), 1, '对不上设备时至少有个号');
});

test('本机喊报数：挡在「停上一轮 / 落成需求」之前，正文只有一个数字', () => {
  const rollCall = PANEL.indexOf('isRollCallCommand(content)');
  assert.ok(rollCall > 0, '群里发的话要先认报数');
  assert.ok(rollCall < PANEL.indexOf('this.pendingSends.has(sendKey)'), '报数不能把正在跑的任务停掉');
  assert.ok(rollCall < PANEL.indexOf('shareRequirement(content'), '报数必须挡在落成需求之前');

  const post = PANEL.slice(PANEL.indexOf('private async postRollCall'), PANEL.indexOf('private async answerInGroup'));
  assert.match(post, /detached: true/, '报数不挂在最近一条需求上');
  const reply = PANEL.slice(PANEL.indexOf('private async replyRollCall'), PANEL.indexOf('private async answerInGroup'));
  assert.match(reply, /body: String\(rollCallNumber\(local\.id, roster\)\)/, '正文只有序号');
  assert.match(reply, /detached: true/, '序号也不污染任务看板');
  assert.doesNotMatch(reply, /deviceLabel|project|commit/, '不带设备名 / 项目 / 提交');
});

test('对端喊报数也只回序号，不跑问答模型', () => {
  const body = PANEL.slice(
    PANEL.indexOf('async answerRemoteGroupChat'),
    PANEL.indexOf('async sendGroupMessage'),
  );
  assert.match(body, /isRollCallCommand\(text\)[\s\S]{0,80}replyRollCall\(\)/, '先认报数，再走项目 / 模型分支');
});

test('提示词也钉住：报数只写序号，不主动汇报状态', () => {
  const prompt = requirementPromptForLocal(
    { kind: 'requirement' as const, id: 'r1', from: win, title: '报数', detail: '报数', createdAt: 1 },
    mac,
    [],
    { fromSelf: true, peers: [win] },
  );
  assert.match(prompt, /只写你自己的序号/);
  assert.match(prompt, /不要主动汇报分支/);
});
