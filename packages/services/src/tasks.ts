/** 任务域：列表 / 详情 / 检查点 / 上下文 / 生命周期写操作。 */
import { resolve as resolvePath } from 'node:path';
import {
  addCheckpoint,
  addSpecRefs,
  archiveTask,
  createTask as coreCreateTask,
  deleteTask as coreDeleteTask,
  getContextForProject,
  getCheckpoint,
  getSmartContext,
  getTaskGraphViews,
  getTaskLineage as coreGetTaskLineage,
  getTaskMeta,
  getTaskPrd,
  listCheckpoints as coreListCheckpoints,
  listTasks as coreListTasks,
  listTasksCrossUser,
  normalizeLocalPath,
  nowISO,
  removeSpecRefs,
  resolveTaskById,
  updateTask,
} from '@qcqx/lattice-core';
import type {
  CheckpointEntry,
  CheckpointType,
  ProjectContext,
  SmartContext,
  TaskMeta,
  TaskStatus,
} from '@qcqx/lattice-core';
import type { TaskDetail } from './shared';
import { findProjectsByPath, resolveProjectId } from './projects';

export interface ListTasksOptions {
  status?: TaskStatus;
  projectId?: string;
  /** 跨用户聚合（多用户协作场景；web /api/tasks?allUsers）。 */
  crossUser?: boolean;
}

export async function listTasks(
  username: string,
  opts: ListTasksOptions = {},
): Promise<TaskMeta[]> {
  if (opts.crossUser && opts.projectId) {
    return listTasksCrossUser(username, opts.projectId, { status: opts.status });
  }
  return coreListTasks(username, { status: opts.status, projectId: opts.projectId });
}

/** 解析任务（支持 ID 前缀）。 */
export async function getTask(username: string, id: string): Promise<TaskMeta | null> {
  return resolveTaskById(username, id);
}

/** 解析任务，找不到时抛错（写操作前置校验）。 */
export async function requireTask(username: string, id: string): Promise<TaskMeta> {
  const meta = await resolveTaskById(username, id);
  if (!meta) throw new Error(`未找到任务: ${id}`);
  return meta;
}

/** 任务详情 bundle：meta + 检查点 + 子树 + 血缘。 */
export async function getTaskDetail(username: string, id: string): Promise<TaskDetail> {
  const match = await resolveTaskById(username, id);
  if (!match) return { task: null, progress: [], tree: null, lineage: [] };
  const [meta, progress, views] = await Promise.all([
    getTaskMeta(username, match.id),
    coreListCheckpoints(username, match.id).catch(() => [] as CheckpointEntry[]),
    getTaskGraphViews(username, match.id).catch(() => null),
  ]);
  return {
    task: meta ?? match,
    progress,
    tree: views?.tree ?? null,
    lineage: views?.lineage ?? [],
  };
}

/** 任务树/血缘原始视图（web /api/tasks/:id/tree|lineage）。 */
export async function getTaskGraph(
  username: string,
  id: string,
): Promise<Awaited<ReturnType<typeof getTaskGraphViews>> | null> {
  return getTaskGraphViews(username, id).catch(() => null);
}

export async function getTaskLineage(
  username: string,
  id: string,
): Promise<Awaited<ReturnType<typeof coreGetTaskLineage>> | null> {
  return coreGetTaskLineage(username, id).catch(() => null);
}

/** 任务基础信息 + PRD 正文（virtual-docs / 上下文复制）。 */
export async function getTaskInfo(
  username: string,
  id: string,
): Promise<{ meta: TaskMeta | null; prd: string }> {
  const meta = await resolveTaskById(username, id);
  if (!meta) return { meta: null, prd: '' };
  const full = (await getTaskMeta(username, meta.id)) ?? meta;
  const prd = (await getTaskPrd(username, meta.id)) ?? '';
  return { meta: full, prd };
}

/** 单条检查点（虚拟文档 lattice://checkpoint/...）。 */
export async function getTaskCheckpoint(
  username: string,
  id: string,
  checkpointId: string,
): Promise<CheckpointEntry | null> {
  const match = await resolveTaskById(username, id);
  if (!match) return null;
  return getCheckpoint(username, match.id, checkpointId);
}

