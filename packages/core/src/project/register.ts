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
  selectPrimaryId,
  resolveProjectIds,
  normalizeProjectMeta,
  type FingerprintDerived,
} from './identity';
import { computeProjectIds } from './identity-generate';
import {
  findProjectByAnyId,
  findAllProjectsByAnyId,
  getProjectMetaById,
  findProjectsOnDisk,
} from './lookup';
import { collectFingerprint, normalizeLocalPath } from './fingerprint';
import { detectAndLinkNestedIn } from './nested-in';
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
  const beforeSize = localPaths.size;
  localPaths.add(normalizedPath);

  // 路径已存在，无需更新
  if (localPaths.size === beforeSize) return;

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
  existingDerived?: FingerprintDerived,
): Promise<{ meta: ProjectMeta | null; isNew: boolean }> {
  if (ids.length === 0) return { meta: null, isNew: false };

  const newLegacyIds = ids.filter((id) => id.startsWith('legacy:'));

  // 查找所有匹配的物理注册项目（一个运行时项目可能由多个物理项目聚合）
  const allMatches = findAllProjectsByAnyId(ids);
  let ownMatches = allMatches.filter((p) => p.username === username);

  // DB 未命中时，回退扫描磁盘（兼容磁盘有 project.json 但 DB 无记录的不一致状态）
  // 兼容旧格式：目录名无前缀、project.json 只有 id 字段、id 无前缀
  if (ownMatches.length === 0) {
    const diskMatches = await findProjectsOnDisk(username, ids);
    if (diskMatches.length > 0) {
      // 磁盘找到 → 先同步到 DB（自愈），然后当作已有项目处理
      for (const dm of diskMatches) {
        const existingData = await getProjectMetaById(dm.id);
        if (existingData) {
          syncProjectMetaToDb(existingData.username, existingData.meta);
        }
      }
      ownMatches = diskMatches;
    }
  }

  // ── Legacy ID 特殊处理 ──
  // 检查是否有任一物理项目匹配 legacy: ID
  if (newLegacyIds.length > 0) {
    let legacyMatched = false;
    for (const match of ownMatches) {
      const data = await getProjectMetaById(match.id);
      const existingLegacyIds = (data?.meta.ids ?? []).filter((id) => id.startsWith('legacy:'));
      if (newLegacyIds.some((id) => existingLegacyIds.includes(id))) {
        legacyMatched = true;
        break;
      }
    }
    if (!legacyMatched) {
      // 没有物理项目匹配 legacy: → 新建项目，不修改任何已有项目
      const derived = existingDerived ?? (await collectFingerprint(localPath)).derived;
      const meta = await registerProjectWithIds(username, ids, localPath, derived);
      const primaryId = selectPrimaryId(meta.ids) ?? meta.id ?? ids[0];
      if (primaryId) await detectAndLinkNestedIn(username, primaryId, localPath);
      return { meta, isNew: true };
    }
  }

  if (ownMatches.length === 0) {
    // 未注册 / 其他用户 → 注册新项目
    const derived = existingDerived ?? (await collectFingerprint(localPath)).derived;
    const meta = await registerProjectWithIds(username, ids, localPath, derived);
    const primaryId = selectPrimaryId(meta.ids) ?? meta.id ?? ids[0];
    if (primaryId) {
      await detectAndLinkNestedIn(username, primaryId, localPath);
    }
    return { meta, isNew: true };
  }

  // ── 遍历所有匹配的物理项目，分别按规则更新 ──
  let lastMeta: ProjectMeta | null = null;
  for (const match of ownMatches) {
    const existingData = await getProjectMetaById(match.id);
    if (!existingData) continue;
    const existingIds = existingData.meta.ids;

    // 全匹配验证：已有项目的每个 ID 源都必须在当前扫描的 ids 中出现
    const allExistingMatch = existingIds.every((id) => ids.includes(id));
    if (allExistingMatch) {
      // 补全非 legacy ID 源（legacy 永远不自动添加）
      const newNonLegacyIds = ids.filter(
        (id) => !id.startsWith('legacy:') && !existingIds.includes(id),
      );
      if (newNonLegacyIds.length > 0) {
        existingData.meta.ids = [...existingIds, ...newNonLegacyIds];
        existingData.meta.fingerprintsUpdated = nowISO();
        await writeJSON(getProjectMetaPath(existingData.username, match.id), existingData.meta);
        syncProjectMetaToDb(existingData.username, existingData.meta);
      }
    }

    // 更新 localPaths（所有匹配项目都更新）
    await updateProjectPaths(match.id, username, localPath);
    lastMeta = (await getProjectMetaById(match.id))?.meta ?? null;
  }

  // 自动检测嵌套项目关系（用第一个匹配项目的 ID）
  if (ownMatches.length > 0) {
    await detectAndLinkNestedIn(username, ownMatches[0].id, localPath);
  }

  return { meta: lastMeta, isNew: false };
}
