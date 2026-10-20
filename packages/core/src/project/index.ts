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
import {
  ensureGroupPathInRegistry,
  findGroupByRef,
  readGroupRegistry,
  removeGroupTreeInRegistry,
  resolveGroupPathsSync,
  writeGroupRegistry,
} from './group-registry';
import { collectSubtreeIds, isSubtreePathMatch, normalizeGroupPath } from './group-tree';
import type { GroupNode } from '../types';

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
  opts?: Partial<Pick<ProjectMeta, 'name' | 'description' | 'groupIds' | 'tags'>> & {
    gitRemotes?: string[];
  },
): Promise<ProjectMeta> {
  const detected = await detectProjectInfo(localPath);
  const fingerprint = await collectFingerprint(localPath);
  const now = nowISO();
  const dirName = normalizeLegacyId(id);
  const rawExisting = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
  const existingMeta = rawExisting ? normalizeProjectMeta(rawExisting) : null;
  const name = opts?.name ?? existingMeta?.name ?? detected.name;
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
    groupIds: opts?.groupIds ?? existingMeta?.groupIds,
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
    const target = normalizeGroupPath(filter.group);
    projects = projects.filter((p) => {
      const groups: string[] = p.groups ? JSON.parse(p.groups) : [];
      return groups.some((g) => isSubtreePathMatch(target, g));
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
      groups: (() => {
        const ids = meta.groupIds ?? [];
        if (ids.length === 0) return null;
        const paths = resolveGroupPathsSync(username, ids);
        return paths.length > 0 ? JSON.stringify(paths) : null;
      })(),
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

// ─── 项目分组操作（注册表 + 项目引用编排） ───

export interface ProjectGroupUpdateOptions {
  /** 全量替换（完整路径数组；缺失节点自动创建） */
  set?: string[];
  /** 增量添加（完整路径数组；缺失节点自动创建） */
  add?: string[];
  /** 移除（完整路径或 grp- id） */
  remove?: string[];
}

export interface ProjectGroupUpdateResult {
  meta: ProjectMeta | null;
  /** 本次自动创建的分组节点（调用方负责提示） */
  created: GroupNode[];
  /** 未能解析的移除引用（原样回显） */
  unknownRemovals: string[];
  error?: string;
}

/**
 * 更新项目的分组引用（路径/ID 入口）：
 * - set/add 的路径缺失节点会自动创建（返回 created 供调用方提示）；
 * - remove 接受完整路径或 grp- id，未命中回显 unknownRemovals；
 * - 结果为空时物理删除 groupIds 字段（不残留空数组）。
 */
export async function updateProjectGroups(
  username: string,
  id: string,
  options: ProjectGroupUpdateOptions,
): Promise<ProjectGroupUpdateResult> {
  const registry = await readGroupRegistry(username);
  const created: GroupNode[] = [];
  const unknownRemovals: string[] = [];

  const existing = await getProjectMeta(username, id);
  if (!existing) return { meta: null, created, unknownRemovals, error: `未找到项目：${id}` };

  const nextIds = new Set(existing.groupIds ?? []);
  const applyPaths = (paths: string[], replace: boolean) => {
    if (replace) nextIds.clear();
    for (const path of paths) {
      const ensured = ensureGroupPathInRegistry(registry, path);
      if (ensured.created.length > 0) created.push(...ensured.created);
      if (ensured.node) nextIds.add(ensured.node.id);
    }
  };
  if (options.set) applyPaths(options.set, true);
  if (options.add) applyPaths(options.add, false);
  if (options.remove) {
    for (const ref of options.remove) {
      const node = findGroupByRef(registry, ref);
      if (node) nextIds.delete(node.id);
      else unknownRemovals.push(ref);
    }
  }

  if (created.length > 0) await writeGroupRegistry(username, registry);

  const before = new Set(existing.groupIds ?? []);
  const unchanged =
    before.size === nextIds.size && [...before].every((value) => nextIds.has(value));
  if (unchanged) return { meta: existing, created, unknownRemovals };

  const next = [...nextIds];
  const updated = await updateProjectMeta(username, id, {
    groupIds: next.length > 0 ? next : undefined,
  });
  return { meta: updated, created, unknownRemovals };
}

export interface RemoveProjectGroupTreeResult {
  /** 被删除的节点（含全部后代） */
  removed: GroupNode[];
  /** 被剥离引用的项目主 ID 列表 */
  affectedProjectIds: string[];
  error?: string;
}

/**
 * 删除分组节点及其整棵子树，并从所有引用项目剥离对应 groupIds。
 * 调用方负责确认（建议提示影响的项目/子组数量）。
 */
export async function removeProjectGroupTree(
  username: string,
  groupRef: string,
): Promise<RemoveProjectGroupTreeResult> {
  const registry = await readGroupRegistry(username);
  const node = findGroupByRef(registry, groupRef);
  if (!node) return { removed: [], affectedProjectIds: [], error: `未找到分组：${groupRef}` };

  const removed = removeGroupTreeInRegistry(registry, node.id).removed;
  const removedIds = new Set(removed.map((n) => n.id));
  await writeGroupRegistry(username, registry);

  const affectedProjectIds: string[] = [];
  const metas = await listProjectMetas(username);
  for (const meta of metas) {
    const ids = meta.groupIds ?? [];
    if (!ids.some((groupId) => removedIds.has(groupId))) continue;
    const primaryId = selectPrimaryId(meta.ids) ?? meta.id;
    if (!primaryId) continue;
    const next = ids.filter((groupId) => !removedIds.has(groupId));
    await updateProjectMeta(username, primaryId, {
      groupIds: next.length > 0 ? next : undefined,
    });
    affectedProjectIds.push(primaryId);
  }
  return { removed, affectedProjectIds };
}

/**
 * 列出引用了指定分组（含子树）的项目主 ID。
 * 用于注册表重命名/移动后的影响面提示与 DB 刷新。
 */
export async function listProjectsReferencingGroupSubtree(
  username: string,
  groupId: string,
): Promise<string[]> {
  const registry = await readGroupRegistry(username);
  const ids = collectSubtreeIds(registry.groups, groupId);
  const metas = await listProjectMetas(username);
  const result: string[] = [];
  for (const meta of metas) {
    if ((meta.groupIds ?? []).some((value) => ids.has(value))) {
      const primaryId = selectPrimaryId(meta.ids) ?? meta.id;
      if (primaryId) result.push(primaryId);
    }
  }
  return result;
}

/**
 * 刷新项目 DB 缓存行中的分组解析路径（注册表 rename/move 后调用）。
 * @param projectIds 限定项目主 ID；不传则刷新当前用户全部项目
 * @returns 刷新的项目数
 */
export async function refreshProjectGroupPaths(
  username: string,
  projectIds?: string[],
): Promise<number> {
  const metas = await listProjectMetas(username);
  const filterSet = projectIds && projectIds.length > 0 ? new Set(projectIds) : null;
  let count = 0;
  for (const meta of metas) {
    const primaryId = selectPrimaryId(meta.ids) ?? meta.id;
    if (!primaryId || (filterSet && !filterSet.has(primaryId))) continue;
    const dirName = await findProjectDirName(username, primaryId);
    if (!dirName) continue;
    syncProjectToDb(username, meta, dirName);
    count++;
  }
  return count;
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
