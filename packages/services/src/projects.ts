/** 项目域：列表 / 详情 / 路径匹配 / 更新。 */
import { join as joinPath, resolve as resolvePath } from 'node:path';
import {
  autoRegisterProject,
  collectFingerprint,
  computeProjectIds,
  generateProjectId,
  getProjectGitStatus as coreGetProjectGitStatus,
  getProjectMetaPath as coreGetProjectMetaPath,
  getVirtualProjectMeta,
  isPathPrefixOf,
  listProjectMetas,
  listRelations as coreListRelations,
  listTasks as coreListTasks,
  listVirtualProjectMetas,
  normalizeLegacyId,
  normalizeLocalPath,
  readJSON,
  resolveProjectById,
  scanForProjects,
  selectPrimaryId,
  updateProjectMeta,
  findProjectDirName,
  writeJSON,
} from '@qcqx/lattice-core';
import type {
  FingerprintDerived,
  GitStatus,
  ProjectMeta,
  ScanProgress,
  ScanResult,
} from '@qcqx/lattice-core';
import { canonicalKey, idMatches, projectIdSet, type SpecWithScope } from './shared';
import { listSpecs } from './specs';

/**
 * 项目元数据全集：虚拟合并优先（DB），失败回退磁盘扫描。
 * 多宿主共享：CLI/web 有 DB 时获得虚拟合并视图；扩展宿主 DB 不可用时仍能列出磁盘项目。
 */
export async function listProjects(username: string): Promise<ProjectMeta[]> {
  try {
    return await listVirtualProjectMetas(username);
  } catch {
    return listProjectMetas(username);
  }
}

/** 单个项目（虚拟合并 → 磁盘回退）。 */
export async function getProject(username: string, id: string): Promise<ProjectMeta | null> {
  try {
    const meta = await getVirtualProjectMeta(username, id);
    if (meta) return meta;
  } catch {
    // DB 不可用 → 磁盘回退
  }
  const metas = await listProjectMetas(username);
  const target = canonicalKey(id);
  return (
    metas.find(
      (meta) =>
        meta.id === id ||
        (meta.ids ?? []).includes(id) ||
        (meta.ids ?? []).some((candidate) => canonicalKey(candidate) === target),
    ) ?? null
  );
}

/** 解析任意 ID 形态（含前缀）为注册项目 ID；DB 前缀索引优先，失败磁盘回退。 */
export async function resolveProjectId(
  username: string,
  input: string,
): Promise<string | undefined> {
  try {
    const row = resolveProjectById(username, input);
    if (row) return row.id;
  } catch {
    // DB 不可用
  }
  const metas = await listProjectMetas(username);
  const target = canonicalKey(input);
  const hit = metas.find(
    (meta) =>
      meta.id === input ||
      (meta.ids ?? []).includes(input) ||
      (meta.ids ?? []).some((candidate) => canonicalKey(candidate) === target),
  );
  return hit?.id ?? hit?.ids?.[0];
}

/** 按本地路径匹配项目（exact = 归一化完全相等；prefixMatches = 前缀包含）。 */
export interface ProjectPathMatch {
  exact: ProjectMeta | null;
  prefixMatches: ProjectMeta[];
}

export async function findProjectsByPath(username: string, dir: string): Promise<ProjectPathMatch> {
  const normalized = normalizeLocalPath(resolvePath(dir));
  const metas = await listProjects(username);
  const localPathsOf = (meta: ProjectMeta) =>
    (meta.localPaths ?? []).map((path) => normalizeLocalPath(path));
  const exact =
    metas.find((meta) => localPathsOf(meta).some((path) => path === normalized)) ?? null;
  const prefixMatches = metas.filter(
    (meta) => meta !== exact && localPathsOf(meta).some((path) => isPathPrefixOf(path, normalized)),
  );
  return { exact, prefixMatches };
}

/** 项目详情 bundle（specs 带 scope 标注；tasks/relations 按 ID 集合归属过滤）。 */
export interface ProjectDetail {
  project: ProjectMeta | null;
  specs: SpecWithScope[];
  tasks: import('@qcqx/lattice-core').TaskMeta[];
  relations: import('@qcqx/lattice-core').ProjectRelation[];
}

/** 项目 ID 集合（找不到项目时返回 null）。 */
async function projectIdSetFor(username: string, id: string): Promise<Set<string> | null> {
  const project = await getProject(username, id);
  return project ? projectIdSet(project) : null;
}

/** 项目下的任务（按 ID 集合匹配，含去前缀变体）。 */
export async function getProjectTasks(
  username: string,
  id: string,
): Promise<import('@qcqx/lattice-core').TaskMeta[]> {
  const ids = await projectIdSetFor(username, id);
  if (!ids) return [];
  const tasks = await coreListTasks(username);
  return tasks.filter((task) => (task.projects ?? []).some((pid) => idMatches(ids, pid)));
}

/** 项目相关的关系（任一侧命中 ID 集合）。 */
export async function getProjectRelations(
  username: string,
  id: string,
): Promise<import('@qcqx/lattice-core').ProjectRelation[]> {
  const ids = await projectIdSetFor(username, id);
  if (!ids) return [];
  const relations = await coreListRelations(username).catch(() => []);
  return relations.filter(
    (relation) => idMatches(ids, relation.projectA) || idMatches(ids, relation.projectB),
  );
}

