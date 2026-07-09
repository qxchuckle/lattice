/**
 * 虚拟合并模块 — 统一封装虚拟合并逻辑
 *
 * 虚拟合并：IDs 有交集的项目在查询层聚合，零物理操作。
 * 应用层通过本模块获取虚拟节点信息，不直接操作物理目录。
 *
 * 核心函数：
 * - getRelatedProjectIds() — BFS 递归查找虚拟合并组
 * - getProjectDirNames() — 查虚拟合并组的所有物理目录名
 * - getVirtualProjectMeta() — 聚合虚拟合并组的 meta
 * - listVirtualProjectMetas() — 按 primaryId 去重的 meta 列表
 */

import type { ProjectMeta } from '../types';
import { listAllProjects, listProjectDirs } from '../db';
import { findProjectsByFingerprint, listFingerprintsByProject } from '../db';
import { selectPrimaryId, normalizeProjectId, normalizeProjectMeta, ID_PREFIX } from './identity';
import { getProjectMetaPath, fileExists, readJSON } from '../paths';

// ─── 进程内缓存 ───

const _relatedCache = new Map<string, string[]>();

// ─── 虚拟合并组查询 ───

/**
 * 获取与指定项目 IDs 有交集的所有项目 ID（含自身）
 *
 * BFS 递归处理传递性：
 * A-B 交集 + B-C 交集 → getRelatedProjectIds(A) 返回 [A, B, C]
 *
 * 保护机制：两边都有 `legacy:` ID 但不相同的 → 不合并；
 * 其他情况（任一方无 legacy，或 legacy 相同）有 ID 交集 → 合并。
 */
export function getRelatedProjectIds(projectId: string): string[] {
  const cached = _relatedCache.get(projectId);
  if (cached) return cached;

  const result = new Set<string>([projectId]);
  const queue = [projectId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const ids = getProjectIdsFromDb(current);
    const currentLegacyIds = ids.filter((id) => id.startsWith(`${ID_PREFIX.LEGACY}:`));

    for (const id of ids) {
      const matches = findProjectsByFingerprint('project_id', id);
      for (const match of matches) {
        if (result.has(match.project_id)) continue;

        // 保护：两边都有 legacy 但不相同 → 不合并
        if (currentLegacyIds.length > 0) {
          const matchIds = getProjectIdsFromDb(match.project_id);
          const matchLegacyIds = matchIds.filter((i) => i.startsWith(`${ID_PREFIX.LEGACY}:`));
          if (matchLegacyIds.length > 0) {
            const hasCommonLegacy = currentLegacyIds.some((lid) => matchLegacyIds.includes(lid));
            if (!hasCommonLegacy) continue;
          }
        }

        result.add(match.project_id);
        queue.push(match.project_id);
      }
    }
  }

  const resultArr = [...result];
  _relatedCache.set(projectId, resultArr);
  return resultArr;
}

/**
 * 从 DB 获取项目的所有 IDs（通过 fingerprints 表）
 */
export function getProjectIdsFromDb(projectId: string): string[] {
  const rows = listFingerprintsByProject(projectId);
  return rows.filter((r) => r.key === 'project_id').map((r) => r.value);
}

/**
 * 从 DB 查询某个项目（含虚拟合并组）在某用户下的所有物理目录名
 */
export function getProjectDirNames(username: string, projectId: string): string[] {
  const normalizedId = normalizeProjectId(projectId);
  let relatedIds: string[];
  try {
    relatedIds = getRelatedProjectIds(normalizedId);
  } catch {
    relatedIds = [normalizedId];
  }

  const dirNames = new Set<string>();
  for (const rid of relatedIds) {
    try {
      const dirs = listProjectDirs(rid, username);
      for (const d of dirs) {
        dirNames.add(d.dir_name);
      }
    } catch {
      // DB 不可用
    }
  }
  return [...dirNames];
}

// ─── 虚拟节点 meta 聚合 ───

/**
 * 读取单个物理目录的 ProjectMeta
 */
