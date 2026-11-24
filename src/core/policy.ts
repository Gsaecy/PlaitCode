/**
 * 企业策略（`policy.json`）：管理员下发、**只允许收紧**、不允许放宽。
 *
 * 放在工作区里（或由 MDM 推到 `.hwchat/policy.json`）：
 *
 * ```json
 * {
 *   "version": 1,
 *   "permissionPreset": "review",
 *   "denyCommands": ["rm -rf", "curl | sh", "/\\.ssh/"],
 *   "modelAllowlist": ["deepseek-*", "qwen-*"],
 *   "allowInternetReference": false
 * }
 * ```
 *
 * 三条原则：
 *  1. **只收紧**：策略里的预设比用户选的更宽松时不生效（取更严格的那个）；
 *  2. **可见**：被策略拦下时要明确说"企业策略禁止"，不能表现成"莫名其妙的失败"；
 *  3. **坏文件按最严处理**：解析失败时退回 `askAll` 并告警 —— 静默失效比没有策略更危险。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isPermissionPreset } from './settings';
import type { PermissionPreset } from './types';

export interface EnterprisePolicy {
  version: 1;
  /** 允许的权限预设**上限**（比它更宽松的会被降级）。 */
  permissionPreset?: PermissionPreset;
  /** 禁止执行的命令：子串，或写成 `/正则/`。 */
  denyCommands?: string[];
  /** 模型白名单，支持 `*` 通配；为空表示不限制。 */
  modelAllowlist?: string[];
  /** `false` 表示强制关闭"联网参考"。 */
  allowInternetReference?: boolean;
}

export interface PolicyLoad {
  policy?: EnterprisePolicy;
  /** 生效的文件路径（写日志用）。 */
  source?: string;
  /** 解析失败的原因（此时按最严格处理）。 */
  error?: string;
}

export const POLICY_FILE = join('.hwchat', 'policy.json');

const PRESET_ORDER: PermissionPreset[] = ['askAll', 'review', 'autopilot', 'full'];

/** 数字越小越严格。 */
function presetRank(preset: PermissionPreset): number {
  const index = PRESET_ORDER.indexOf(preset);
  return index < 0 ? 0 : index;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 200);
}

/** 解析策略对象；形状不对就返回错误（调用方按最严格处理）。 */
export function parsePolicy(raw: unknown): PolicyLoad {
  if (!raw || typeof raw !== 'object') return { error: '策略文件必须是 JSON 对象' };
  const record = raw as Record<string, unknown>;
  if (record.version !== undefined && record.version !== 1) {
    return { error: `不支持的策略版本：${String(record.version)}` };
  }
  const policy: EnterprisePolicy = { version: 1 };
  if (record.permissionPreset !== undefined) {
    if (!isPermissionPreset(record.permissionPreset)) {
      return { error: `permissionPreset 不认识：${String(record.permissionPreset)}` };
    }
    policy.permissionPreset = record.permissionPreset;
  }
  const deny = asStringList(record.denyCommands);
  if (deny.length) policy.denyCommands = deny;
  const models = asStringList(record.modelAllowlist);
  if (models.length) policy.modelAllowlist = models;
  if (record.allowInternetReference === false) policy.allowInternetReference = false;
  return { policy };
}

/** 读工作区里的策略文件；没有文件不是错误。 */
export async function loadPolicy(root: string | undefined): Promise<PolicyLoad> {
  if (!root) return {};
  const target = join(root, POLICY_FILE);
  let text: string;
  try {
    text = await readFile(target, 'utf8');
  } catch {
    return {};
  }
  try {
    return { ...parsePolicy(JSON.parse(text) as unknown), source: target };
  } catch (error) {
    return { error: `策略文件不是合法 JSON：${error instanceof Error ? error.message : String(error)}`, source: target };
  }
}

/** 策略解析失败时用的最严格预设。 */
export const STRICT_PRESET: PermissionPreset = 'askAll';

/** 取策略与用户选择中**更严格**的那个。 */
export function clampPreset(policy: EnterprisePolicy | undefined, requested: PermissionPreset): PermissionPreset {
  if (!policy?.permissionPreset) return requested;
  return presetRank(requested) <= presetRank(policy.permissionPreset) ? requested : policy.permissionPreset;
}

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

/** 模型是否在允许范围内（没有白名单就是不限制）。 */
export function modelAllowed(policy: EnterprisePolicy | undefined, modelId: string): boolean {
  const allow = policy?.modelAllowlist;
  if (!allow?.length) return true;
  return allow.some((pattern) => wildcardMatch(pattern, modelId));
}

/**
 * 命令是否被策略禁止。命中就返回一句**能给人看**的原因（含命中的规则）。
 */
export function deniedCommand(policy: EnterprisePolicy | undefined, command: string): string | undefined {
  const rules = policy?.denyCommands;
  if (!rules?.length || !command) return undefined;
  for (const rule of rules) {
    const regexForm = /^\/(.+)\/([a-z]*)$/.exec(rule);
    let hit = false;
    if (regexForm) {
      try {
        hit = new RegExp(regexForm[1]!, regexForm[2] || 'i').test(command);
      } catch {
        hit = command.includes(rule);
      }
    } else {
      hit = command.includes(rule);
    }
    if (hit) return `企业策略禁止这条命令（命中规则：${rule}）`;
  }
  return undefined;
}
