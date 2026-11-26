import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConversationStorage } from '../core/storage';
import { ChatPanel } from '../views/chatPanel';
import { requirementPromptForLocal } from '../sync/lanProtocol';
import {
  requirementIdOfPrompt,
  rotatedTeamTitle,
  shouldRotateTeamConversation,
  teamConversationTooLarge,
  TEAM_CONVERSATION_MAX_MESSAGES,
  TEAM_CONVERSATION_MAX_TOKENS,
} from '../sync/teamRotation';

/*
 * 协作模式为什么费 token —— 2026-11-26 的实测账。
 *
 * 机器上那条「团队任务」对话：**299 条消息 / 5.65 亿 tokens / 32.8 MB**，
 * 里面躺着 **76 条**「这一条对话太长了，已换一条新的继续」的交接说明。
 * 也就是说轮换判定每次都命中了、每次都写了交接，但**换新从来没发生**：
 * 换新之后按标题找对话时用的 `listConversations()` 把归档的一起返回，
 * 于是当场把刚归档的那条解除归档、原样接着用。
 *
 * 结果就是同一条对话无限增长，而模型每一步都要把它重读一遍。
 * 下面的用例把「轮换必须真的换新」钉在可执行的层面。
 */

test('换新需求就换对话，同一需求的后续（回答 / 打断）不换', () => {
  const summary = { messageCount: 12, totalTokens: 900_000 };
  assert.equal(
    shouldRotateTeamConversation({ summary, previousRequirementId: 'req-a', requirementId: 'req-b' }),
    true,
    '新需求必须换新对话（把上一条的工具流水带进来纯属重复付费）',
  );
  assert.equal(
    shouldRotateTeamConversation({ summary, previousRequirementId: 'req-a', requirementId: 'req-a' }),
    false,
    '同一条需求的追问 / 回答必须留在同一条对话里',
  );
  assert.equal(
    shouldRotateTeamConversation({ summary, previousRequirementId: 'req-a', requirementId: 'req-b', keepFor: 'req-a' }),
    false,
    '被打断后接着做：上一轮读过的文件正是这一轮要用的，不能换',
  );
});

test('体量兜底已取消：认不出需求号时**不换**（这条导致队友消息进错对话）', () => {
  /*
   * 2026-11-26 的真实现场：30 分钟里归档了 8 条「团队任务（xx:xx 归档）」，
   * 每条只有 3–5 条消息 —— 因为每收到一条队友消息（没有需求号）都命中了体量兜底。
   * 消息确实进了「团队任务」对话，但进的是刚新建的那条，用户看的那条就「没有新消息」。
   *
   * 体量不再靠换对话控制：请求体由 `planTeamCompaction` 在 85% 压缩，
   * 里程碑交付后整体清空。换对话的唯一依据是「换了需求」。
   */
  assert.equal(
    shouldRotateTeamConversation({ summary: { messageCount: TEAM_CONVERSATION_MAX_MESSAGES, totalTokens: 1 } }),
    false,
    '没有需求号就不换（哪怕消息数早就超了上限）',
  );
  assert.equal(
    shouldRotateTeamConversation({ summary: { messageCount: 3, totalTokens: TEAM_CONVERSATION_MAX_TOKENS } }),
    false,
    '没有需求号就不换（哪怕 token 超了上限）',
  );
  // 体量判定本身仍然可用（压缩/诊断要用它），只是不再当换对话的依据。
  assert.equal(teamConversationTooLarge({ messageCount: TEAM_CONVERSATION_MAX_MESSAGES }), true);
  /*
   * 同一条需求即使很大也**不换**：甲方的追问必须接着上一轮的工具上下文，
   * 换掉等于让 agent 从头再查一遍。同一需求内的体量由硬折叠负责。
   */
  assert.equal(
    shouldRotateTeamConversation({
      summary: { messageCount: 200, totalTokens: 50_000_000 },
      previousRequirementId: 'req-a',
      requirementId: 'req-a',
    }),
    false,
    '同一条需求内的追问 / 回答不换对话',
  );
  assert.equal(
    shouldRotateTeamConversation({ summary: { messageCount: 0 }, requirementId: 'req-a' }),
    false,
    '还没说过话的对话不该被换掉',
  );
  assert.equal(shouldRotateTeamConversation({ summary: undefined }), false);
});

