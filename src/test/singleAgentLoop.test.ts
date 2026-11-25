import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makeRequirement, requirementPromptForLocal } from '../sync/lanProtocol';

/**
 * 一个脑子（用户 2026-11-24）：
 * 「我要的是聪明」——群消息不再先问一次 16-token 分类模型决定「回一句还是干活」，
 * 而是一律进 agent 循环，由同一个脑子判断。
 *
 * 参考 CowAgent（Agent Harness）：通道只收发，Agent Core 自己决定。
 */
const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
const PROTOCOL = readFileSync('src/sync/lanProtocol.ts', 'utf8');

test('群消息不再走分类器分流', () => {
  // 定位真正的群分支（send() 里 inFlight 那道闸也含同样的字符串，必须跳过）
  const share = PANEL.indexOf('shareRequirement(content');
  assert.ok(share > 0, '要能找到落成需求的那一行');
  const start = PANEL.lastIndexOf("options?.origin === 'group'", share);
  assert.ok(start > 0);
  const branch = PANEL.slice(start, start + 6_000);
  assert.doesNotMatch(branch, /classifyGroupIntent/, '群分支里不该再出现分类调用');
  assert.doesNotMatch(branch, /verdict\.intent/, '不该再按判定结果分两条路');
  assert.match(branch, /shareRequirement\(content/, '一律落成需求，进同一条会话跑一轮');
});

test('提示词里区分「只是问」和「要改代码」，问就带依据简短答', () => {
  assert.match(PROTOCOL, /只是问一件事/, '要有「只是问」的分支');
  assert.match(PROTOCOL, /必须给出依据/, '回答必须带依据，不能猜');
  assert.match(PROTOCOL, /答不出来就直说/, '不知道要承认，不许编');
});

test('提示词仍然带着项目标记和「只改这个目录」', () => {
  const local = { id: 'p', name: 'PC', platform: 'win32' as const, project: 'app', version: 't' };
  const requirement = makeRequirement(local, '改一下', 1, 'x')!;
  requirement.project = 'app';
  requirement.repo = 'github.com/acme/app';
  const prompt = requirementPromptForLocal(requirement, local, [], { projectRoot: 'D:/app' });
  assert.match(prompt, /【任务项目】app/);
  assert.match(prompt, /只改这个目录/);
  assert.match(prompt, /只是问一件事/, '新的判断规则也要在同一条提示词里');
});
