/**
 * 协作自检：不看代码、不问人，直接问正在运行的扩展。
 *
 * 用法：
 *   node scripts/diagnose.mjs                # 只查本机
 *   node scripts/diagnose.mjs 192.168.0.8    # 连对方一起查
 *
 * 它回答四个问题：
 *   1. 两台现在各跑哪个版本（版本不同，行为必然不同）
 *   2. 谁在群里当主机、谁是加入方
 *   3. 群消息到底有没有互相送达（看本地群记录里的 fromId）
 *   4. 每一条「提问」有没有被回答、由谁回答
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE = join(homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'honor-world.hwchat', 'lan-sync.json');
const PORT = 47821;

async function ping(base) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}/hwchat-sync/v1/ping`, { signal: AbortSignal.timeout(4000) });
    const body = await response.json();
    return {
      base,
      ok: true,
      ms: Date.now() - started,
      version: body?.peer?.version ?? '（未上报）',
      name: body?.peer?.name ?? '?',
      project: body?.peer?.project ?? '?',
      role: body?.role ?? '?',
    };
  } catch (error) {
    return { base, ok: false, ms: Date.now() - started, error: error?.message ?? String(error) };
  }
}

const extra = process.argv.slice(2).map((host) => (host.startsWith('http') ? host : `http://${host}:${PORT}`));
const targets = [...new Set([`http://127.0.0.1:${PORT}`, ...extra])];

console.log('=== 1. 正在运行的扩展 ===');
const results = await Promise.all(targets.map(ping));
for (const item of results) {
  if (!item.ok) {
    console.log(`  ✗ ${item.base} 连不上（${item.error}）`);
    continue;
  }
  console.log(`  ✓ ${item.base} · ${item.name} · 版本 ${item.version} · 角色 ${item.role} · 项目 ${item.project} · ${item.ms}ms`);
}
const versions = new Set(results.filter((item) => item.ok).map((item) => item.version));
if (versions.size > 1) console.log(`  ⚠ 版本不一致：${[...versions].join(' vs ')} —— 两台行为会不一样`);

console.log('\n=== 2. 本地群记录 ===');
let state;
try {
  state = JSON.parse(readFileSync(STATE, 'utf8'));
} catch (error) {
  console.log(`  读不到 ${STATE}（${error.message}）`);
  process.exit(0);
}
const group = Array.isArray(state.group) ? state.group : [];
console.log(`  本机角色 ${state.role ?? '?'} · 邀请码 ${state.inviteCode || '（无）'} · 群记录 ${group.length} 条`);

console.log('\n=== 3. 最近 12 条 + 是否被别的设备回答 ===');
const tail = group.slice(-12);
// 一条提问只算「下一条提问之前」的那些回答，否则后面的回复会被算到前面的提问头上。
const isQuestion = (item) => item.author === 'user' && item.phase === 'analysis';
for (let index = 0; index < tail.length; index += 1) {
  const message = tail[index];
  const time = new Date(message.at).toTimeString().slice(0, 8);
  const from = message.from?.name ?? '?';
  const fromId = message.from?.id ?? '';
  const who = message.author === 'user' ? '甲方' : '乙方';
  let verdict = '';
  if (isQuestion(message)) {
    let end = group.indexOf(message) + 1;
    while (end < group.length && !isQuestion(group[end])) end += 1;
    const window = group.slice(group.indexOf(message) + 1, end);
    const others = [...new Set(
      window
        .filter((item) => item.author === 'agent' && item.from?.id !== fromId)
        .map((item) => item.from?.name ?? '?'),
    )];
    verdict = others.length ? `→ 被 ${others.join('、')} 回答` : '→ 没有别的设备回答';
  }
  console.log(`  ${time} ${from} ${who}·${message.phase}「${String(message.body).slice(0, 26)}」${verdict ? ` ${verdict}` : ''}`);
}

console.log('\n=== 4. 结论 ===');
const questions = group.filter(isQuestion);
const unanswered = questions.filter((message) => {
  const start = group.indexOf(message) + 1;
  let end = start;
  while (end < group.length && !isQuestion(group[end])) end += 1;
  return !group.slice(start, end).some((item) => item.author === 'agent' && item.from?.id !== message.from?.id);
});
if (!questions.length) {
  console.log('  还没有跨设备的提问记录');
} else if (!unanswered.length) {
  console.log('  跨设备回答：正常（每条提问都有另一台设备回答）');
} else {
  console.log(`  跨设备回答：${questions.length} 条提问里有 ${unanswered.length} 条没有别的设备回答`);
  console.log('  这通常不是网络问题：群记录里能看到对方的话，说明送达了；是对端没做「回答对端提问」这件事。');
}
