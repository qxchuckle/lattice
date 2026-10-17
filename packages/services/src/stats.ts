/** 统计域：仪表盘统计与全局状态。 */
import { getGlobalStatus as coreGetGlobalStatus } from '@qcqx/lattice-core';
import type { GlobalStatus } from '@qcqx/lattice-core';
import { listProjects } from './projects';
import { listTasks } from './tasks';
import { listRelations } from './relations';

export interface DashboardStats {
  projectCount: number;
  taskCount: number;
  activeTaskCount: number;
  relationCount: number;
}

export async function getStats(username: string): Promise<DashboardStats> {
  const [projects, tasks, relations] = await Promise.all([
    listProjects(username),
    listTasks(username),
    listRelations(username),
  ]);
  return {
    projectCount: projects.length,
    taskCount: tasks.length,
    activeTaskCount: tasks.filter((task) => task.status === 'in_progress').length,
    relationCount: relations.length,
  };
}

/** 全局状态（未初始化或 DB 不可用时返回 null）。 */
export async function getGlobalStatus(): Promise<GlobalStatus | null> {
  try {
    return await coreGetGlobalStatus();
  } catch {
    return null;
  }
}