test('从协议提示词里认得出需求号（重载之后也能还原）', () => {
  const prompt = requirementPromptForLocal(
    {
      id: 'req-abc123',
      from: { id: 'dev-win', name: 'HWChat · PC · Windows' },
      title: '把同步状态显示到标题栏',
      detail: '我要在标题栏看到同步状态。',
      project: 'deepseek-hwchat',
    } as never,
    { id: 'dev-win', name: 'HWChat · PC · Windows' } as never,
    [],
    { peers: [] },
  );
  assert.equal(requirementIdOfPrompt(prompt), 'req-abc123');
  assert.equal(requirementIdOfPrompt('随便一句话'), '');
  assert.equal(requirementIdOfPrompt(undefined), '');
});

test('轮换真的换新：改名归档后，按标题找回来的是「没有对话」', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hwchat-rotate-'));
  try {
    const storage = new ConversationStorage(root);
    await storage.initialize();
    const first = await storage.createConversation('团队任务');
    await storage.appendMessage(first.id, { role: 'user', content: '甲方提出了一个需求（需求号 r1）。' });

    // 模拟面板的轮换：先改名，再归档。
    await storage.setTitle(first.id, rotatedTeamTitle('团队任务', '21:40'));
    await storage.setArchived(first.id, true);

    const title = '团队任务';
    const active = (await storage.listConversations()).find((item) => item.title === title);
    assert.equal(active, undefined, '轮换出去的那条不能再被「按标题」找回来（否则轮换等于没换）');

    // 关群 / 重开群：那条没改名，找得到，解除归档后继续用同一条。
    const hidden = await storage.createConversation('团队任务');
    await storage.setArchived(hidden.id, true);
    const reused = (await storage.listConversations()).find((item) => item.title === title);
    assert.equal(reused?.id, hidden.id, '关群隐藏的那条仍要能被重开群复用（不新建对话）');
    assert.equal(reused?.archived, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * 面板那一侧的真路径：`ensureGroupConversation()` 是不是真的换了会话。
 *
 * 上面那条用真实存储验证了「改名之后找不回来」，这里再走一遍面板自己的入口 ——
 * 只验存储语义的话，面板里少写一步（比如忘了把 groupConversationId 清空）照样会「假轮换」。
 */
test('ensureGroupConversation：换需求 → 换新会话；同需求 / 正在跑 → 原地不动', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hwchat-ensure-'));
  try {
    const storage = new ConversationStorage(root);
    await storage.initialize();
    const skills = {
      sharedActiveIds: () => [],
      onDidChangeSharedState: { event: () => ({ dispose() { /* noop */ } }) },
      onDidChangeSkills: { event: () => ({ dispose() { /* noop */ } }) },
    };
    const panel = new ChatPanel(
      {} as never, {} as never, storage as never, {} as never, {} as never,
      skills as never, {} as never, {} as never,
    );
    panel.setLanSync({
      state: () => ({ role: 'host' }),
      latestRequirementTitle: () => '把同步状态显示到标题栏',
      activeProjectName: () => 'deepseek-hwchat',
    } as never);
    const call = panel as unknown as {
      ensureGroupConversation: (requirementId?: string, keepFor?: string) => Promise<string | undefined>;
      runs: Map<string, unknown>;
    };

    const first = await call.ensureGroupConversation('req-a');
    assert.ok(first, '第一次要能建出团队任务会话');
    await storage.appendMessage(first, { role: 'user', content: '甲方在团队群里提出了一个需求（需求号 req-a）。' });

    // 同一条需求的追问 / 回答 → 原地不动。
    assert.equal(await call.ensureGroupConversation('req-a'), first, '同一条需求不能换会话');

    // 新需求 → 真的换一条（旧的那条归档 + 改名）。
    const second = await call.ensureGroupConversation('req-b');
    assert.notEqual(second, first, '新需求必须换一条新会话');
    const old = await storage.getConversation(first);
    assert.equal(old?.archived, true, '旧会话要归档');
    assert.match(String(old?.title), /归档/, '旧会话要改名，否则下次又会被按标题找回来');

    // 同一条新需求再来一次：不能再换（否则每句话一条新会话）。
    assert.equal(await call.ensureGroupConversation('req-b'), second, '同一条需求重复进入必须复用');

    // 正在跑的时候收到新需求：不换（换掉等于把运行中的这一轮写进刚归档的会话）。
    await storage.appendMessage(second!, { role: 'user', content: '甲方在团队群里提出了一个需求（需求号 req-b）。' });
    call.runs.set(second!, {});
    assert.equal(await call.ensureGroupConversation('req-c'), second, '跑着的会话不能换');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
