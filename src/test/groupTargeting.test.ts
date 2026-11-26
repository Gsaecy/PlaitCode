import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isAnswerToOpenQuestion, looksLikeOwnWordsAnswer } from '../sync/groupIntent';
import { routeGroupMessage } from '../sync/groupRouting';
import { makeGroupMessage, type SyncPeer } from '../sync/lanProtocol';

/**
 * 「明确指定执行设备」这个消息在群里**不能丢**——通用规则，不针对某台设备。
 *
 * 用户实况（2026-11-25）：在 macOS 那台的输入框里选了「macOS（本机）」再发消息，
 * 群里却显示没有 @ 任何人；另一台收到后当成「说给所有人」照跑，而被指派的那台
 * 反而没执行。查到的链路（与设备名、台数都无关）：
 *
 *  1. 群里只要还挂着一张「等你选」的决策卡，旧逻辑就把**任何 ≤60 字**的发言
 *     当成「你自己说怎么做」并结算掉那张卡；
 *  2. 结算分支只发一条 `phase=answer` 的群消息，**既不带 assignee 也不带 to**，
 *     然后 `return` —— 明确指派在这里被丢光；
 *  3. 接收端看到「没有 to / 没有 assignee」就按「说给所有人」处理。
 *
 * 所以规则要立成三条，对任意台数成立：
 *  A. 显式指派 > 「回答 / 结算」捷径；
 *  B. 「自由回答」必须真的像回答（不是「≤60 字」这么宽松）；
 *  C. 回答必须带得出回答对象（`to`），拿不到就不许发 answer。
 */

const A: SyncPeer = { id: 'dev-a', name: 'A', platform: 'win32', project: 'app', version: 't' };
const B: SyncPeer = { id: 'dev-b', name: 'B', platform: 'darwin', project: 'app', version: 't' };
const C: SyncPeer = { id: 'dev-c', name: 'C', platform: 'linux', project: 'app', version: 't' };

test('A. 显式指派优先：群消息分流走纯函数，且 chatPanel 真的按它的结论执行', () => {
  /*
   * 规则本体在 `sync/groupRouting.ts`，由 `groupRouting.test.ts` **执行**验证。
   * 这里只盯「面板有没有真的用它」——纯函数再正确，没接上也白搭。
   */
  const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.match(PANEL, /import \{[^}]*\brouteGroupMessage\b[^}]*\} from '\.\.\/sync\/groupRouting';/, '要用同一个分流函数');
  const call = PANEL.indexOf('const route = routeGroupMessage({');
  assert.ok(call > 0, '群分支要调用它');
  const body = PANEL.slice(call, call + 900);
  assert.match(body, /text: content,/, '拿甲方原话判定');
  assert.match(body, /explicitAssignee: options\?\.assignee \?\? ''/, '把界面选的执行设备交给它');
  // 三个捷径都必须来自 route 的结论，而不是各自再判一次。
  assert.match(PANEL, /route\.kind === 'decision' \|\| route\.kind === 'decision-custom'/, '结算选择按结论走');
  assert.match(PANEL, /route\.kind === 'approval'/, '结算审批按结论走');
  assert.match(PANEL, /route\.kind === 'authorize'/, '完全访问授权按结论走');
  assert.doesNotMatch(PANEL, /settleGroupDecision\(content/, '旧的分支判断已删除，避免两套规则并存');
});

test('B. 「自由回答」的门槛由纯函数给出，面板不再自己写「≤60 字」', () => {
  const ROUTING = readFileSync('src/sync/groupRouting.ts', 'utf8');
  assert.match(ROUTING, /text\.length <= 60 && looksLikeOwnWordsAnswer\(text\)/, '门槛 = 短 且 像回答');

  // 用户真实那句：二十来个字的新需求，以前因为「≤60 字」被吞成答案。
  assert.equal(
    looksLikeOwnWordsAnswer('1.实测，删掉邮箱刷新没有继续出现了；2.但是中英文切换，选中状态会刷新到第一个邮箱'),
    false,
    '普通陈述句不是「你自己说怎么做」',
  );
  assert.equal(looksLikeOwnWordsAnswer('你自己定就行'), true);
  assert.equal(looksLikeOwnWordsAnswer('按你说的做'), true);
  assert.equal(looksLikeOwnWordsAnswer('我选第二个方案，先不动数据'), true);
  assert.equal(looksLikeOwnWordsAnswer('随便'), true);

  const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
  assert.doesNotMatch(PANEL, /value\.length <= 60 && looksLikeOwnWordsAnswer/, '面板里不再保留第二份判断');
});

