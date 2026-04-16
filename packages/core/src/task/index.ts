import { randomBytes } from 'node:crypto';
import type { TaskMeta, TaskStatus, TaskTreeNode } from '../types';
import {
  getUserTasksDir,
  getTaskDir,
  getTaskMetaPath,
  getTaskPrdPath,
  readJSON,
  writeJSON,
  writeText,
  ensureDir,
  listDir,
  removeDir,
  toKebabCase,
} from '../paths';
import { linkTaskProject, deleteTaskLinks } from '../db';

interface TaskGraphSnapshot {
  tasks: TaskMeta[];
  tasksById: Map<string, TaskMeta>;
  childrenByParentId: Map<string, TaskMeta[]>;
}

async function readAllTaskMeta(username: string): Promise<TaskMeta[]> {
  const tasksDir = getUserTasksDir(username);
  const entries = await listDir(tasksDir);
  const tasks: TaskMeta[] = [];

  for (const entry of entries) {
    const meta = await readJSON<TaskMeta>(getTaskMetaPath(username, entry));
    if (meta) tasks.push(meta);
  }

  return tasks;
}

function normalizeParentTaskId(parentTaskId?: string): string | undefined {
  const value = parentTaskId?.trim();
  return value ? value : undefined;
}

function buildTaskGraphSnapshot(tasks: TaskMeta[]): TaskGraphSnapshot {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const childrenByParentId = new Map<string, TaskMeta[]>();

  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const siblings = childrenByParentId.get(task.parentTaskId) ?? [];
    siblings.push(task);
    childrenByParentId.set(task.parentTaskId, siblings);
  }

  for (const siblings of childrenByParentId.values()) {
    siblings.sort((a, b) => a.created.localeCompare(b.created));
  }

  return { tasks, tasksById, childrenByParentId };
}

async function getTaskGraphSnapshot(username: string): Promise<TaskGraphSnapshot> {
  const tasks = await readAllTaskMeta(username);
  return buildTaskGraphSnapshot(tasks);
}

async function validateParentTask(
  username: string,
  taskId: string,
  parentTaskId?: string,
): Promise<string | undefined> {
  const normalizedParentTaskId = normalizeParentTaskId(parentTaskId);
  if (!normalizedParentTaskId) return undefined;

  if (normalizedParentTaskId === taskId) {
    throw new Error('任务不能把自己设为父任务');
  }

  const snapshot = await getTaskGraphSnapshot(username);
  const parentTask = snapshot.tasksById.get(normalizedParentTaskId);
  if (!parentTask) {
    throw new Error(`未找到父任务：${normalizedParentTaskId}`);
  }

  const visited = new Set<string>();
  let current: TaskMeta | undefined = parentTask;
  while (current) {
    if (current.id === taskId) {
      throw new Error('不能把任务挂到自己的后代下面');
    }
    if (visited.has(current.id)) break;
    visited.add(current.id);

    if (!current.parentTaskId) break;
    current = snapshot.tasksById.get(current.parentTaskId);
  }

  return normalizedParentTaskId;
}

