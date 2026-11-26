import { strict as assert } from 'node:assert';
import test from 'node:test';
import { projectGate } from '../sync/projectGate';

/*
 * 项目门禁：判错一次的代价是「这一轮降成只读」，agent 会如实汇报
 * 「只给了我读代码和跑命令，没有写文件那一项」——甲方以为 agent 天生不能改文件。
 * 用户实况 2026-11-25 就是被这个误判卡住的。
 */

const REPO = 'https://github.com/gsaecy/personal-workstation-os';
const OTHER = 'https://github.com/gsaecy/plaitcode';

test('仓库地址一致 → 同一个项目（可以改文件）', () => {
  const result = projectGate({ theirRepo: REPO, myRepo: REPO, hasProject: () => false });
  assert.equal(result.mismatch, false);
  assert.equal(result.reason, 'same-repo');
});

test('仓库地址写法不同（ssh / 大小写 / .git）也算同一个', () => {
  const result = projectGate({
    theirRepo: REPO,
    myRepo: 'git@github.com:Gsaecy/Personal-Workstation-OS.git',
    hasProject: () => false,
  });
  assert.equal(result.mismatch, false);
  assert.equal(result.reason, 'same-repo');
});

test('本机另有那个仓库（另一个文件夹）→ 同一个项目', () => {
  const result = projectGate({
    theirRepo: REPO,
    myRepo: OTHER,
    hasProject: (value) => value.includes('personal-workstation-os'),
  });
  assert.equal(result.mismatch, false);
  assert.equal(result.reason, 'has-project');
});

test('仓库不同但项目名相同 → 同一个项目（别因为改名就只读）', () => {
  const result = projectGate({
    theirRepo: REPO,
    myRepo: OTHER,
    theirName: 'Personal-Workstation-OS',
    myName: 'personal-workstation-os',
    hasProject: () => false,
  });
  assert.equal(result.mismatch, false);
  assert.equal(result.reason, 'same-name');
});

test('本机认不出自己的仓库 → 不算「不同」，绝不因此降成只读', () => {
  // 没装 git / 没有 origin / .git/config 读不到都会走到这里。
  const result = projectGate({ theirRepo: REPO, myRepo: '', hasProject: () => false });
  assert.equal(result.mismatch, false, '没有依据就不能判「不同项目」');
  assert.equal(result.reason, 'unknown-own-repo');
});

test('两边都认得出且确实不同、本机也没有那个项目 → 只读', () => {
  const result = projectGate({
    theirRepo: REPO,
    myRepo: OTHER,
    theirName: 'Personal-Workstation-OS',
    myName: 'deepseek-hwchat',
    hasProject: () => false,
  });
  assert.equal(result.mismatch, true);
  assert.equal(result.reason, 'different-repo');
});

test('没有仓库信息时退回按项目名比较', () => {
  const sameName = projectGate({ theirName: 'demo', myName: 'demo', hasProject: () => false });
  assert.equal(sameName.mismatch, false);
  assert.equal(sameName.reason, 'same-name');

  const different = projectGate({ theirName: 'demo-a', myName: 'demo-b', hasProject: () => false });
  assert.equal(different.mismatch, true, '名字不同又都没有仓库地址，才按不同项目处理');
  assert.equal(different.reason, 'different-name');
});

test('双方都没给出可比的信号 → 不拦（空需求、老版本对端）', () => {
  const result = projectGate({ hasProject: () => false });
  assert.equal(result.mismatch, false);
  assert.equal(result.reason, 'no-signal');
});
