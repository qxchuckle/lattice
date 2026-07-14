import { basename as pathBasename } from 'node:path';
import simpleGit from 'simple-git';
import type { ProjectMeta, ProjectRow } from '../types';
import {
  getProjectDir,
  getProjectMetaPath,
  getProjectSpecDir,
  getUserProjectsDir,
  readJSON,
  writeJSON,
  ensureDir,
  fileExists,
  listDir,
  removeDir,
  join,
} from '../paths';
import {
  upsertProject,
  upsertFingerprint,
  upsertProjectDir,
  deleteProject as dbDeleteProject,
  getProjectById as dbGetProjectById,
  getProjectByPath as dbGetProjectByPath,
  listAllProjects as dbListAllProjects,
} from '../db';
import {
  collectFingerprint,
  normalizeGitRemote,
  normalizeLocalPath,
  isPathPrefixOf,
} from './fingerprint';
import { deleteRelationsByProject, listRelations as listRelationsFromFile } from './relation';
import { nowISO } from '../utils/time';
import type { ProjectRelation } from '../types';
import { moveToTrash } from '../trash';
import {
  parsePrefixedId,
  resolveProjectIds,
  normalizeLegacyId,
  selectPrimaryId,
  normalizeProjectMeta,
} from './identity';
import { computeProjectIds, generateProjectId } from './identity-generate';

// ─── 项目信息自动检测（轻量）───

export interface DetectedProjectInfo {
  name: string;
  description?: string;
  gitRemotes: string[];
}

export async function detectProjectInfo(projectPath: string): Promise<DetectedProjectInfo> {
  const name = pathBasename(projectPath);
  let description: string | undefined;
  const gitRemotes: string[] = [];

  const pkgPath = join(projectPath, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJSON<{ name?: string; description?: string }>(pkgPath);
    if (pkg?.description) description = pkg.description;
  }

  try {
    const git = simpleGit(projectPath);
    const remotes = await git.getRemotes(true);
    for (const remote of remotes) {
      const url = remote.refs?.fetch || remote.refs?.push;
      if (url) {
        const normalized = normalizeGitRemote(url);
        if (normalized && !gitRemotes.includes(normalized)) gitRemotes.push(normalized);
      }
    }
  } catch {
    // 不是 git 仓库
  }

  return { name, description, gitRemotes };
}

// ─── 项目注册 ───

export async function registerProject(
  username: string,
  id: string,
  localPath: string,
  opts?: Partial<Pick<ProjectMeta, 'name' | 'description' | 'groups' | 'tags'>> & {
    gitRemotes?: string[];
  },
): Promise<ProjectMeta> {
  const detected = await detectProjectInfo(localPath);
  const fingerprint = await collectFingerprint(localPath);
  const now = nowISO();
  const dirName = normalizeLegacyId(id);
  const rawExisting = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
  const existingMeta = rawExisting ? normalizeProjectMeta(rawExisting) : null;
  const name = opts?.name ?? detected.name ?? existingMeta?.name;
  const normalizedPath = normalizeLocalPath(localPath);

  // 生成完整 IDs（legacy + git + remote）
  const legacyId = normalizeLegacyId(id);
  const ids = computeProjectIds(fingerprint.derived, legacyId);

  // localPaths 合并（去重）
  const localPaths = new Set<string>();
  if (existingMeta?.localPaths) {
    for (const p of existingMeta.localPaths) localPaths.add(p);
  }
  localPaths.add(normalizedPath);

  // gitRemotes 合并
  const gitRemotes = new Set<string>();
  if (existingMeta?.gitRemotes) {
    for (const r of existingMeta.gitRemotes) gitRemotes.add(r);
  }
  for (const r of opts?.gitRemotes ?? []) gitRemotes.add(normalizeGitRemote(r));
  for (const r of detected.gitRemotes) gitRemotes.add(r);

  const meta: ProjectMeta = {
    ids,
    name,
    description: opts?.description ?? existingMeta?.description ?? undefined,
    localPaths: [...localPaths],
    gitRemotes: gitRemotes.size > 0 ? [...gitRemotes] : undefined,
    gitFirstCommit: fingerprint.derived.gitFirstCommit ?? existingMeta?.gitFirstCommit,
    gitDefaultBranch: fingerprint.derived.gitDefaultBranch ?? existingMeta?.gitDefaultBranch,
    packageNames:
      fingerprint.derived.packageNames.length > 0
        ? fingerprint.derived.packageNames
        : existingMeta?.packageNames,
    monorepoPackages:
      fingerprint.derived.monorepoPackages.length > 0
        ? fingerprint.derived.monorepoPackages
        : existingMeta?.monorepoPackages,
    fingerprintsUpdated: now,
    groups: opts?.groups ?? existingMeta?.groups,
    tags: opts?.tags ?? existingMeta?.tags,
    created: existingMeta?.created ?? now,
    updated: existingMeta ? now : undefined,
  };

  if (!meta.description && existingMeta?.description) meta.description = existingMeta.description;
  if (!meta.description && detected.description) meta.description = detected.description;

  const projectDir = getProjectDir(username, dirName);
  await ensureDir(projectDir);
  await ensureDir(getProjectSpecDir(username, dirName));
  await writeJSON(getProjectMetaPath(username, dirName), meta);

  syncProjectToDb(username, meta, dirName);

  return meta;
}

