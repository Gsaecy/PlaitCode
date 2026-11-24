/**
 * 频道历史落盘：**只存密文**，服务端依旧读不到内容。
 *
 * 为什么需要它：中继原本是纯内存的频道，重启就丢、新设备加入拿不到历史，
 * 于是「换台电脑接着干活」和「任务看板」都会缺前一半。持久化是这两件事的地基。
 *
 * 用 JSONL 而不是数据库：单文件、只追加、无依赖、断电最多丢最后一行，
 * 读的时候跳过坏行即可。频道数量是「小团队」级别，一个频道一个文件足够。
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface HistoryEntry {
  seq: number;
  id: string;
  from: string;
  iv: string;
  ct: string;
  at: number;
}

export interface ChannelHistory {
  /** 读出该频道的历史（已按 seq 升序、已按上限截断）。文件不存在返回空数组。 */
  load: (channelId: string) => Promise<HistoryEntry[]>;
  /** 追加一条。写入是排队做的：同一频道的顺序必须和 seq 一致。 */
  append: (channelId: string, entry: HistoryEntry) => void;
  /** 等所有排队写入落完（测试与优雅退出用）。 */
  flush: () => Promise<void>;
}

const FILE_SAFE = /^[0-9a-f]{16,64}$/;

export function createChannelHistory(dir: string | undefined, maxEntries = 500): ChannelHistory {
  if (!dir) {
    return {
      load: async () => [],
      append: () => undefined,
      flush: async () => undefined,
    };
  }
  /** 每个频道一条写入链，保证磁盘上的顺序就是 seq 顺序。 */
  const chains = new Map<string, Promise<void>>();

  const fileFor = (channelId: string): string | undefined =>
    (FILE_SAFE.test(channelId) ? join(dir, `${channelId}.jsonl`) : undefined);

  const parse = (raw: string): HistoryEntry[] => {
    const entries: HistoryEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as Partial<HistoryEntry>;
        if (typeof value.seq !== 'number' || !Number.isFinite(value.seq)) continue;
        if (typeof value.id !== 'string' || !value.id) continue;
        if (typeof value.iv !== 'string' || typeof value.ct !== 'string') continue;
        entries.push({
          seq: value.seq,
          id: value.id,
          from: typeof value.from === 'string' ? value.from : '',
          iv: value.iv,
          ct: value.ct,
          at: typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0,
        });
      } catch {
        // 断电时最后一行可能只写了一半：跳过坏行而不是整份丢掉
      }
    }
    return entries.sort((left, right) => left.seq - right.seq);
  };

  return {
    async load(channelId: string): Promise<HistoryEntry[]> {
      const file = fileFor(channelId);
      if (!file) return [];
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch {
        return [];
      }
      const all = parse(raw);
      const kept = maxEntries > 0 ? all.slice(-maxEntries) : all;
      // 顺手压实：文件明显超量时重写成只保留的这段，避免无限增长
      if (all.length > kept.length * 2 && kept.length > 0) {
        const compacted = kept.map((entry) => JSON.stringify(entry)).join('\n');
        const temp = `${file}.tmp`;
        await writeFile(temp, `${compacted}\n`, 'utf8').catch(() => undefined);
        await rename(temp, file).catch(() => undefined);
      }
      return kept;
    },

    append(channelId: string, entry: HistoryEntry): void {
      const file = fileFor(channelId);
      if (!file) return;
      const line = `${JSON.stringify(entry)}\n`;
      const previous = chains.get(channelId) ?? Promise.resolve();
      const next = previous
        .then(async () => {
          await mkdir(dir, { recursive: true }).catch(() => undefined);
          await appendFile(file, line, 'utf8');
        })
        .catch(() => undefined);
      chains.set(channelId, next);
      // 链尾用完就丢，避免 Map 无限增长
      void next.then(() => {
        if (chains.get(channelId) === next) chains.delete(channelId);
      });
    },

    async flush(): Promise<void> {
      await Promise.all([...chains.values()]);
    },
  };
}
