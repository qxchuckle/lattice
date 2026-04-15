import { randomBytes } from 'node:crypto';
import type { TaskMeta, TaskStatus } from '../types';
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
  opts?: { projects?: string[]; status?: TaskStatus },
): Promise<TaskMeta> {
  const id = generateTaskId(title);
  const now = new Date().toISOString();

  const meta: TaskMeta = {
    id,
    title,
    status: opts?.status ?? 'planning',
    projects: opts?.projects,
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
  const tasksDir = getUserTasksDir(username);
  const entries = await listDir(tasksDir);
  const tasks: TaskMeta[] = [];

  for (const entry of entries) {
    const meta = await readJSON<TaskMeta>(getTaskMetaPath(username, entry));
    if (!meta) continue;

    if (filter?.status && meta.status !== filter.status) continue;
    if (filter?.projectId && !meta.projects?.includes(filter.projectId)) continue;

    tasks.push(meta);
  }

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

  const updated: TaskMeta = {
    ...existing,
    ...updates,
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