// ─── 取消注册 ───

export async function unregisterProject(username: string, id: string): Promise<void> {
  const dirName = await findProjectDirName(username, id);
  if (dirName) {
    const projectDir = getProjectDir(username, dirName);
    const rawMeta = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
    const meta = rawMeta ? normalizeProjectMeta(rawMeta) : null;
    await moveToTrash(projectDir, {
      type: 'project',
      originalPath: projectDir,
      title: meta?.name ?? id,
      username,
      entityId: id,
      restoreHints: { localPaths: meta?.localPaths ?? [] },
    });
  }
  try {
    await deleteRelationsByProject(username, id);
  } catch {
    // relations.json 不存在时忽略
  }
  dbDeleteProject(id, username);
}

/** 彻底删除项目（跳过垃圾桶） */
export async function purgeProject(username: string, id: string): Promise<void> {
  try {
    await deleteRelationsByProject(username, id);
  } catch {
    // ignore
  }
  dbDeleteProject(id, username);
  const dirName = await findProjectDirName(username, id);
  if (dirName) {
    await removeDir(getProjectDir(username, dirName));
  }
}

// ─── 查询 ───

export async function getProjectMeta(username: string, id: string): Promise<ProjectMeta | null> {
  const dirName = await findProjectDirName(username, id);
  if (!dirName) return null;
  const meta = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
  return meta ? normalizeProjectMeta(meta) : null;
}

export async function updateProjectMeta(
  username: string,
  id: string,
  updates: Partial<ProjectMeta>,
): Promise<ProjectMeta | null> {
  const dirName = await findProjectDirName(username, id);
  if (!dirName) return null;

  const metaPath = getProjectMetaPath(username, dirName);
  const rawExisting = await readJSON<ProjectMeta>(metaPath);
  if (!rawExisting) return null;
  const existing = normalizeProjectMeta(rawExisting);

  const updated: ProjectMeta = {
    ...existing,
    ...updates,
    created: existing.created,
    updated: nowISO(),
  };

  await writeJSON(metaPath, updated);
  syncProjectToDb(username, updated, dirName);
  return updated;
}

