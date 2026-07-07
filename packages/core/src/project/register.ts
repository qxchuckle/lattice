/**
 * 项目注册 + 自动注册 — 依赖 identity + DB
 *
 * 核心函数：
 * - registerProjectWithIds() — 带 IDs 注册新项目
 * - updateProjectPaths() — 更新 localPaths（新路径追加）
 * - autoRegisterProject() — 自动注册（resolveCurrentProject 用）
 * - syncProjectIdsToDb() — 把每个 ID 写入 fingerprints 表 key='project_id'
 */

import { basename } from 'node:path';
import type { ProjectMeta, ProjectRow, ProjectFingerprintRow } from '../types';
import {
  getProjectDir,
  getProjectMetaPath,
  getProjectSpecDir,
  getUserProjectsDir,
  readJSON,
  writeJSON,
  ensureDir,
  fileExists,
  join,
} from '../paths';
import { upsertProject, upsertFingerprint, getProjectById } from '../db';
import {
  computeProjectIds,
  selectPrimaryId,
  resolveProjectIds,
  normalizeProjectMeta,
  type FingerprintDerived,
} from './identity';
import { findProjectByAnyId } from './lookup';
import { collectFingerprint, normalizeLocalPath } from './fingerprint';
import { nowISO } from '../utils/time';

// ─── 辅助 ───

/**
 * 项目目录名 = 完整的带前缀 ID
 *
 * `git:3a7f8b2c1d9e0f3a` → `git:3a7f8b2c1d9e0f3a`
 * `legacy:f92c45e0d902f03b` → `legacy:f92c45e0d902f03b`
 */
function makeDirNameFromId(id: string): string {
  return id;
}

/**
 * 推导项目名：package.json name > 目录名
 */
async function deriveProjectName(projectPath: string): Promise<string> {
  const pkgPath = join(projectPath, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJSON<{ name?: string }>(pkgPath);
    if (pkg?.name) return pkg.name;
  }
  return basename(projectPath);
}

/**
 * 把项目的所有 IDs 写入 fingerprints 表（key='project_id'）
 */
export function syncProjectIdsToDb(projectId: string, ids: string[]): void {
  for (const id of ids) {
    const row: ProjectFingerprintRow = {
      project_id: projectId,
      key: 'project_id',
      value: id,
      weight: 0,
    };
    upsertFingerprint(row);
  }
}

/**
 * 把 ProjectMeta 同步到 DB（projects 表 + fingerprints 表）
 */
export function syncProjectMetaToDb(username: string, meta: ProjectMeta): void {
  const primaryId = selectPrimaryId(meta.ids);
  if (!primaryId) return;

  try {
    upsertProject({
      id: primaryId,
      name: meta.name,
      local_path: JSON.stringify(meta.localPaths ?? []),
      description: meta.description ?? null,
      git_remote:
        meta.gitRemotes && meta.gitRemotes.length > 0 ? JSON.stringify(meta.gitRemotes) : null,
      git_first_commit: meta.gitFirstCommit ?? null,
      git_default_branch: meta.gitDefaultBranch ?? null,
      package_names:
        meta.packageNames && meta.packageNames.length > 0
          ? JSON.stringify(meta.packageNames)
          : null,
      monorepo_packages:
        meta.monorepoPackages && meta.monorepoPackages.length > 0
          ? JSON.stringify(meta.monorepoPackages)
          : null,
      groups: meta.groups ? JSON.stringify(meta.groups) : null,
      tags: meta.tags ? JSON.stringify(meta.tags) : null,
      username,
      created: meta.created,
      updated: meta.updated ?? null,
    });

    // 同步 IDs 到 fingerprints 表
    syncProjectIdsToDb(primaryId, meta.ids);
  } catch {
    // DB 可能未初始化，静默跳过
  }
}

// ─── 注册 ───

/**
 * 带 IDs 注册新项目
 *
 * 1. 生成项目目录名（从 ids[0] 去前缀）
 * 2. 写入 project.json（含 ids 字段）
 * 3. 同步到 DB（projects 表 + fingerprints 表 key='project_id'）
 *
 * @param username 用户名
 * @param ids 项目 IDs 数组（已按优先级排序）
 * @param localPath 项目本地路径
 * @param derived 指纹采集结果
 * @returns 注册的 ProjectMeta
 */
