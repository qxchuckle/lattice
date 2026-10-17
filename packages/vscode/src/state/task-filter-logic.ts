import { TaskRow } from '../cli/types';

/** 任务过滤状态：状态 × 项目两维（每维度 OR、维度间 AND；空数组 = 该维度不过滤）。 */
export interface TaskFilterState {
  statuses: string[];
  projectIds: string[];
}

export const EMPTY_TASK_FILTER: TaskFilterState = { statuses: [], projectIds: [] };

/** 过滤判定（纯函数）。canonical 用于把项目多 ID 归一到主 ID 再比较。 */
export function taskMatchesFilter(
  task: Pick<TaskRow, 'status' | 'projects'>,
  filter: TaskFilterState,
  canonical: (id: string) => string,
): boolean {
  if (filter.statuses.length > 0 && !filter.statuses.includes(task.status)) return false;
  if (filter.projectIds.length > 0) {
    const wanted = new Set(filter.projectIds.map((id) => canonical(id)));
    if (!task.projects.some((project) => wanted.has(canonical(project)))) return false;
  }
  return true;
}
