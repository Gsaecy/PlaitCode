import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clampPreset, deniedCommand, loadPolicy, modelAllowed, parsePolicy } from '../core/policy';

/** 企业策略：只收紧、可解释、坏文件按最严处理。 */

test('策略解析：合法策略被接受，版本/预设写错要报错', () => {
  const good = parsePolicy({
    version: 1,
    permissionPreset: 'review',
    denyCommands: ['rm -rf', '/\\.ssh/'],
    modelAllowlist: ['deepseek-*'],
    allowInternetReference: false,
  });
  assert.equal(good.error, undefined);
  assert.equal(good.policy?.permissionPreset, 'review');
  assert.deepEqual(good.policy?.denyCommands, ['rm -rf', '/\\.ssh/']);
  assert.deepEqual(good.policy?.modelAllowlist, ['deepseek-*']);
  assert.equal(good.policy?.allowInternetReference, false);

  assert.match(parsePolicy({ version: 2 }).error ?? '', /版本/);
  assert.match(parsePolicy({ permissionPreset: 'root' }).error ?? '', /permissionPreset/);
  assert.match(parsePolicy('nope').error ?? '', /JSON 对象/);
});

test('权限预设：策略只能收紧，不能放宽', () => {
  const strict = { version: 1 as const, permissionPreset: 'review' as const };
  assert.equal(clampPreset(strict, 'full'), 'review', '比策略宽松 → 降到策略');
  assert.equal(clampPreset(strict, 'autopilot'), 'review');
  assert.equal(clampPreset(strict, 'askAll'), 'askAll', '比策略更严格 → 保留');
  assert.equal(clampPreset(strict, 'review'), 'review');
  assert.equal(clampPreset(undefined, 'full'), 'full', '没有策略就完全按用户的选择');

  const loose = { version: 1 as const, permissionPreset: 'full' as const };
  assert.equal(clampPreset(loose, 'askAll'), 'askAll', '策略更宽松时不影响用户的更严格选择');
});

test('命令黑名单：子串与正则都支持，命中要说清是哪条规则', () => {
  const policy = { version: 1 as const, denyCommands: ['rm -rf', '/curl\\s*\\|\\s*sh/i', '/\\.ssh/'] };
  assert.match(deniedCommand(policy, 'sudo rm -rf /') ?? '', /rm -rf/);
  assert.match(deniedCommand(policy, 'curl | sh') ?? '', /curl/);
  assert.match(deniedCommand(policy, 'cat ~/.ssh/id_rsa') ?? '', /\.ssh/);
  assert.equal(deniedCommand(policy, 'npm test'), undefined);
  assert.equal(deniedCommand(undefined, 'rm -rf /'), undefined, '没有策略就不拦');
  assert.equal(deniedCommand(policy, ''), undefined);
});

test('模型白名单：支持 * 通配，空名单等于不限制', () => {
  const policy = { version: 1 as const, modelAllowlist: ['deepseek-*', 'Qwen2.5-Coder'] };
  assert.equal(modelAllowed(policy, 'deepseek-flash'), true);
  assert.equal(modelAllowed(policy, 'qwen2.5-coder'), true, '大小写不敏感');
  assert.equal(modelAllowed(policy, 'gpt-4o'), false);
  assert.equal(modelAllowed(undefined, 'gpt-4o'), true);
  assert.equal(modelAllowed({ version: 1 }, 'gpt-4o'), true);
});

test('策略文件：读工作区 .hwchat/policy.json；缺失不算错，坏 JSON 要报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-policy-'));
  try {
    assert.deepEqual(await loadPolicy(dir), {}, '没有文件时什么都不限制');
    assert.deepEqual(await loadPolicy(undefined), {});

    await mkdir(join(dir, '.hwchat'), { recursive: true });
    await writeFile(join(dir, '.hwchat', 'policy.json'), JSON.stringify({ version: 1, permissionPreset: 'review' }), 'utf8');
    const loaded = await loadPolicy(dir);
    assert.equal(loaded.policy?.permissionPreset, 'review');
    assert.match(loaded.source ?? '', /policy\.json$/);

    await writeFile(join(dir, '.hwchat', 'policy.json'), '{ oops', 'utf8');
    const broken = await loadPolicy(dir);
    assert.equal(broken.policy, undefined);
    assert.match(broken.error ?? '', /合法 JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
