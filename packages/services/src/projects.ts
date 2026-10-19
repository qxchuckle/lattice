/** 项目域：列表 / 详情 / 路径匹配 / 更新。 */
import { resolve as resolvePath } from 'node:path';
import {
  getProjectGitStatus as coreGetProjectGitStatus,
  getProjectMetaPath as coreGetProjectMetaPath,
  getVirtualProjectMeta,
  isPathPrefixOf,
  listProjectMetas,
  listRelations as coreListRelations,
  listTasks as coreListTasks,
  listVirtualProjectMetas,
  normalizeLocalPath,
  resolveProjectById,
  updateProjectMeta,
  findProjectDirName,
} from '@qcqx/lattice-core';
import type { GitStatus, ProjectMeta } from '@qcqx/lattice-core';
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
