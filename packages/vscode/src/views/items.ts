import * as vscode from 'vscode';
import { SearchRow } from '../cli/types';
import { t } from '../t';

export type LatticeItemPayload =
  | { kind: 'group'; groupId: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'taskDoc'; taskId: string; doc: 'prd' | 'design' }
  | { kind: 'taskProgressGroup'; taskId: string }
  | { kind: 'taskRefsGroup'; taskId: string }
  | { kind: 'taskSubtasksGroup'; taskId: string }
  | { kind: 'taskProjectsGroup'; taskId: string }
  | { kind: 'checkpoint'; taskId: string; checkpointId: string }
  | { kind: 'progressAll'; taskId: string }
  | { kind: 'refSpecLeaf'; taskId: string; specId: string; title: string; filePath?: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'relation'; relationId: string; projectId: string }
  | { kind: 'spec'; specId: string; filePath: string; scope: string }
  | { kind: 'conflict'; specId: string; filePath: string }
  | { kind: 'searchResult'; row: SearchRow };

export interface LatticeTreeItem extends vscode.TreeItem {
  lattice?: LatticeItemPayload;
}

export interface ItemOptions {
  label: string;
  /** 稳定节点 id（reveal/展开状态依赖；格式为路径式 id，如 `g/active/t/<taskId>`）。 */
  id?: string;
  payload?: LatticeItemPayload;
  contextValue?: string;
  icon?: vscode.ThemeIcon;
  description?: string;
  tooltip?: string | vscode.MarkdownString;
  collapsible?: vscode.TreeItemCollapsibleState;
  command?: vscode.Command;
}

export function makeItem(options: ItemOptions): LatticeTreeItem {
  const item = new vscode.TreeItem(
    options.label,
    options.collapsible ?? vscode.TreeItemCollapsibleState.None,
  ) as LatticeTreeItem;
  if (options.id) item.id = options.id;
  item.lattice = options.payload;
  item.contextValue = options.contextValue;
  if (options.icon) item.iconPath = options.icon;
  if (options.description !== undefined) item.description = options.description;
  if (options.tooltip !== undefined) item.tooltip = options.tooltip;
  if (options.command) item.command = options.command;
  return item;
}

/** 类型标签首字母大写（供 contextValue: searchResultTask 等）。 */
export function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function openFileCommand(filePath: string): vscode.Command {
  return { command: 'vscode.open', arguments: [vscode.Uri.file(filePath)], title: t('Open') };
}

export function tooltipMarkdown(lines: Array<string | undefined>): vscode.MarkdownString {
  const md = new vscode.MarkdownString(
    lines.filter((l): l is string => Boolean(l && l.trim())).join('\n\n'),
  );
  md.supportThemeIcons = true;
  return md;
}

export const TASK_STATUS_ICONS: Record<string, vscode.ThemeIcon> = {
  in_progress: new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green')),
  planning: new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.yellow')),
  completed: new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.blue')),
  archived: new vscode.ThemeIcon('archive'),
};

export function taskStatusIcon(status: string): vscode.ThemeIcon {
  return TASK_STATUS_ICONS[status] ?? TASK_STATUS_ICONS.planning;
}

export const RELATION_TYPE_LABELS: Record<string, string> = {
  'nested-in': t('nested in'),
  'forked-from': t('forked from'),
  'depends-on': t('depends on'),
  'shares-component': t('shares component'),
  related: t('related'),
};

export const CHECKPOINT_TYPE_ICONS: Record<string, string> = {
  decision: '$(git-commit)',
  pivot: '$(sync)',
  milestone: '$(milestone)',
  correction: '$(edit)',
  constraint: '$(lock)',
  context: '$(info)',
  assumption: '$(question)',
  followup: '$(clock)',
  note: '$(note)',
  issue: '$(bug)',
  summary: '$(book)',
};

export function formatDate(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
