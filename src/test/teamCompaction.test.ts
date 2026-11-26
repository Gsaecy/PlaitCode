import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planTeamCompaction,
  renderProgressDigest,
  teamMilestoneReached,
  TEAM_COMPACT_AT_PERCENT,
  TEAM_COMPACT_KEEP_MESSAGES,
} from '../sync/teamCompaction';
import { shouldRotateTeamConversation, teamMilestoneNotice } from '../sync/teamRotation';
import type { TodoItem } from '../core/types';

/**
 * 用户 2026-11-26：
 *
 * 「团队任务对话框里面如果对话长度达到 100%，因为这个对话是独立出来的，没法开新对话，
 *  就需要将已经完成的任务记录成一句话，细节都丢掉，没完成的也压缩，直到一个阶段任务，
 *  或者某项功能完成并同步了，就完全清除缓存。」
 *
 * 这条对话用户自己开不了新的，所以「压」和「清」都必须由代码真的做出来。
 */

const todo = (_id: string, content: string, status: TodoItem['status']): TodoItem => ({
  content,
  status,
});

test('已完成压成一句话：过程细节（文件、命令、换行）一个都不留', () => {
  const digest = renderProgressDigest({
    todos: [
      todo('t1', '改 lanSync.ts\n用了 37 次 write_file，涉及 src/sync/lanSync.ts、src/views/chatPanel.ts', 'completed'),
      todo('t2', '      跑通了  npm run compile        并且 0 error   ', 'completed'),
    ],
  });
  assert.match(digest, /已完成/);
  assert.match(digest, /改 lanSync\.ts 用了 37 次 write_file/);
  assert.doesNotMatch(digest, /\n{2,}- \[x\]/, '一项只能占一行');
  assert.match(digest, /跑通了 npm run compile 并且 0 error/, '多余空白要压掉');
});

test('未完成的保留目标（去掉细节），别让 agent 忘了还剩什么', () => {
  const digest = renderProgressDigest({
    todos: [
      todo('t1', '做完了', 'completed'),
      todo('t2', '还没做：手机端发送延迟，需要把 /m/send 改成 202 立即返回再后台发送', 'pending'),
    ],
  });
  assert.match(digest, /还没做完/);
  assert.match(digest, /\[ \] 还没做：手机端发送延迟/);
  assert.match(digest, /\[x\] 做完了/);
});

test('84% 不动手，85% 开始压缩，只留最近几条', () => {
  const todos = [todo('t1', '做完了', 'completed')];
  assert.equal(planTeamCompaction({ usedPercent: TEAM_COMPACT_AT_PERCENT - 1, done: false, synced: false, todos }).mode, 'none');
  const compact = planTeamCompaction({ usedPercent: TEAM_COMPACT_AT_PERCENT, done: false, synced: false, todos });
  assert.equal(compact.mode, 'compact');
  assert.equal(compact.keepMessages, TEAM_COMPACT_KEEP_MESSAGES);
  assert.ok(compact.digest.length > 0, '压缩必须真的带上摘要，否则细节丢了目标也丢了');
});

test('阶段做完并同步了 → 完全清缓存；没同步就不清', () => {
  const allDone = [todo('t1', '做完了', 'completed'), todo('t2', '也做完了', 'completed')];
  const reset = planTeamCompaction({ usedPercent: 10, done: true, synced: true, todos: allDone });
  assert.equal(reset.mode, 'reset', '同步之后连压缩历史都不带');
  assert.equal(reset.keepMessages, 0);

  assert.equal(planTeamCompaction({ usedPercent: 10, done: true, synced: false, todos: allDone }).mode, 'none',
    '没同步就清缓存，队友那边还在等这份结论');
  assert.equal(planTeamCompaction({ usedPercent: 10, done: false, synced: true, todos: allDone }).mode, 'none',
    '这一轮没跑完不能清');
  assert.equal(planTeamCompaction({
    usedPercent: 10,
    done: true,
    synced: true,
    todos: [...allDone, todo('t3', '没做完', 'pending')],
  }).mode, 'none', '还有没做完的就不算里程碑');
});

test('里程碑清缓存在对话层面真的会换新（同需求也不许继续背旧上下文）', () => {
  const summary = { messageCount: 8, totalTokens: 9000 };
  assert.equal(shouldRotateTeamConversation({ summary, previousRequirementId: 'r-1', requirementId: 'r-1' }), false,
    '同需求的追问默认要接着上下文');
  assert.equal(
    shouldRotateTeamConversation({ summary, previousRequirementId: 'r-1', requirementId: 'r-1', milestoneDone: true }),
    true,
    '但里程碑已经交付，接着聊的是下一件事',
  );
  assert.equal(
    shouldRotateTeamConversation({ summary, previousRequirementId: 'r-1', requirementId: 'r-1', keepFor: 'r-1', milestoneDone: true }),
    false,
    '被打断后接着跑的那一轮仍然必须保留上下文',
  );
});

test('里程碑判据只有一条：做完（含已归档）且已同步', () => {
  // 清单全绿 + 正常收尾 + 已同步
  assert.equal(teamMilestoneReached({
    todos: [todo('t1', 'a', 'completed'), todo('t2', 'b', 'completed')],
    done: true,
    synced: true,
  }), true);
  // 收尾已经把全绿清单归档掉了（todos 空、todoArchives 有东西）也算完成
  assert.equal(teamMilestoneReached({ todos: [], archivedCount: 2, done: true, synced: true }), true);
  assert.equal(teamMilestoneReached({ todos: [], archivedCount: 0, done: true, synced: true }), false,
    '空对话没有清单，不算里程碑');
  assert.equal(teamMilestoneReached({
    todos: [todo('t1', 'a', 'completed'), todo('t2', 'b', 'pending')],
    done: true,
    synced: true,
  }), false, '还有没做完的');
  assert.equal(teamMilestoneReached({
    todos: [todo('t1', 'a', 'completed')],
    done: true,
    synced: false,
  }), false, '没同步给群里就不清缓存');
  assert.equal(teamMilestoneReached({
    todos: [todo('t1', 'a', 'completed')],
    done: false,
    synced: true,
  }), false, '这一轮没跑完不算');
});

test('清缓存也要在旧对话里留下「一句话记录」', () => {
  const notice = teamMilestoneNotice({
    completed: ['两端同步打通\n细节很多很多', '手机端发送改成 202'],
    project: 'hwchat',
    at: '21:40',
  });
  assert.match(notice, /阶段完成并已同步/);
  assert.match(notice, /21:40/);
  assert.match(notice, /项目：hwchat/);
  assert.equal(notice.split('\n').filter((line) => line.startsWith('- ')).length, 2, '每项一行');
  assert.match(notice, /- 两端同步打通 细节很多很多$|两端同步打通/, '换行要压平：一项一行');
  assert.doesNotMatch(notice, /write_file|npm run/, '过程细节（工具/命令）不该出现在记录里');
});
