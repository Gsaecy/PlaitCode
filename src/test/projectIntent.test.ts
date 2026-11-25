import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProjectFromText } from '../sync/projectIntent';

const PROJECTS = [
  { name: 'deepseek-hwchat', repo: 'github.com/gsaecy/plaitcode' },
  { name: 'personal_workstation', repo: 'github.com/gsaecy/personal-workstation-os' },
];

test('说「用 xxx 项目」就切到那个项目', () => {
  const hit = resolveProjectFromText('用 deepseek-hwchat 项目', PROJECTS);
  assert.equal(hit?.name, 'deepseek-hwchat');
});

test('分隔符和大小写不影响认出项目', () => {
  assert.equal(resolveProjectFromText('换成 DeepSeek HWChat', PROJECTS)?.name, 'deepseek-hwchat');
  assert.equal(resolveProjectFromText('切到 personal workstation', PROJECTS)?.name, 'personal_workstation');
});

test('说仓库名也能认出项目', () => {
  assert.equal(resolveProjectFromText('切换到 plaitcode', PROJECTS)?.name, 'deepseek-hwchat');
});

test('只是提到项目名、没有切换意图时不当成切换', () => {
  assert.equal(resolveProjectFromText('deepseek-hwchat 那个 bug 修了吗', PROJECTS), undefined);
});

test('后半段是长需求时不抢当成切项目', () => {
  const message = '用 deepseek-hwchat 把群聊窗口的邀请码收起逻辑重新改一遍，并且补上两台设备的项目对齐提示文案';
  assert.equal(resolveProjectFromText(message, PROJECTS), undefined);
});

test('一句话点了两个项目时不猜', () => {
  assert.equal(
    resolveProjectFromText('把 deepseek-hwchat 和 personal_workstation 都切过去', PROJECTS),
    undefined,
  );
});

test('没有可切换的项目时什么也不做', () => {
  assert.equal(resolveProjectFromText('用 deepseek-hwchat', []), undefined);
});