export function listProjects(
  username: string,
  filter?: { group?: string; tag?: string; search?: string },
): ProjectRow[] {
  let projects = dbListAllProjects(username);
  if (filter?.group) {
    projects = projects.filter((p) => {
      const groups: string[] = p.groups ? JSON.parse(p.groups) : [];
      return groups.includes(filter.group!);
    });
  }
  if (filter?.tag) {
    projects = projects.filter((p) => {
      const tags: string[] = p.tags ? JSON.parse(p.tags) : [];
      return tags.includes(filter.tag!);
    });
  }
  if (filter?.search) {
    const kw = filter.search.toLowerCase();
    projects = projects.filter((p) => {
      const haystack = [
        p.name,
        p.id,
        p.local_path,
        p.description ?? '',
        p.git_remote ?? '',
        p.package_names ?? '',
        p.monorepo_packages ?? '',
        p.groups ?? '',
        p.tags ?? '',
      ]
        .join('\n')
        .toLowerCase();
      return haystack.includes(kw);
    });
  }
  return projects;
}

/**
 * 列出用户所有项目的完整 ProjectMeta（含 ids 数组）
 *
 * 遍历 projects 目录，读取每个 project.json 并 normalizeProjectMeta。
 * 比 listProjects 返回的 ProjectRow 多了 ids / localPaths / gitRemotes 等字段。
 */
export async function listProjectMetas(username: string): Promise<ProjectMeta[]> {
  const results: ProjectMeta[] = [];
  let entries: string[];
  try {
    entries = await listDir(getUserProjectsDir(username));
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const metaPath = getProjectMetaPath(username, entry);
    if (!(await fileExists(metaPath))) continue;
    const rawMeta = await readJSON<ProjectMeta>(metaPath);
    if (!rawMeta) continue;
    results.push(normalizeProjectMeta(rawMeta));
  }
  return results;
}

/**
 * 按本地路径查找项目：
 * 1. 先走 db 的 LIKE 精确包含查询（localPaths 存为 JSON 字符串）
 * 2. 如果未命中，再走 fingerprint 反查（父目录前缀 / basename / monorepo 包名）
 */
export function findProjectByPath(localPath: string): ProjectRow | undefined {
  const direct = dbGetProjectByPath(localPath);
  if (direct) return direct;
  return undefined;
}

export function findProjectById(id: string): ProjectRow | undefined {
  return dbGetProjectById(id);
}

/** 通过精确 ID 或前缀匹配解析项目 */
export function resolveProjectById(username: string, input: string): ProjectRow | undefined {
  const projects = dbListAllProjects(username);
  return projects.find((p) => p.id === input) ?? projects.find((p) => p.id.startsWith(input));
}

/**
 * 获取所有项目关系（从 relations.json 单一真源读取）
 * 返回格式保持与原同，但额外带 id。
 */
export async function getAllUniqueRelations(
  username: string,
  projectIds?: string[],
): Promise<
  {
    id: string;
    project_a: string;
    project_b: string;
    relation_type: string;
    description: string | null;
  }[]