function buildTaskTreeNode(
  task: TaskMeta,
  childrenByParentId: Map<string, TaskMeta[]>,
  visited: Set<string> = new Set(),
): TaskTreeNode {
  if (visited.has(task.id)) {
    return { ...task, nextTasks: [] };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(task.id);
  const nextTasks = (childrenByParentId.get(task.id) ?? []).map((child) =>
    buildTaskTreeNode(child, childrenByParentId, nextVisited),
  );

  return {
    ...task,
    nextTasks,
  };
}

/** 生成任务 ID：YYYY-MM-DD-<4位随机hex>-<slug> */
export function generateTaskId(title: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const rand = randomBytes(2).toString('hex');
  const slug = toKebabCase(title).slice(0, 40);
  return `${date}-${rand}-${slug}`;
}

/** 创建任务 */
export async function createTask(
  username: string,
  title: string,
  opts?: { projects?: string[]; status?: TaskStatus; parentTaskId?: string },
): Promise<TaskMeta> {
  const id = generateTaskId(title);
  const now = new Date().toISOString();
  const parentTaskId = await validateParentTask(username, id, opts?.parentTaskId);

  const meta: TaskMeta = {
    id,
    title,
    status: opts?.status ?? 'planning',
    projects: opts?.projects,
    parentTaskId,
    created: now,
  };

  const taskDir = getTaskDir(username, id);
  await ensureDir(taskDir);
  await writeJSON(getTaskMetaPath(username, id), meta);
  await writeText(getTaskPrdPath(username, id), `# ${title}\n\n`);

  // 同步到数据库的 task_projects 表
  if (opts?.projects) {
    for (const pid of opts.projects) {
      try {
        linkTaskProject(id, pid);
      } catch {
        // 数据库可能未初始化
      }
    }
  }

  return meta;
}

/** 列出任务（从文件系统读取） */
export async function listTasks(
  username: string,
  filter?: { status?: TaskStatus; projectId?: string },
): Promise<TaskMeta[]> {
  const allTasks = await readAllTaskMeta(username);
  const tasks = allTasks.filter((meta) => {
    if (filter?.status && meta.status !== filter.status) return false;
    if (filter?.projectId && !meta.projects?.includes(filter.projectId)) return false;
    return true;
  });

  // 按创建时间倒序
  tasks.sort((a, b) => b.created.localeCompare(a.created));
  return tasks;
}

/** 获取任务元数据 */
export async function getTaskMeta(username: string, taskId: string): Promise<TaskMeta | null> {
  return readJSON<TaskMeta>(getTaskMetaPath(username, taskId));
}

/** 更新任务 */
export async function updateTask(
  username: string,
  taskId: string,
  updates: Partial<TaskMeta>,
): Promise<TaskMeta | null> {
  const existing = await getTaskMeta(username, taskId);
  if (!existing) return null;

  const parentTaskId = 'parentTaskId' in updates
    ? await validateParentTask(username, taskId, updates.parentTaskId)
    : existing.parentTaskId;

  const updated: TaskMeta = {
    ...existing,
    ...updates,
    parentTaskId,
    id: existing.id,
    created: existing.created,
    updated: new Date().toISOString(),
  };

  await writeJSON(getTaskMetaPath(username, taskId), updated);

  // 更新 task_projects 关联
  if (updates.projects) {
    try {
      deleteTaskLinks(taskId);
      for (const pid of updates.projects) {
        linkTaskProject(taskId, pid);
      }
    } catch {
      // 数据库可能未初始化
    }
  }

  return updated;
}

/** 归档任务 */
export async function archiveTask(username: string, taskId: string): Promise<TaskMeta | null> {
  return updateTask(username, taskId, { status: 'archived' });
}

/** 删除任务 */
export async function deleteTask(username: string, taskId: string): Promise<void> {
  const tasks = await readAllTaskMeta(username);
  const childTask = tasks.find((task) => task.parentTaskId === taskId);
  if (childTask) {
    throw new Error(`任务仍有子任务，无法删除：${childTask.id}`);
  }

  const taskDir = getTaskDir(username, taskId);
  await removeDir(taskDir);
  try {
    deleteTaskLinks(taskId);
  } catch {
    // 数据库可能未初始化
  }
}

/** 读取任务的 PRD 内容 */
export async function getTaskPrd(username: string, taskId: string): Promise<string | null> {
  const { readText } = await import('../paths');
  return readText(getTaskPrdPath(username, taskId));
}

/** 获取任务的父任务链路（从根到当前任务） */
export async function getTaskLineage(username: string, taskId: string): Promise<TaskMeta[] | null> {
  const snapshot = await getTaskGraphSnapshot(username);
  const task = snapshot.tasksById.get(taskId);
  if (!task) return null;

  const lineage: TaskMeta[] = [];
  const visited = new Set<string>();
  let current: TaskMeta | undefined = task;

  while (current) {
    lineage.unshift(current);
    if (visited.has(current.id)) break;
    visited.add(current.id);

    if (!current.parentTaskId) break;
    current = snapshot.tasksById.get(current.parentTaskId);
  }

  return lineage;
}

/** 获取任务的后代树（当前任务作为根） */
export async function getTaskDescendantTree(
  username: string,
  taskId: string,
): Promise<TaskTreeNode | null> {
  const snapshot = await getTaskGraphSnapshot(username);
  const task = snapshot.tasksById.get(taskId);
  if (!task) return null;

  return buildTaskTreeNode(task, snapshot.childrenByParentId);
}

/** 获取任务所在的整棵树（从根任务开始） */
export async function getTaskContainingTree(
  username: string,
  taskId: string,
): Promise<TaskTreeNode | null> {
  const snapshot = await getTaskGraphSnapshot(username);
  const task = snapshot.tasksById.get(taskId);
  if (!task) return null;

  const visited = new Set<string>();
  let current: TaskMeta = task;
  while (current.parentTaskId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);

    const parent = snapshot.tasksById.get(current.parentTaskId);
    if (!parent) break;
    current = parent;
  }

  return buildTaskTreeNode(current, snapshot.childrenByParentId);
}