test('C. 提问方 id 为空的消息不算追问（否则回答会变成一条没有 to 的广播）', () => {
  const SYNC = readFileSync('src/sync/lanSync.ts', 'utf8');
  const start = SYNC.indexOf('openQuestionTarget(): {');
  const body = SYNC.slice(start, start + 1_200);
  assert.match(body, /const askerId = \(question\.from\?\.id \?\? ''\)\.trim\(\);/, '要取出真实提问方');
  assert.match(body, /if \(!askerId\) return undefined;/, '拿不到提问方就不算追问');
});

test('回答类群消息必须带得出回答对象：多台设备时只有提问那台被定向', () => {
  // 分流给出 `{ kind: 'answer', to: asker }`；面板据此写 `to`，并只在提问那台继续跑。
  assert.deepEqual(
    routeGroupMessage({ text: '接着做', openAskerId: 'dev-b', now: 1_700_000_000_000 }),
    { kind: 'answer', to: 'dev-b' },
    '回答必须有收件人',
  );
  const PANEL = readFileSync('src/views/chatPanel.ts', 'utf8');
  const start = PANEL.indexOf("const answerTo = route.kind === 'answer' ? openTarget : undefined;");
  assert.ok(start > 0, '面板要按分流结论决定是不是回答');
  const body = PANEL.slice(start, PANEL.indexOf('} else {', start));
  assert.match(body, /to: answerTo\.askerId/, '定向靠 to');
  assert.match(body, /answerTo\.askerId !== this\.lanSync\.localPeer\(\)\.id/, '不是提问方就不再重复执行');
});

test('定向语义：点名的不是提问方 = 派活；点名提问方 = 回答（三台设备同样成立）', () => {
  // 要点：判定只看 id，与设备名/在线顺序无关。
  assert.equal(isAnswerToOpenQuestion({ text: '就这样', target: B.id, askerId: B.id }), true, '点名的就是提问方 → 回答');
  assert.equal(isAnswerToOpenQuestion({ text: '就这样', target: C.id, askerId: B.id }), false, '点名别的设备 → 派活');
  // 没点名时的短句兜底：这是有意的（群里回「接着做」就是回答那条追问）。
  // 真正要防的是「明确指派被吞」，已由 A 组规则覆盖。
  assert.equal(isAnswerToOpenQuestion({ text: '接着做', askerId: B.id }), true, '没点名 + 短答 → 仍按回答处理');
  assert.equal(isAnswerToOpenQuestion({ text: '接着做', askerId: B.id, options: ['接着做'] }), true, '命中选项 → 回答');
  assert.equal(
    isAnswerToOpenQuestion({ text: '1.实测没问题；2.但是选中状态会刷新到第一个', askerId: B.id }),
    false,
    '长句不是回答：会当新需求走完整流程，而不是被追问吞掉',
  );
});

test('群消息本身：assignee / to 都会随消息保留下来（发送端不许悄悄丢）', () => {
  const direct = makeGroupMessage(B, {
    author: 'user',
    phase: 'requirement',
    body: '改一下样式',
    assignee: B.id,
  }, 1, 'g1')!;
  assert.equal(direct.assignee, B.id, '指派给本机也要保留（群里要能看出 @的是谁）');

  const answer = makeGroupMessage(B, {
    author: 'user',
    phase: 'answer',
    body: '继续',
    to: A.id,
  }, 2, 'g2')!;
  assert.equal(answer.to, A.id, '回答的定向目标要保留');
});
