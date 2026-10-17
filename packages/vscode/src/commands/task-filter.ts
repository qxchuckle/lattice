import * as vscode from 'vscode';
import { CommandServices, RegisterFn, extractArgObject, showDeduped } from './shared';
import { TaskFilterState } from '../state/task-filter-logic';
import { t } from '../t';

interface FilterArgs {
  statuses?: string[];
  projectIds?: string[];
}

/** 可选状态（与任务树分组一致）。 */
export const STATUS_FILTERS: Array<{ status: string; label: string }> = [
  { status: 'in_progress', label: t('In Progress') },
  { status: 'planning', label: t('Planning') },
  { status: 'completed', label: t('Completed') },
  { status: 'archived', label: t('Archived') },
];

/** 过滤摘要（视图消息行用）。 */
export function taskFilterSummary(
  filter: TaskFilterState,
  projectName: (id: string) => string | undefined,
): string {
  const parts: string[] = [];
  for (const entry of STATUS_FILTERS) {
    if (filter.statuses.includes(entry.status)) parts.push(entry.label);
  }
  for (const id of filter.projectIds) parts.push(projectName(id) ?? id);
  return parts.join(' · ');
}

/**
 * 任务树过滤：多选状态 / 项目（空选择 = 清除）；程序化参数 `{ statuses?, projectIds? }` 直接设置。
 * 返回最终生效的过滤状态（程序化路径）。
 */
async function setOrPickFilter(
  services: CommandServices,
  arg: unknown,
): Promise<TaskFilterState | undefined> {
  const filter = services.taskFilter;
  if (!filter) return undefined;

  const args = extractArgObject<FilterArgs>(arg);
  if (args && (Array.isArray(args.statuses) || Array.isArray(args.projectIds))) {
    return filter.set({
      statuses: (args.statuses ?? []).filter((item) => typeof item === 'string'),
      projectIds: (args.projectIds ?? []).filter((item) => typeof item === 'string'),
    });
  }

  await services.snapshot.ensure(['tasks', 'projects']);
  const current = filter.current;
  interface FilterItem extends vscode.QuickPickItem {
    kind2?: 'status' | 'project';
    value?: string;
  }
  const items: FilterItem[] = STATUS_FILTERS.map((entry) => ({
    label: `$(tag) ${entry.label}`,
    picked: current.statuses.includes(entry.status),
    kind2: 'status',
    value: entry.status,
  }));
  const projects = [...services.snapshot.data.projects].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id),
  );
  if (projects.length > 0) {
    items.push({ label: t('Projects'), kind: vscode.QuickPickItemKind.Separator });
    for (const project of projects) {
      items.push({
        label: `$(project) ${project.name || project.id}`,
        picked: current.projectIds.includes(project.id),
        kind2: 'project',
        value: project.id,
      });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: t('Filter Tasks'),
    canPickMany: true,
    placeHolder: t('Select statuses / projects to filter (leave empty to clear)'),
  });
  if (!picked) return undefined;

  const statuses = picked
    .filter((item) => item.kind2 === 'status' && item.value)
    .map((item) => item.value as string);
  const projectIds = picked
    .filter((item) => item.kind2 === 'project' && item.value)
    .map((item) => item.value as string);
  const next = await filter.set({ statuses, projectIds });
  void showDeduped(
    'info',
    next.statuses.length + next.projectIds.length > 0
      ? t('Task filter updated.')
      : t('Task filter cleared.'),
  );
  return next;
}

/** 任务树过滤命令（view/title `$(filter)`）。 */
export function registerTaskFilterCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.tasks.filter', (arg) => setOrPickFilter(services, arg));
}
