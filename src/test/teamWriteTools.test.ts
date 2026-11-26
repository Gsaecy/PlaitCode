import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { requirementPromptForLocal, type SyncPeer } from '../sync/lanProtocol';
import { detectPlaybooks, hasWriteIntent, narrowToolNames } from '../agent/toolPlaybooks';

/**
 * 「团队任务里的 agent 没有改文件那一项」——真根因在**工具清单**，不在权限。
 *
 * 用户实况（2026-11-25，第二次）：
 *   「【权限申请】授权我收到了，但这条会话还是只有「读文件 + 跑命令」，
 *    没有「改文件」那一项 —— 授权本身不会给会话加能力」。
 *
 * 查下来是两件事叠加，都发生在「按任务类型收窄工具」这一步：
 *
 * 1. `detectPlaybooks` 收到的是**包着协议提示词的整段文本**。协议里有一句
 *    「除甲方明确追问，否则不要主动汇报分支 / 提交 / 工作区状态」——
 *    `isGitWriteRequest` 认到「提交」，于是每一条群需求都会命中 `git-write` 预案；
 * 2. 同一段文本里还有「不需要改任何文件」（A 分支的说明），
 *    `hasWriteIntent` 的否定词规则因此判成「没有写意图」。
 *
 * 两者一叠加：收窄生效 → 保留 `ALWAYS_ALLOWED ∪ {run_command}` →
 * **恰好就是「读文件 + 跑命令」**，写工具根本不在清单里，授权也无能为力。
 *
 * 这个测试用**真实的协议提示词**复现，不是对着源码猜。
 */

const win: SyncPeer = { id: 'p-win', name: 'PC', platform: 'win32', project: 'app', version: 't' };
const mac: SyncPeer = { id: 'p-mac', name: 'Mac', platform: 'darwin', project: 'app', version: 't' };

/** 一条普通的群需求（就是要改代码的那种）。 */
const requirement = {
  kind: 'requirement' as const,
  id: 'r1',
  from: win,
  title: '更新一下 macos 版本，旧方法的谷歌账户删了刷新又会出现',
  detail: '更新一下，macos 版本，旧方法的谷歌账户也是删除了刷新又会出现',
  createdAt: 1,
};

const prompt = requirementPromptForLocal(requirement, mac, [], {
  projectRoot: '/Users/test/app',
  projectName: 'app',
  peers: [win],
});

/** 面板在 `send()` 里下发的全部工具（写工具都在）。 */
const ALL_TOOLS = [
  'list_workspace_roots', 'list_directory', 'list_files', 'search_files', 'read_file',
  'open_file', 'get_diagnostics', 'write_file', 'replace_in_file', 'rename_file',
  'delete_file', 'run_command', 'update_project_doc', 'update_todos', 'ask_user_choice',
  'team_sync', 'load_skill', 'search_conversation_history', 'read_message_detail',
];

test('协议提示词不再误命中 git-write（「不要主动汇报分支 / 提交」不算要提交）', () => {
  const playbooks = detectPlaybooks(prompt, {});
  assert.equal(
    playbooks.some((item) => item.kind === 'git-write'),
    false,
    '以前「提交」二字在否定句里被当成要提交，于是每条群需求都进了 git-write 预案',
  );
  assert.equal(hasWriteIntent(prompt), false, '协议里写着「不需要改任何文件」，写意图本来就该是 false');
});

test('就算预案命中，团队任务也不会因此丢掉写工具', () => {
  /*
   * 历史故障：预案命中 + 写意图 false → 收窄生效 → 只留下「读工具 + run_command」，
   * 恰好就是用户看到的「只有读文件 + 跑命令，没有改文件那一项」。
   * 现在团队任务把写意图强制为 true（工单就是来干活的），收窄整体失效。
   */
  const gitWrite = detectPlaybooks('帮我提交并推送到 github', {});
  assert.ok(gitWrite.some((item) => item.kind === 'git-write'), '这句确实该命中 git-write');

  const narrow = narrowToolNames(ALL_TOOLS, gitWrite, false);
  assert.equal(narrow.includes('write_file'), false, '普通对话里仍按预案收窄（这是有意的）');

  const wide = narrowToolNames(ALL_TOOLS, gitWrite, true);
  assert.deepEqual(wide, ALL_TOOLS, '团队任务（写意图强制 true）清单原样保留，写工具都在');
});

test('修好之后：用用户原话判定，写工具一律留着', () => {
  const intentText = requirement.detail;
  const playbooks = detectPlaybooks(intentText, {});
  // 团队任务：写意图强制为 true（工单就是来干活的），预案只提供指令、不裁工具。
  const wide = narrowToolNames(ALL_TOOLS, playbooks, true);
  assert.deepEqual(wide, ALL_TOOLS, '有写意图时收窄整体失效，清单原样保留');
  assert.ok(wide.includes('write_file') && wide.includes('replace_in_file'), '改文件工具必须在');
});

test('面板实现：团队来的活用原话判定，并强制保留写能力', () => {
  const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(
    PANEL,
    /const isTeamRun = options\?\.origin === 'sync' \|\| options\?\.origin === 'group';/,
    '群与对端两种来源都算团队任务',
  );
  assert.match(
    PANEL,
    /const intentText = isTeamRun \? \(options\?\.displayText \?\? content\) : content;/,
    '团队任务按用户原话判定（displayText），不拿协议提示词当意图',
  );
  assert.match(PANEL, /detectPlaybooks\(intentText,/, '预案要用原话判定');
  assert.match(
    PANEL,
    /const writingRequested = isTeamRun \? true : hasWriteIntent\(content\);/,
    '团队任务永远保留写能力',
  );
  // 只读档仍然是唯一能拿走写工具的安全阀。
  assert.match(PANEL, /SYNC_READ_ONLY_PLAYBOOK/, '项目不一致时的只读档必须还在');
});