> {
  let relations: ProjectRelation[];
  try {
    relations = await listRelationsFromFile(username);
  } catch {
    relations = [];
  }

  const projectFilter = projectIds ? new Set(projectIds) : null;
  const seen = new Set<string>();
  const results: {
    id: string;
    project_a: string;
    project_b: string;
    relation_type: string;
    description: string | null;
  }[] = [];

  for (const r of relations) {
    if (projectFilter && !projectFilter.has(r.projectA) && !projectFilter.has(r.projectB)) continue;
    const key = `${r.projectA}:${r.projectB}:${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: r.id,
      project_a: r.projectA,
      project_b: r.projectB,
      relation_type: r.type,
      description: r.description ?? null,
    });
  }
  return results;
}

/** 解析项目行的 tags/groups JSON 字符串为数组 */
export function parseProjectRow(
  row: ProjectRow,
): ProjectRow & { parsedTags: string[]; parsedGroups: string[] } {
  return {
    ...row,
    parsedTags: row.tags ? JSON.parse(row.tags) : [],
    parsedGroups: row.groups ? JSON.parse(row.groups) : [],
  };
}

// ─── 扫描发现 ───
// scanForProjects 已迁移到 ./scan.ts，通过 re-export 导出

// ─── 工具函数 ───

/**
 * 解析项目 id 对应的目录名。
 * 主路径：dirName === id（完整的带前缀 ID）。
 * 兼容回退 1：无前缀的历史 ID，补 legacy: 前缀匹配。
 * 兼容回退 2：扫描 projects 目录，匹配 project.json 中 ids 包含该 id 的目录。
 */
async function findProjectDirName(username: string, id: string): Promise<string | null> {
  // 主路径：用完整 ID 作为目录名
  if (await fileExists(getProjectMetaPath(username, id))) {
    return id;
  }
  // 兼容：无前缀的历史 ID，补 legacy: 前缀
  if (!id.includes(':')) {
    const legacyId = normalizeLegacyId(id);
    if (legacyId !== id && (await fileExists(getProjectMetaPath(username, legacyId)))) {
      return legacyId;
    }
  }
  // 兼容回退：扫描 projects 目录
  try {
    const entries = await listDir(getUserProjectsDir(username));
    for (const entry of entries) {
      if (entry === id) continue;
      const metaPath = getProjectMetaPath(username, entry);
      if (!(await fileExists(metaPath))) continue;
      const rawMeta = await readJSON<ProjectMeta>(metaPath);
      if (!rawMeta) continue;
      const meta = normalizeProjectMeta(rawMeta);
      // normalizeProjectMeta 已把 id 字段转换为 ids 数组，直接检查 ids
      if (meta.ids.includes(id)) return entry;
    }
  } catch {
    // projects 目录不存在或不可读，安静失败
  }
  return null;
}

function syncProjectToDb(username: string, meta: ProjectMeta, dirName?: string): void {
  try {
    const primaryId = selectPrimaryId(meta.ids);
    if (!primaryId) return;
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
    // 同步 IDs 到 fingerprints 表（v3）
    const ids = meta.ids ?? (meta.id ? [`legacy:${meta.id}`] : []);
    for (const id of ids) {
      try {
        upsertFingerprint({
          project_id: primaryId,
          key: 'project_id',
          value: id,
          weight: 0,
        });
      } catch {
        // ignore
      }
    }
    // 同步物理目录到 project_dirs 表（v4）
    if (dirName) {
      try {
        upsertProjectDir(primaryId, username, dirName);
      } catch {
        // ignore
      }
    }
  } catch {
    // 数据库可能未初始化（scan 时），静默跳过
  }
}

// 指针导出：路径阅读辅助
export { isPathPrefixOf };

export { findProjectDirName };

// ─── 新模块 re-export ───
export {
  resolveProjectIds,
  normalizeLegacyId,
  normalizeProjectId,
  normalizeProjectMeta,
  parsePrefixedId,
  selectPrimaryId,
  sortIdsByPriority,
  mergeIds,
  normalizeGitRemote,
  ID_PREFIX,
  type IdPrefix,
  type FingerprintDerived,
} from './identity';

export { generateProjectId, computeProjectIds } from './identity-generate';

export {
  findProjectByAnyId,
  findAllProjectsByAnyId,
  findProjectsOnDisk,
  clearLookupCache,
  findUsernameAndDirName,
  getProjectMetaById,
} from './lookup';

export { isTaskAssociatedWithProject, isTaskAssociatedWithProjectId } from './association';

export {
  registerProjectWithIds,
  updateProjectPaths,
  autoRegisterProject,
  syncProjectIdsToDb,
  syncProjectMetaToDb,
} from './register';

export {
  scanForProjects,
  isBlacklisted,
  type ScanResult,
  type ScanProgress,
  type ScanProgressCallback,
} from './scan';

export { mergeProjects, type MergeResult } from './merge';
export { detectAndLinkNestedIn } from './nested-in';

// ─── 虚拟合并模块 ───
export {
  getRelatedProjectIds,
  getProjectDirNames,
  getProjectIdsFromDb,
  getVirtualProjectMeta,
  listVirtualProjectMetas,
  clearVirtualMergeCache,
} from './virtual-merge';
