import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRequirement, requirementPromptForLocal, type SyncPeer } from '../sync/lanProtocol';

/**
 * 禁止「逐字一致」这类浪费（用户 2026-11-24）：
 *   Windows 的清单里出现「在 Windows 版本实现并与 macOS 两份保持逐字一致」，
 *   agent 于是花十几分钟比对两份不同平台的代码。
 *
 * 两台代码库本来就不同（语言、框架、目录都不一样），字面一致永远做不到；
 * 甲方要的是「用户看到的效果一样」。
 */
const local: SyncPeer = { id: 'p-win', name: 'PC · Windows', platform: 'win32', project: 'app', version: 't' };

function prompt(): string {
  const requirement = makeRequirement(local, '两个平台的功能对齐', 1, 'seed')!;
  requirement.project = 'app';
  requirement.repo = 'github.com/acme/app';
  return requirementPromptForLocal(requirement, local, [], { fromSelf: true });
}

test('明确只要求行为一致，不要求逐字一致', () => {
  const text = prompt();
  assert.match(text, /跨平台对齐只要求\*\*行为一致\*\*/, '要给出正确标准');
  assert.match(text, /禁止\*\*把「逐字一致/, '要明确禁止逐字一致');
});

test('禁止拆出跨机器 / 跨平台的比对条目', () => {
  const text = prompt();
  assert.match(text, /每条都必须是这台机器自己能做完的/, 'todo 必须本机可完成');
  assert.match(text, /不许写「与另一台保持逐字一致」/, '点名禁止这种条目');
});

test('禁止为了对齐去读对方的仓库或服务器', () => {
  assert.match(prompt(), /禁止为了对齐去读队友那台的仓库或服务器/, '不许跨机器读代码');
});

test('给出正确的对齐做法：各自实现 + 群里对效果', () => {
  assert.match(prompt(), /各自在本机实现，然后在群里用「用户能看到的效果」互相对一遍结论/, '要给出可执行做法');
});
