/**
 * 项目查找 + 虚拟合并 — 依赖 DB + identity
 *
 * 核心函数：
 * - findProjectByAnyId() — 通过任意 ID 精确查 DB
 * - getRelatedProjectIds() — BFS 递归查找所有 IDs 有交集的项目（虚拟合并）
 */

import type { ProjectRow } from '../types';
import { getProjectById, findProjectsByFingerprint, listFingerprintsByProject } from '../db';
import { resolveProjectIds, normalizeProjectMeta, ID_PREFIX } from './identity';
import type { ProjectMeta } from '../types';
import { readJSON } from '../paths';
import { getProjectMetaPath, getUserProjectsDir } from '../paths';
import { listDir } from '../paths';

// ─── 进程内缓存 ───

const _relatedCache = new Map<string, string[]>();
const _findCache = new Map<string, ProjectRow | null>();

// ─── 查找 ───

/**
 * 通过任意 ID 查找已注册项目
 *
 * 查找顺序：
 * 1. projects 表的 id 列（主 ID）
 * 2. project_fingerprints 表 key='project_id' 的行（所有 IDs）
 *
 * @param ids 要查找的 IDs 数组
 * @returns 第一个匹配的 ProjectRow，或 null
 */
export function findProjectByAnyId(ids: string[]): ProjectRow | null {
  for (const id of ids) {
    // 缓存检查（只缓存命中的结果，不缓存 null——DB 可能后续有数据）
    const cached = _findCache.get(id);
    if (cached !== undefined) return cached;

    // 1. 查 projects.id
    const row = getProjectById(id);
    if (row) {
      _findCache.set(id, row);
      return row;
    }

    // 2. 查 fingerprints key='project_id'
    const fpRows = findProjectsByFingerprint('project_id', id);
    if (fpRows.length > 0) {
      const projectRow = getProjectById(fpRows[0].project_id);
      if (projectRow) {
        _findCache.set(id, projectRow);
        return projectRow;
      }
    }

    // 3. 无前缀 id 兼容匹配：自动补 legacy: 前缀
    if (!id.includes(':')) {
      const legacyId = `legacy:${id}`;
      const legacyRow = getProjectById(legacyId);
      if (legacyRow) {
        _findCache.set(id, legacyRow);
        return legacyRow;
      }
      const legacyFpRows = findProjectsByFingerprint('project_id', legacyId);
      if (legacyFpRows.length > 0) {
        const projectRow = getProjectById(legacyFpRows[0].project_id);
        if (projectRow) {
          _findCache.set(id, projectRow);
          return projectRow;
        }
      }
    }
    // 不缓存 null：扫描过程中可能刚注册了新项目
  }

  return null;
}

/**
 * 通过任意 ID 查找所有匹配的已注册项目（去重）
 *
 * 与 findProjectByAnyId 类似，但返回所有匹配项目，而非只返回第一个。
 * 用于 autoRegisterProject 时需要更新所有物理注册项目的场景。
 */
export function findAllProjectsByAnyId(ids: string[]): ProjectRow[] {
  const seen = new Set<string>();
  const results: ProjectRow[] = [];

  for (const id of ids) {
    const candidates: string[] = [id];
    // 无前缀 id 兼容匹配
    if (!id.includes(':')) {
      candidates.push(`legacy:${id}`);
    }

    for (const candidate of candidates) {
      // 1. 查 projects.id
      const row = getProjectById(candidate);
      if (row && !seen.has(row.id)) {
        seen.add(row.id);
        results.push(row);
      }

      // 2. 查 fingerprints key='project_id'
      const fpRows = findProjectsByFingerprint('project_id', candidate);
      for (const fp of fpRows) {
        if (!seen.has(fp.project_id)) {
          const projectRow = getProjectById(fp.project_id);
          if (projectRow) {
            seen.add(projectRow.id);
            results.push(projectRow);
          }
        }
      }
    }
  }

  return results;
}

/**
 * 从 DB 获取项目的所有 IDs（通过 fingerprints 表）
 *
 * 读取 key='project_id' 的所有 value
 */
