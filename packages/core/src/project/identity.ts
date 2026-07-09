/**
 * 项目身份标识 ID 模型 — 纯函数模块，零 Node.js 依赖
 *
 * 此文件可被浏览器环境安全导入。
 * Node.js 专有函数（generateProjectId / computeProjectIds）在 identity-generate.ts。
 *
 * ID 格式：`<prefix>:<content>`
 * - `legacy:` — lattice.json 中的 16 字符随机 id（优先级最高）
 * - `git:` — git first commit SHA 前 16 位
 * - `remote:` — sha256(normalize(git_remote)) 前 16 位（每个 remote 一个）
 */

import type { ProjectMeta } from '../types';

// ─── 从 fingerprint.ts 迁入的纯函数 + 类型（反转依赖方向）───

/** 将 git remote URL 标准化（统一去 .git 后缀，统一 https/ssh 形式） */
export function normalizeGitRemote(remote: string): string {
  let r = remote.trim();
  if (!r) return '';
  const sshMatch = r.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    r = `${sshMatch[1]}/${sshMatch[2]}`;
  } else {
    r = r.replace(/^https?:\/\//, '');
    r = r.replace(/\.git$/, '');
  }
  return r.toLowerCase();
}

/** 指纹采集的 derived 部分（用于计算项目 IDs） */
export interface FingerprintDerived {
  gitFirstCommit?: string;
  gitRemotes: string[];
  gitDefaultBranch?: string;
  packageNames: string[];
  monorepoPackages: string[];
}

// ─── 常量 ───

export const ID_PREFIX = {
  GIT: 'git',
  REMOTE: 'remote',
  LEGACY: 'legacy',
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/** ID 优先级映射（数字越小优先级越高，相同数字表示相同优先级） */
const ID_PRIORITY_MAP: Record<string, number> = {
  [ID_PREFIX.LEGACY]: 1,
  [ID_PREFIX.GIT]: 2,
  [ID_PREFIX.REMOTE]: 3,
};

// ─── 纯函数 ───

/**
 * 从 ProjectMeta 解析出所有 IDs（兼容旧数据）
 *
 * - 有 ids 字段 → 直接返回
 * - 只有 id 字段 → 返回 [legacy:id]
 * - 都没有 → 返回空数组
 */
export function resolveProjectIds(meta: ProjectMeta): string[] {
  if (meta.ids && meta.ids.length > 0) return meta.ids;
  if (meta.id) return [`${ID_PREFIX.LEGACY}:${meta.id}`];
  return [];
}

/**
 * 在读取 project.json 后统一处理兼容性：
 * 1. 把 id 字段（历史兼容）合并到 ids 数组中（作为 legacy: 前缀 ID）
 * 2. 确保 ids 数组中所有 ID 都有前缀（无前缀的补 legacy: 前缀）
 * 3. 按优先级排序 ids
 * 4. 设置 id 字段为 primaryId（用于显示兼容）
 */
export function normalizeProjectMeta(meta: ProjectMeta): ProjectMeta {
  const idSet = new Set<string>();
  for (const id of meta.ids ?? []) {
    idSet.add(id.includes(':') ? id : normalizeLegacyId(id));
  }
  if (meta.id) {
    idSet.add(normalizeLegacyId(meta.id));
  }
  const sortedIds = sortIdsByPriority([...idSet]);
  const primaryId = selectPrimaryId(sortedIds);
  return { ...meta, ids: sortedIds, id: primaryId ?? undefined };
}

/**
 * 从 lattice.json 的 id 字段生成 legacy ID
 *
 * 判断是否已含前缀（有 `:` 则直接用，无则加 `legacy:` 前缀）
 */
export function normalizeLegacyId(rawId: string): string {
  if (rawId.includes(':')) return rawId;
  return `${ID_PREFIX.LEGACY}:${rawId}`;
}

/**
 * 归一化项目 ID：无前缀的补 `legacy:` 前缀
 *
 * 与 normalizeLegacyId 功能相同，但语义更清晰——用于"把任意项目 ID 归一化"
 * 的场景（入口层归一化、比较前归一化等）。
 */
export function normalizeProjectId(id: string): string {
  return normalizeLegacyId(id);
}

/**
 * 解析带前缀的 ID，返回 { prefix, content }
 */
export function parsePrefixedId(id: string): { prefix: string; content: string } {
  const idx = id.indexOf(':');
  if (idx === -1) {
    return { prefix: '', content: id };
  }
  return { prefix: id.slice(0, idx), content: id.slice(idx + 1) };
}

/**
 * 按优先级选择主 ID
 *
 * 优先级：legacy: > git: > remote:
 * 相同优先级按数组顺序取第一个
 */
export function selectPrimaryId(ids: string[]): string | null {
  if (ids.length === 0) return null;

  let best: string | null = null;
  let bestPriority = Infinity;

  for (const id of ids) {
    const prefix = id.split(':')[0];
    const priority = ID_PRIORITY_MAP[prefix] ?? Infinity;
    if (priority < bestPriority) {
      bestPriority = priority;
      best = id;
    }
  }

  return best ?? ids[0];
}

/**
 * 对 ids 数组按优先级排序（去重）
 *
 * 优先级：legacy: > git: > remote:
 * 相同优先级保持原有相对顺序（稳定排序）
 * 未知前缀的 ID 放最后
 */
export function sortIdsByPriority(ids: string[]): string[] {
  const indexed = ids.map((id, originalIndex) => {
    const prefix = id.split(':')[0];
    const priority = ID_PRIORITY_MAP[prefix] ?? Infinity;
    return { id, priority, originalIndex };
  });

  indexed.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.originalIndex - b.originalIndex;
  });

  const seen = new Set<string>();
  const result: string[] = [];
  for (const { id } of indexed) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }

  return result;
}

/**
 * 合并两个 ids 数组（去重 + 按优先级排序）
 */
export function mergeIds(idsA: string[], idsB: string[]): string[] {
  const merged = [...idsA, ...idsB];
  return sortIdsByPriority(merged);
}