export async function listCheckpoints(
  username: string,
  id: string,
  opts: { last?: number; type?: CheckpointType } = {},
): Promise<CheckpointEntry[]> {
  const match = await resolveTaskById(username, id);
  if (!match) return [];
  return coreListCheckpoints(username, match.id, opts);
}

/** 活跃任务的检查点聚合（web /api/checkpoints/active）。 */
export async function listActiveCheckpoints(
  username: string,
): Promise<Array<{ taskId: string; checkpoints: CheckpointEntry[] }>> {
  const tasks = await coreListTasks(username, { status: 'in_progress' });
  return Promise.all(
    tasks.map(async (task) => ({
      taskId: task.id,
      checkpoints: await coreListCheckpoints(username, task.id).catch(() => []),
    })),
  );
}

/** 任务语义上下文（direct/related/semantic spec + 跨用户聚合）。 */
export async function getTaskContext(
  username: string,
  id: string,
  opts: { crossUser?: boolean } = {},
): Promise<SmartContext> {
  return getSmartContext(username, id, { crossUser: opts.crossUser ?? true });
}

/** 项目上下文（级联 spec + 关联项目 + 活跃任务）。 */
export async function getProjectContextBundle(
  username: string,
  projectId: string,
  opts: { crossUser?: boolean } = {},
): Promise<ProjectContext> {
  return getContextForProject(username, projectId, { crossUser: opts.crossUser ?? true });
}

// ── 写操作 ──

export async function createTask(
  username: string,
  title: string,
  opts: { projects?: string[]; status?: TaskStatus; parentTaskId?: string } = {},
): Promise<TaskMeta> {
  return coreCreateTask(username, title, opts);
}

export async function setTaskStatus(
  username: string,
  id: string,
  action: 'start' | 'complete' | 'archive' | 'reopen',
): Promise<TaskMeta | null> {
  const match = await requireTask(username, id);
  if (action === 'archive') return archiveTask(username, match.id);
  const status: TaskStatus = action === 'complete' ? 'completed' : 'in_progress';
  return updateTask(username, match.id, { status });
}

export async function updateTaskTitle(
  username: string,
  id: string,
  title: string,
): Promise<TaskMeta | null> {
  const match = await requireTask(username, id);
  return updateTask(username, match.id, { title });
}

export async function deleteTask(username: string, id: string): Promise<void> {
  const match = await requireTask(username, id);
  await coreDeleteTask(username, match.id);
}

export async function addTaskCheckpoint(
  username: string,
  id: string,
  opts: { type: string; title: string; message: string },
): Promise<CheckpointEntry> {
  const match = await requireTask(username, id);
  return addCheckpoint(username, match.id, opts);
}

/**
 * 关联项目/路径（union 语义：已有 projects/scopePaths 上追加）。
 * - 路径命中已注册项目 → 加入 projects；否则进 scopePaths。
 */
export async function associateTask(
  username: string,
  id: string,
  opts: { projectId?: string; paths?: string[] } = {},
): Promise<TaskMeta | null> {
  const meta = await requireTask(username, id);
  const projects = new Set(meta.projects ?? []);
  const scopePaths = [...(meta.scopePaths ?? [])];

  if (opts.projectId) {
    const resolved = await resolveProjectId(username, opts.projectId);
    if (resolved) projects.add(resolved);
  }

  for (const rawPath of opts.paths ?? []) {
    const normalized = normalizeLocalPath(resolvePath(rawPath));
    const where = await findProjectsByPath(username, normalized);
    if (where.exact) {
      const exactId = where.exact.id ?? where.exact.ids?.[0];
      if (exactId) projects.add(exactId);
    } else {
      scopePaths.push({ path: normalized, addedAt: nowISO() });
    }
  }

  return updateTask(username, meta.id, { projects: [...projects], scopePaths });
}

export async function addTaskSpecRefs(
  username: string,
  id: string,
  specIds: string[],
  opts: { projectId?: string | null } = {},
): Promise<void> {
  const match = await requireTask(username, id);
  const result = await addSpecRefs(username, match.id, specIds, { projectId: opts.projectId });
  if (result.errors.length > 0) {
    throw new Error(`引用 spec 失败: ${result.errors.join('; ')}`);
  }
}

export async function removeTaskSpecRefs(
  username: string,
  id: string,
  specIds: string[],
): Promise<void> {
  const match = await requireTask(username, id);
  await removeSpecRefs(username, match.id, specIds);
}
