import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRequirement, requirementPromptForLocal } from '../sync/lanProtocol';
import type { SyncPeer } from '../sync/lanProtocol';

/**
 * 任务的项目标记（用户 2026-11-24）：
 * 「每个任务按时间段区分任务项目，执行过程做项目标记，哪个任务是哪个项目的，
 *   避免串项目执行导致混乱和错误。」
 */

const local: SyncPeer = { id: 'p-win', name: 'PC · Windows', platform: 'win32', project: 'app-win', version: 't' };

test('任务落库时就带项目名与仓库（按时间顺序各记各的）', () => {
  const first = makeRequirement(local, '改按钮', 1000, 'a')!;
  first.project = 'deepseek-hwchat';
  first.repo = 'github.com/gsaecy/plaitcode';

  const second = makeRequirement(local, '改标题栏', 2000, 'b')!;
  second.project = 'personal-workstation';
  second.repo = 'github.com/gsaecy/personal-workstation-os';

  assert.equal(first.project, 'deepseek-hwchat');
  assert.equal(second.project, 'personal-workstation');
  assert.notEqual(first.id, second.id, '两条任务必须是不同 id，不能互相覆盖');
  assert.ok(second.createdAt > first.createdAt, '按时间能分出先后，各自带着自己的项目');
});

test('执行提示词里带项目标记，并要求只改这个目录', () => {
  const requirement = makeRequirement(local, '把标题栏改成深色', 3000, 'c')!;
  requirement.project = 'deepseek-hwchat';
  requirement.repo = 'github.com/gsaecy/plaitcode';

  const prompt = requirementPromptForLocal(requirement, local, [], {
    projectRoot: 'D:/AI projects/deepseek-hwchat',
  });

  assert.match(prompt, /【任务项目】deepseek-hwchat/, '必须显式标出这条任务属于哪个项目');
  assert.match(prompt, /github\.com\/gsaecy\/plaitcode/, '项目 ID 要写进去');
  assert.match(prompt, /D:\/AI projects\/deepseek-hwchat/, '要给出本机对应目录');
  assert.match(prompt, /只改这个目录/, '要明确禁止改其它项目');
});

test('另一个项目的任务不会带上本项目的目录', () => {
  const requirement = makeRequirement(local, '改 mac 的窗口', 4000, 'd')!;
  requirement.project = 'personal-workstation';
  requirement.repo = 'github.com/gsaecy/personal-workstation-os';

  const prompt = requirementPromptForLocal(requirement, local, []);
  assert.match(prompt, /【任务项目】personal-workstation/);
  assert.doesNotMatch(prompt, /plaitcode/, '不同项目的任务不能混进上一个项目的身份');
});