async function readProjectMetaFromDir(
  username: string,
  dirName: string,
): Promise<ProjectMeta | null> {
  const metaPath = getProjectMetaPath(username, dirName);
  if (!(await fileExists(metaPath))) return null;
  const rawMeta = await readJSON<ProjectMeta>(metaPath);
  if (!rawMeta) return null;
  return normalizeProjectMeta(rawMeta);
}

/**
 * 获取虚拟合并组聚合后的 ProjectMeta
 *
 * 遍历虚拟合并组的所有物理目录，聚合：
 * - localPaths 合并（去重）
 * - groups 合并（去重）
 * - tags 合并（去重）
 * - gitRemotes 合并（去重）
 * - monorepoPackages 合并（去重）
 * - packageNames 合并（去重）
 * - 其他字段取 primaryId 最新的（updated 最大）
 *
 * @returns 聚合后的 ProjectMeta，或 null 如果目录不存在
 */
export async function getVirtualProjectMeta(
  username: string,
  projectId: string,
): Promise<ProjectMeta | null> {
  const normalizedId = normalizeProjectId(projectId);
  const dirNames = getProjectDirNames(username, normalizedId);

  if (dirNames.length === 0) {
    // DB 无记录，回退：直接用 normalizedId 作为目录名尝试读取
    return readProjectMetaFromDir(username, normalizedId);
  }

  // 读取所有物理目录的 meta
  const metas: ProjectMeta[] = [];
  for (const dirName of dirNames) {
    const meta = await readProjectMetaFromDir(username, dirName);
    if (meta) metas.push(meta);
  }

  if (metas.length === 0) return null;
  if (metas.length === 1) return metas[0];

  // 聚合多个物理目录的 meta
  return mergeProjectMetas(metas);
}

/**
 * 聚合多个 ProjectMeta 为一个虚拟节点 meta
 */
function mergeProjectMetas(metas: ProjectMeta[]): ProjectMeta {
  // 取 updated 最新的作为基准
  const sorted = [...metas].sort((a, b) => {
    const ta = a.updated ? Date.parse(a.updated) : 0;
    const tb = b.updated ? Date.parse(b.updated) : 0;
    return tb - ta;
  });
  const base = sorted[0];

  // 合并数组字段（去重）
  const localPaths = unique(metas.flatMap((m) => m.localPaths ?? []));
  const groups = unique(metas.flatMap((m) => m.groups ?? []));
  const tags = unique(metas.flatMap((m) => m.tags ?? []));
  const gitRemotes = unique(metas.flatMap((m) => m.gitRemotes ?? []));
  const packageNames = unique(metas.flatMap((m) => m.packageNames ?? []));
  const monorepoPackages = unique(metas.flatMap((m) => m.monorepoPackages ?? []));

  // 合并 ids（去重，按优先级排序）
  const allIds = new Set<string>();
  for (const m of metas) {
    for (const id of m.ids ?? []) {
      allIds.add(id);
    }
  }

  return {
    ...base,
    ids: [...allIds],
    localPaths,
    groups: groups.length > 0 ? groups : undefined,
    tags: tags.length > 0 ? tags : undefined,
    gitRemotes: gitRemotes.length > 0 ? gitRemotes : undefined,
    packageNames: packageNames.length > 0 ? packageNames : undefined,
    monorepoPackages: monorepoPackages.length > 0 ? monorepoPackages : undefined,
  };
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ─── 虚拟节点列表 ───

/**
 * 列出用户所有虚拟项目的 ProjectMeta（按 primaryId 去重）
 *
 * 遍历 DB projects 表获取所有 primaryId，
 * 对每个 primaryId 通过 getVirtualProjectMeta 聚合虚拟合并组。
 */
export async function listVirtualProjectMetas(username: string): Promise<ProjectMeta[]> {
  const projects = listAllProjects(username);
  const seenPrimaryIds = new Set<string>();
  const results: ProjectMeta[] = [];

  for (const p of projects) {
    if (seenPrimaryIds.has(p.id)) continue;
    seenPrimaryIds.add(p.id);

    const meta = await getVirtualProjectMeta(username, p.id);
    if (meta) results.push(meta);
  }

  return results;
}

/**
 * 清除进程内缓存（测试用）
 */
export function clearVirtualMergeCache(): void {
  _relatedCache.clear();
}