export async function registerProjectWithIds(
  username: string,
  ids: string[],
  localPath: string,
  derived: FingerprintDerived,
): Promise<ProjectMeta> {
  const primaryId = selectPrimaryId(ids) ?? ids[0];
  const dirName = makeDirNameFromId(primaryId);
  const normalizedPath = normalizeLocalPath(localPath);
  const now = nowISO();

  const name = await deriveProjectName(localPath);

  const meta: ProjectMeta = {
    ids,
    name,
    localPaths: [normalizedPath],
    gitFirstCommit: derived.gitFirstCommit,
    gitRemotes: derived.gitRemotes.length > 0 ? derived.gitRemotes : undefined,
    gitDefaultBranch: derived.gitDefaultBranch,
    packageNames: derived.packageNames.length > 0 ? derived.packageNames : undefined,
    monorepoPackages: derived.monorepoPackages.length > 0 ? derived.monorepoPackages : undefined,
    fingerprintsUpdated: now,
    created: now,
  };

  const projectDir = getProjectDir(username, dirName);
  await ensureDir(projectDir);
  await ensureDir(getProjectSpecDir(username, dirName));
  await writeJSON(getProjectMetaPath(username, dirName), meta);

  syncProjectMetaToDb(username, meta);

  return meta;
}

/**
 * 更新项目的 localPaths（新路径追加）
 *
 * @param projectId 项目主 ID
 * @param username 项目所属用户名
 * @param localPath 新的本地路径
 */
export async function updateProjectPaths(
  projectId: string,
  username: string,
  localPath: string,
): Promise<void> {
  const normalizedPath = normalizeLocalPath(localPath);
  const dirName = makeDirNameFromId(projectId);
  const metaPath = getProjectMetaPath(username, dirName);

  // 如果传入的 username + dirName 对应的文件不存在，尝试 findUsernameAndDirName 兜底
  let actualUsername = username;
  let actualDirName = dirName;
  if (!(await fileExists(metaPath))) {
    const { findUsernameAndDirName } = await import('./lookup');
    const found = await findUsernameAndDirName(projectId);
    if (!found) return;
    actualUsername = found.username;
    actualDirName = found.dirName;
  }

  const actualMetaPath = getProjectMetaPath(actualUsername, actualDirName);
  const rawMeta = await readJSON<ProjectMeta>(actualMetaPath);
  if (!rawMeta) return;
  const meta = normalizeProjectMeta(rawMeta);

  const localPaths = new Set(meta.localPaths ?? []);
  localPaths.add(normalizedPath);

  const updated: ProjectMeta = {
    ...meta,
    localPaths: [...localPaths],
    updated: nowISO(),
  };

  await writeJSON(actualMetaPath, updated);
  syncProjectMetaToDb(actualUsername, updated);
}

/**
 * 自动注册项目（resolveCurrentProject 用）
 *
 * 幂等：已注册的项目只更新 localPaths，不重复创建
 *
 * lattice.json 已存在时：如果 IDs 中含 legacy: ID，但找到的项目没有对应的
 * legacy: ID（通过 git: 匹配上），则新建项目（不修改原项目）。
 * 这确保 lattice.json 的 legacy ID 始终对应一个独立的注册项目。
 *
 * 多用户：如果 findProjectByAnyId 返回的是其他用户的项目，为当前用户注册新项目
 *
 * @param username 当前用户名
 * @param ids 项目 IDs 数组
 * @param localPath 项目本地路径
 * @returns { meta, isNew } — 注册的 ProjectMeta 和是否新建
 */
export async function autoRegisterProject(
  username: string,
  ids: string[],
  localPath: string,
): Promise<{ meta: ProjectMeta | null; isNew: boolean }> {
  if (ids.length === 0) return { meta: null, isNew: false };

  // 查 DB 是否已有项目匹配任一 ID
  const existing = findProjectByAnyId(ids);

  if (existing) {
    // 当前用户的项目 → 检查是否真正是同一个项目
    if (existing.username === username) {
      // 如果 IDs 中含 legacy: ID，检查找到的项目是否也有该 legacy: ID
      const legacyIds = ids.filter((id) => id.startsWith('legacy:'));
      if (legacyIds.length > 0) {
        const { getProjectMetaById } = await import('./lookup');
        const existingData = await getProjectMetaById(existing.id);
        const existingIds = existingData ? existingData.meta.ids : [];
        const hasMatchingLegacy = legacyIds.some((id) => existingIds.includes(id));

        if (!hasMatchingLegacy) {
          // 找到的项目没有对应的 legacy: ID（通过 git: 匹配上）
          // → 不修改原项目，为当前 legacy: ID 新建项目
          const { derived } = await collectFingerprint(localPath);
          const meta = await registerProjectWithIds(username, ids, localPath, derived);
          return { meta, isNew: true };
        }
      }

      // 无 legacy: ID 或 legacy: ID 匹配 → 更新 localPaths
      await updateProjectPaths(existing.id, username, localPath);
      const { getProjectMetaById } = await import('./lookup');
      const updated = await getProjectMetaById(existing.id);
      return { meta: updated?.meta ?? null, isNew: false };
    }
    // 其他用户的项目 → 为当前用户注册新项目
  }

  // 未注册 / 其他用户 → 注册新项目
  const { derived } = await collectFingerprint(localPath);
  const meta = await registerProjectWithIds(username, ids, localPath, derived);
  return { meta, isNew: true };
}