export function getProjectIdsFromDb(projectId: string): string[] {
  const rows = listFingerprintsByProject(projectId);
  return rows.filter((r) => r.key === 'project_id').map((r) => r.value);
}

/**
 * 获取与指定项目 IDs 有交集的所有项目 ID（含自身）
 *
 * BFS 递归处理传递性：
 * A-B 交集 + B-C 交集 → getRelatedProjectIds(A) 返回 [A, B, C]
 *
 * 保护机制：有 `legacy:` ID 的项目，只匹配 `legacy:` ID 相同的项目；
 * 没有 `legacy:` ID 的项目，匹配所有 IDs 交集。
 *
 * 进程内缓存：单次 CLI 调用内缓存结果
 */
export function getRelatedProjectIds(projectId: string): string[] {
  // 缓存检查
  const cached = _relatedCache.get(projectId);
  if (cached) return cached;

  const result = new Set<string>([projectId]);
  const queue = [projectId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    // 从 DB 获取当前项目的所有 IDs
    const ids = getProjectIdsFromDb(current);

    // 保护机制：有 legacy: ID 的项目只匹配 legacy: 交集
    const legacyIds = ids.filter((id) => id.startsWith(`${ID_PREFIX.LEGACY}:`));
    const idsToMatch = legacyIds.length > 0 ? legacyIds : ids;

    for (const id of idsToMatch) {
      const matches = findProjectsByFingerprint('project_id', id);
      for (const match of matches) {
        if (!result.has(match.project_id)) {
          result.add(match.project_id);
          queue.push(match.project_id); // 递归查找新发现的项目
        }
      }
    }
  }

  const resultArr = [...result];
  _relatedCache.set(projectId, resultArr);
  return resultArr;
}

/**
 * 清除进程内缓存（测试用）
 */
export function clearLookupCache(): void {
  _relatedCache.clear();
  _findCache.clear();
}

// ─── 项目元数据读取（从文件） ───

/**
 * 通过项目 ID 查找 username 和目录名
 *
 * 扫描所有用户的 projects 目录，找到匹配的项目
 */
export async function findUsernameAndDirName(
  projectId: string,
): Promise<{ username: string; dirName: string } | null> {
  // 先从 DB 查 username
  const row = getProjectById(projectId);
  if (row) {
    const username = row.username;
    // 目录名 = 完整的带前缀 ID
    const dirName = row.id;
    // 验证文件存在
    const metaPath = getProjectMetaPath(username, dirName);
    const { fileExists } = await import('../paths');
    if (await fileExists(metaPath)) {
      return { username, dirName };
    }
  }

  // DB 没有则扫描文件系统
  const { getUsersDir } = await import('../paths');
  let usernames: string[];
  try {
    usernames = await listDir(getUsersDir());
  } catch {
    return null;
  }

  for (const username of usernames) {
    if (username.startsWith('.')) continue;
    let projectDirs: string[];
    try {
      projectDirs = await listDir(getUserProjectsDir(username));
    } catch {
      continue;
    }
    for (const dirName of projectDirs) {
      if (dirName.startsWith('.')) continue;
      const metaPath = getProjectMetaPath(username, dirName);
      const { fileExists } = await import('../paths');
      if (await fileExists(metaPath)) {
        const rawMeta = await readJSON<ProjectMeta>(metaPath);
        if (rawMeta) {
          const meta = normalizeProjectMeta(rawMeta);
          if (meta.ids.includes(projectId)) {
            return { username, dirName };
          }
        }
      }
    }
  }

  return null;
}

/**
 * 通过项目 ID 读取 ProjectMeta（需要查找 username）
 */
export async function getProjectMetaById(
  projectId: string,
): Promise<{ meta: ProjectMeta; username: string } | null> {
  const found = await findUsernameAndDirName(projectId);
  if (!found) return null;
  const rawMeta = await readJSON<ProjectMeta>(getProjectMetaPath(found.username, found.dirName));
  if (!rawMeta) return null;
  const meta = normalizeProjectMeta(rawMeta);
  return { meta, username: found.username };
}
