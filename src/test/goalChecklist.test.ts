import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRequirement, requirementPromptForLocal, type SyncPeer } from '../sync/lanProtocol';

/**
 * 「不达任务目标不罢休 + 自己逐项核对」（用户 2026-11-24）：
 *   「尽量分析任务拆解任务，方便最后 agent 自己一项项核对任务目标完成情况」
 *
 * 所以提示词必须强制三件事：
 *  1. 开工前把目标拆成**可验收**的清单（每条都能被验证）；
 *  2. 执行中逐项推进、逐项更新状态；
 *  3. 收尾时逐项核对并给证据；还有没做到的项就不许说「做完了」。
 */
const local: SyncPeer = { id: 'p-win', name: 'PC · Windows', platform: 'win32', project: 'app', version: 't' };

function prompt(): string {
  const requirement = makeRequirement(local, '把同步功能做出来', 1, 'seed')!;
  requirement.project = 'app';
  requirement.repo = 'github.com/acme/app';
  return requirementPromptForLocal(requirement, local, [], { fromSelf: true });
}

test('开工前要求拆成可验收清单，不许写无法验证的条目', () => {
  const text = prompt();
  assert.match(text, /先拆成可验收的清单/, '要强制拆清单');
  assert.match(text, /update_todos/, '要落到任务清单工具上');
  assert.match(text, /能被验证的结果/, '每条必须可验证');
  assert.match(text, /不许写「优化一下」「修一下」这类无法验证的条目/, '要禁止空话条目');
});

test('执行中逐项推进，不要最后一次性全标完成', () => {
  assert.match(prompt(), /每完成一项就更新清单状态/, '要逐项更新');
});

test('收尾必须逐项核对并给证据', () => {
  const text = prompt();
  assert.match(text, /必须逐项核对/, '要逐项核对');
  assert.match(text, /做到了 \/ 没做到/, '要给出逐项结论');
  assert.match(text, /要给出证据（哪个文件哪段、哪条命令输出、哪个界面现象）/, '要有证据要求');
});

test('还有没做到的项时不许说做完了（不达目标不罢休）', () => {
  const text = prompt();
  assert.match(text, /只要还有没做到的项，就不许说「做完了」/, '要禁止虚假完成');
  assert.match(text, /目标没达成不要收工/, '要明确不能收工');
  assert.match(text, /等群里答复后接着把这一项做完/, '要说明如何续做');
});
