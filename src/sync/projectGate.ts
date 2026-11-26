/**
 * 项目门禁：判断「这条需求说的项目」和「本机现在选的项目」是不是同一个。
 *
 * 为什么单独成模块：
 *  - 判定只允许有一个真源。以前这段逻辑长在 `applyMessage` 里，改一次要跑整个同步服务；
 *  - 判定错一次的代价很具体 —— 判成「不同项目」这一轮就降成只读，agent 会如实汇报
 *    「只给了我读代码和跑命令，没有写文件那一项」，甲方以为 agent 天生不能改文件。
 *
 * 判定顺序（先强信号，后弱信号）：
 *  1. 仓库地址完全相同 → 同一个项目；
 *  2. 本机拥有对方那个仓库（多根工作区里的另一个文件夹）→ 同一个项目；
 *  3. 项目名（文件夹名）相同 → 同一个项目；
 *  4. **本机认不出自己的仓库时，不下「不同」的结论** —— 没有依据；
 *  5. 其余情况才算真的不同。
 *
 * 第 4 条是用户实况（2026-11-25）逼出来的：两台明明在做同一个项目，
 * 但其中一台没装 git / 没有 origin / `.git/config` 读不到，`myRepo` 是空串，
 * 旧逻辑直接把它当「不相同」，于是那台整轮只读。
 */

import { normalizeRepoUrl } from './projectRef';

/** 判定依据（写进日志，出问题时能一眼看出凭什么下的结论）。 */
export type ProjectGateReason =
  /** 两边仓库地址一致 */
  | 'same-repo'
  /** 本机也有这个仓库（另一个文件夹） */
  | 'has-project'
  /** 项目名一致 */
  | 'same-name'
  /** 本机认不出自己的仓库，无法证明不同 */
  | 'unknown-own-repo'
  /** 两边仓库地址不同，且本机没有那个项目 */
  | 'different-repo'
  /** 只有项目名且名字不同 */
  | 'different-name'
  /** 双方都没给出可比的信号 */
  | 'no-signal';

export interface ProjectGateInput {
  /** 对方需求带的仓库地址（内部会 normalize） */
  theirRepo?: string;
  /** 本机当前项目的仓库地址；空串 = 本机认不出自己是谁 */
  myRepo?: string;
  /** 对方需求说的项目名（文件夹名） */
  theirName?: string;
  /** 本机当前项目名 */
  myName?: string;
  /** 本机是否拥有某个仓库 / 项目（复用 `LanSyncService.hasProject`） */
  hasProject: (repoOrName: string) => boolean;
}

export interface ProjectGateResult {
  /** true = 这一轮按只读执行（能读能答，不改文件） */
  mismatch: boolean;
  reason: ProjectGateReason;
}

export function projectGate(input: ProjectGateInput): ProjectGateResult {
  const theirRepo = normalizeRepoUrl(input.theirRepo ?? '');
  const myRepo = normalizeRepoUrl(input.myRepo ?? '');
  const theirName = String(input.theirName ?? '').trim();
  const myName = String(input.myName ?? '').trim();
  const sameName = Boolean(theirName) && Boolean(myName)
    && theirName.toLowerCase() === myName.toLowerCase();

  if (theirRepo) {
    if (myRepo && theirRepo === myRepo) return { mismatch: false, reason: 'same-repo' };
    if (input.hasProject(theirRepo)) return { mismatch: false, reason: 'has-project' };
    if (sameName) return { mismatch: false, reason: 'same-name' };
    if (!myRepo) return { mismatch: false, reason: 'unknown-own-repo' };
    return { mismatch: true, reason: 'different-repo' };
  }

  if (!theirName || !myName) return { mismatch: false, reason: 'no-signal' };
  if (sameName || input.hasProject(theirName)) return { mismatch: false, reason: 'same-name' };
  return { mismatch: true, reason: 'different-name' };
}
