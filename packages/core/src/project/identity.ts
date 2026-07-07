/**
 * 项目身份标识 ID 模型 — 纯函数模块，不依赖 DB
 *
 * ID 格式：`<prefix>:<content>`
 * - `legacy:` — lattice.json 中的 16 字符随机 id（优先级最高）
 * - `git:` — git first commit SHA 前 16 位
 * - `remote:` — sha256(normalize(git_remote)) 前 16 位（每个 remote 一个）
 */

import { createHash, randomBytes } from 'node:crypto';
import { resolve as pathResolve } from 'node:path';
import { createRequire } from 'node:module';
import type { ProjectMeta } from '../types';
import { normalizeGitRemote, type FingerprintDerived } from './fingerprint';

const nodeMachineId: typeof import('node-machine-id') = createRequire(import.meta.url)(
  'node-machine-id',
);
const { machineIdSync } = nodeMachineId;

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

// ─── 类型 ───

// FingerprintDerived 从 fingerprint.ts 导入，避免重复定义
export type { FingerprintDerived } from './fingerprint';

// ─── legacy ID 生成 ───

function hashSegment(input: string, length: number): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

function getMachineCode(): string {
  return hashSegment(machineIdSync(), 4);
}

function getDirectoryCode(projectPath: string): string {
  return hashSegment(pathResolve(projectPath), 4);
}

/**
 * 生成 legacy ID（16 字符随机 hex）
 *
 * 用于 lattice.json 的 id 字段
 */
export function generateProjectId(projectPath: string): string {
  return `${getMachineCode()}${getDirectoryCode(projectPath)}${randomBytes(4).toString('hex')}`;
}

// ─── 纯函数 ───

/**
 * 从指纹数据 + legacy id 计算项目的所有 IDs
 *
 * IDs 顺序不保证优先级，优先级由 selectPrimaryId() 运行时计算
 */
export function computeProjectIds(derived: FingerprintDerived, legacyId: string | null): string[] {
  const ids: string[] = [];

  if (legacyId) {
    ids.push(legacyId);
  }

  if (derived.gitFirstCommit) {
    ids.push(`${ID_PREFIX.GIT}:${derived.gitFirstCommit.slice(0, 16)}`);
  }

  for (const remote of derived.gitRemotes) {
    const hash = createHash('sha256').update(remote).digest('hex').slice(0, 16);
    ids.push(`${ID_PREFIX.REMOTE}:${hash}`);
  }

  return ids;
}

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
 *    — 即使 ids 有值，id 字段也要读取合并，避免遗漏
 * 2. 确保 ids 数组中所有 ID 都有前缀（无前缀的补 legacy: 前缀）
 * 3. 按优先级排序 ids
 * 4. 设置 id 字段为 primaryId（用于显示兼容，新代码应使用 ids + selectPrimaryId）
 *
 * 调用此函数后，后续代码无需再处理 meta.id 兼容性
 */
export function normalizeProjectMeta(meta: ProjectMeta): ProjectMeta {
  const idSet = new Set<string>();
  // 先把 ids 数组中的 ID 加入（确保有前缀）
  for (const id of meta.ids ?? []) {
    idSet.add(id.includes(':') ? id : normalizeLegacyId(id));
  }
  // 如果有 id 字段，也合并进来（即使 ids 有值）
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