/** 项目级 spec（带 scope 标注；找不到项目时回退按 id 解析目录）。 */
export async function getProjectSpecsFor(username: string, id: string): Promise<SpecWithScope[]> {
  const project = await getProject(username, id);
  const projectId = project?.id ?? project?.ids?.[0] ?? id;
  return listSpecs(username, { scope: 'project', projectId });
}

export async function getProjectDetail(username: string, id: string): Promise<ProjectDetail> {
  const project = await getProject(username, id);
  if (!project) {
    return { project: null, specs: [], tasks: [], relations: [] };
  }
  const [specs, tasks, relations] = await Promise.all([
    getProjectSpecsFor(username, id),
    getProjectTasks(username, id),
    getProjectRelations(username, id),
  ]);
  return { project, specs, tasks, relations };
}

/** 项目 git 状态（本地路径不可用时返回 null）。 */
export async function getProjectGitStatus(username: string, id: string): Promise<GitStatus | null> {
  const project = await getProject(username, id);
  if (!project) return null;
  return coreGetProjectGitStatus(project).catch(() => null);
}

/** 更新项目元数据（名称/描述/标签/分组引用）。 */
export async function updateProject(
  username: string,
  id: string,
  updates: Partial<Pick<ProjectMeta, 'name' | 'description' | 'tags' | 'groupIds'>>,
): Promise<ProjectMeta | null> {
  const projectId = (await resolveProjectId(username, id)) ?? id;
  return updateProjectMeta(username, projectId, updates);
}

/** 项目物理目录名（虚拟合并组 → 承载目录；找不到时回退 id 本身，兼容历史数据）。 */
export async function resolveProjectDirName(username: string, id: string): Promise<string | null> {
  try {
    const dirName = await findProjectDirName(username, id);
    if (dirName) return dirName;
  } catch {
    // DB 不可用
  }
  const project = await getProject(username, id);
  return project?.id ?? id;
}

/** 项目元数据文件路径（project.json；目录名经 resolveProjectDirName 安全解析）。 */
export async function getProjectMetaPath(username: string, id: string): Promise<string | null> {
  const dirName = await resolveProjectDirName(username, id);
  if (!dirName) return null;
  return coreGetProjectMetaPath(username, dirName);
}

// ── 扫描 / 单项目注册（VSCode 项目控制台复用） ──

/** 递归扫描目录并注册项目；signal 用于配置面板的取消操作。 */
export async function scanProjects(
  username: string,
  dirs: string[],
  onProgress?: (progress: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<ScanResult> {
  return scanForProjects(username, dirs, onProgress, signal);
}

export interface RegisterProjectOptions {
  /** 注册 Git 根还是当前指定目录（默认 Git 根由宿主解析后传入）。 */
  createAnchor?: boolean;
  name?: string;
  description?: string;
  tags?: string[];
}

export interface RegisterProjectResult {
  projectId: string;
  projectName: string;
  created: boolean;
  anchorPath?: string;
  ids: string[];
}

async function readLegacyIdFromAnchor(dir: string): Promise<string | null> {
  const data = await readJSON<{ id?: string }>(joinPath(dir, 'lattice.json'));
  if (!data?.id || typeof data.id !== 'string') return null;
  return normalizeLegacyId(data.id);
}

/**
 * 注册单个目录（不递归）。
 *
 * - Git 项目：使用 git / remote 指纹；createAnchor=false 时不写任何文件；
 * - 非 Git 目录：必须 createAnchor=true，写入 lattice.json 获得稳定 legacy ID；
 * - 已注册项目：幂等更新 localPaths，不重复创建。
 */
export async function registerProjectAtPath(
  username: string,
  dir: string,
  options: RegisterProjectOptions = {},
): Promise<RegisterProjectResult> {
  const projectPath = resolvePath(dir);
  const { derived } = await collectFingerprint(projectPath);
  // 新 `git init` 的仓库可能既没有 commit 也没有 remote，无法生成 Git 指纹；
  // 这种目录仍可通过 lattice.json 锚点注册。
  const hasGitFingerprint = Boolean(derived.gitFirstCommit) || derived.gitRemotes.length > 0;
  let legacyId = await readLegacyIdFromAnchor(projectPath);
  let anchorPath: string | undefined;

  if (!hasGitFingerprint && !legacyId && !options.createAnchor) {
    throw new Error(
      '该目录没有可用于注册的 Git 指纹（尚无 commit/remote），请创建 lattice.json 后注册',
    );
  }

  if (options.createAnchor && !legacyId) {
    const rawId = generateProjectId(projectPath);
    await writeJSON(joinPath(projectPath, 'lattice.json'), { id: rawId });
    legacyId = normalizeLegacyId(rawId);
    anchorPath = joinPath(projectPath, 'lattice.json');
  }

  const ids = computeProjectIds(derived as FingerprintDerived, legacyId);
  if (ids.length === 0) {
    throw new Error('无法识别项目：目录不是 Git 仓库且没有可用的 lattice.json');
  }

  const { meta, isNew } = await autoRegisterProject(username, ids, projectPath, derived, false);
  if (!meta) throw new Error('项目注册失败');

  const projectId = selectPrimaryId(meta.ids) ?? meta.id ?? ids[0];
  if (options.name || options.description !== undefined || options.tags) {
    await updateProjectMeta(username, projectId, {
      ...(options.name ? { name: options.name } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.tags ? { tags: options.tags } : {}),
    });
  }

  return {
    projectId,
    projectName: options.name ?? meta.name ?? projectId,
    created: isNew,
    ...(anchorPath ? { anchorPath } : {}),
    ids: meta.ids,
  };
}
