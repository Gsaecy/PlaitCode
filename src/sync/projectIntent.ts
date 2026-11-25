/**
 * 从用户的一句话里认出「他想做哪个项目」。
 *
 * 用户的要求是：不要在开群前让他去点菜单选项目，
 * **群里说一句「用 xxx 项目」就该切过去**。
 *
 * 所以这里做模糊匹配：把本机项目名和用户的话都去掉分隔符再比，
 * `deepseek-hwchat` / `deepseek_hwchat` / `DeepSeek HWChat` 都认成同一个。
 */

export interface ProjectCandidate {
  name: string;
  repo: string;
}

/** 去掉大小写和常见分隔符，只留字母数字与中文。 */
function fold(value: string): string {
  return (value ?? '')
    .toLocaleLowerCase()
    .replace(/[\s_\-./\\:]+/g, '');
}

/** 「切/换/改成」这类动词足够明确，出现就算在指项目。 */
const STRONG_VERBS = ['切', '换', '改用', '改成'];

/**
 * 「用/做/打开」含义太宽（「用 deepseek-hwchat 做个按钮」是在派活，不是切项目），
 * 所以只有在**这句话本来就很短**（像一句指令而不是一整段需求）时才算切换。
 */
const WEAK_VERBS = ['用', '做', '选', '打开', '进入'];
const WEAK_MAX_LENGTH = 30;

/**
 * 认出用户想切到哪个项目。
 *
 * 返回 `undefined` 表示这句话不是在指项目 —— 调用方照常当普通对话处理。
 * 只有**唯一命中**时才返回：一句话同时提到两个项目时不猜，交给追问。
 */
export function resolveProjectFromText(
  message: string,
  candidates: readonly ProjectCandidate[],
): ProjectCandidate | undefined {
  const text = (message ?? '').trim();
  if (!text || !candidates.length) return undefined;

  const foldedText = fold(text);
  const matched = candidates.filter((item) => {
    const foldedName = fold(item.name);
    if (!foldedName) return false;
    if (foldedText.includes(foldedName)) return true;
    // 仓库名（owner/repo 的 repo 段）也算：用户更可能说仓库名。
    const repoName = item.repo.split('/').filter(Boolean).pop() ?? '';
    const foldedRepo = fold(repoName);
    return Boolean(foldedRepo) && foldedText.includes(foldedRepo);
  });

  // 一句话点了两个项目：不猜，让 agent 去问。
  if (matched.length !== 1) return undefined;
  const hit = matched[0];
  if (!hit) return undefined;

  /*
   * 提到项目名不一定是要切过去（「deepseek-hwchat 那个 bug 修了吗」）。
   * 只有出现切换类动词才算指令，否则容易把一句提问当成切换。
   */
  if (STRONG_VERBS.some((verb) => text.includes(verb))) return hit;
  if (text.length <= WEAK_MAX_LENGTH && WEAK_VERBS.some((verb) => text.includes(verb))) {
    return hit;
  }
  return undefined;
}
