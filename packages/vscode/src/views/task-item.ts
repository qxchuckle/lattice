import * as vscode from 'vscode';
import { TaskRow } from '../cli/types';
import { SnapshotStore } from '../state/snapshot';
import { formatDate, makeItem, taskStatusIcon, tooltipMarkdown, LatticeTreeItem } from './items';

/**
 * 任务节点工厂（多视图复用）。
 * mode：'full' = 任务视图（有完整子节点实现，可展开）；'leaf' = 项目/规范视图的跨引用任务
 * （对应 Provider 不实现任务子节点 → 设为叶子并改为「点击打开 PRD」，杜绝「可展开但为空」）。
 */
export function buildTaskItem(
  task: TaskRow,
  snapshot: SnapshotStore,
  activeTaskId: string | undefined,
  options: { mode?: 'full' | 'leaf'; idPrefix?: string } = {},
): LatticeTreeItem {
  const project = task.projects.map((p) => snapshot.findProject(p)).find((p) => p !== undefined);
  const isActive = task.id === activeTaskId;
  const descriptionParts = [project?.name, formatDate(task.updated ?? task.created)].filter(
    Boolean,
  );
  const leaf = options.mode === 'leaf';
  const item = makeItem({
    label: task.title,
    id: options.idPrefix ? `${options.idPrefix}/t:${task.id}` : undefined,
    payload: { kind: 'task', taskId: task.id },
    contextValue: `task-${task.status}`,
    icon: taskStatusIcon(task.status),
    description: descriptionParts.join(' · '),
    collapsible: leaf
      ? vscode.TreeItemCollapsibleState.None
      : vscode.TreeItemCollapsibleState.Collapsed,
    tooltip: tooltipMarkdown([
      `**${task.title}**`,
      `${isActive ? '$(pin) ' : ''}${task.status} · ${task.id}`,
      task.projects.length ? `Projects: ${task.projects.join(', ')}` : undefined,
      task.updated ? `Updated: ${formatDate(task.updated)}` : undefined,
    ]),
    command: leaf
      ? { command: 'lattice.task.openDoc', arguments: [{ taskId: task.id, doc: 'prd' }], title: '' }
      : undefined,
  });
  return item;
}
