import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LanSyncService } from '../sync/lanSync';
import { questionOptions, type SyncPeer } from '../sync/lanProtocol';

/**
 * 「乙方在等你回答」这条提醒的三个毛病（用户 2026-11-24）：
 *  1. 没写是**哪个设备**在等 → 回答被广播给所有 agent；
 *  2. 没有现成选项 + 自定义回答 → 只能手打整句；
 *  3. 不能关掉 → 不想回答时一直占地方。
 */

const win: SyncPeer = { id: 'p-win', name: 'MagicBookV14 · win32', platform: 'win32', project: 'app', version: 't', host: '192.168.0.2' };
const mac: SyncPeer = { id: 'p-mac', name: '192.168.0.8 · darwin', platform: 'darwin', project: 'app', version: 't', host: '192.168.0.8' };

const STALLED = '【需要你决定】这台这一轮没跑完（被停止、出错或等你授权）。项目：app 停在这里：（这一轮没有产生结论）请回一句就继续：要我接着做 / 换个做法 / 让另一台先做，哪种都行。';

test('从「请回一句就继续：A / B / C」里抽出可点选项', () => {
  assert.deepEqual(questionOptions(STALLED), ['要我接着做', '换个做法', '让另一台先做']);
});

test('编号行也能抽成选项', () => {
  const body = '要跟随系统还是手动选？\n1. 跟随系统\n2. 手动选';
  assert.deepEqual(questionOptions(body), ['跟随系统', '手动选']);
});

test('抽不出选项时返回空数组（不硬编假选项）', () => {
  assert.deepEqual(questionOptions('这一轮先做到这里。'), []);
  assert.deepEqual(questionOptions(''), []);
});

async function makeService(): Promise<{ service: LanSyncService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hwchat-question-'));
  const service = new LanSyncService(join(dir, 'state.json'), {
    peer: () => win,
    runRequirement: async () => true,
    runNote: async () => true,
    writeLedger: async () => undefined,
    writeTranscript: async () => undefined,
    localProjects: () => ['app'],
    localProjectRepos: () => ['github.com/acme/app'],
    log: () => undefined,
  }, { discoveryPort: 48_977 });
  await service.load();
  return { service, dir };
}

test('追问带上「是哪台在问」和可点选项', async () => {
  const { service, dir } = await makeService();
  try {
    const requirement = await service.shareRequirement('加个导出', '');
    assert.ok(requirement.requirement);
    // 另一台（mac）提的追问
    await service.postGroup({
      author: 'agent',
      phase: 'question',
      body: STALLED,
      requirementId: requirement.requirement.id,
    });
    const state = service.groupState();
    assert.ok(state.openQuestion, '要有待回答的追问');
    assert.equal(state.openQuestion.askerId, win.id, '要能说出是哪个设备 id 在问');
    assert.equal(state.openQuestion.askerLabel, 'Windows · MagicBookV14', '要按统一标识显示设备');
    assert.deepEqual(state.openQuestion.options, ['要我接着做', '换个做法', '让另一台先做']);
    assert.equal(service.openQuestionTarget()?.askerId, win.id, '回答要能定向回这一台');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('甲方再开口之后，旧追问不再算「在等回答」', async () => {
  /*
   * 用户实况：「我没 @ 谁，直接发的消息却显示 @windows」——旧追问一直挂着「在等」，
   * 于是之后每一句话都被它劫走，只发给提问的那台。
   */
  const { service, dir } = await makeService();
  try {
    const requirement = await service.shareRequirement('加个导出', '');
    await service.postGroup({ author: 'agent', phase: 'question', body: STALLED, requirementId: requirement.requirement!.id });
    assert.ok(service.openQuestionTarget(), '刚问完是在等回答');

    await service.postGroup({ author: 'user', phase: 'requirement', body: '这次 Windows 能看到同步信息了' });
    assert.equal(service.openQuestionTarget(), undefined, '甲方说过话之后就不该再劫持下一句');
  } finally {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('回答只发给提问的那一台，另一台不重复执行', () => {
  const panel = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(panel, /const openTarget = this\.lanSync\.openQuestionTarget\(\)/, '要用「谁问的」当回答目标');
  assert.match(panel, /const answerTo = route\.kind === 'answer' \? openTarget : undefined;/, '按分流结论决定是不是回答');
  assert.match(panel, /to: answerTo\.askerId/, '回答只发给提问的那一台（用 to 定向）');
  assert.doesNotMatch(panel, /assignee: answerTo\.askerId/, '不能在气泡上挂「@某台」——用户没点名');
  assert.match(panel, /answerTo\.askerId !== this\.lanSync\.localPeer\(\)\.id[\s\S]{0,400}return;/, '本机不是问话方时不再自己开跑');
  // 「算不算回答」的判定在纯函数里（`groupRouting.test.ts` 执行验证）。
  assert.match(panel, /routeGroupMessage\(\{/, '分流函数要参与决定');
  const routing = readFileSync('src/sync/groupRouting.ts', 'utf8');
  assert.match(routing, /isAnswerToOpenQuestion\(/, '要有「这句话到底算不算回答」的判断');
  const sync = readFileSync('src/sync/lanSync.ts', 'utf8');
  assert.match(sync, /甲方回答的是 \$\{target\} 的追问，这台只参考不执行/, '接收端也要认这个指派');
});

test('提醒条有「哪台在问」、选项和关闭按钮', () => {
  const panel = readFileSync('src/views/groupPanel.ts', 'utf8');
/** 群窗口界面脚本（真文件）；宿主侧仍在 groupPanel.ts。 */
const GROUP_SCRIPT = readFileSync('media/group.js', 'utf8');
  assert.match(panel, /id="bannerClose"/, '要有关闭按钮');
  assert.match(GROUP_SCRIPT, /的乙方在等你回答/, '要写清是哪台在问');
  assert.match(panel, /id="bannerOpts"/, '要有可点选项');
  assert.match(GROUP_SCRIPT, /dismissedQuestion/, '关掉后不再一直占地方');
});
