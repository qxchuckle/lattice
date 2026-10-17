import * as vscode from 'vscode';
import { SearchRow } from '../cli/types';
import { truncate } from '../cli/parsers';
import { SearchStateService } from '../state/search-state';
import { SnapshotStore } from '../state/snapshot';
import { t } from '../t';
import { LatticeTreeItem, capitalize, makeItem, openFileCommand, tooltipMarkdown } from './items';

const TYPE_ORDER = ['task', 'prd', 'design', 'spec', 'project', 'checkpoint', 'relation'] as const;

const TYPE_LABELS: Record<string, string> = {
  task: t('Tasks'),
  prd: t('PRDs'),
  design: t('Design Docs'),
  spec: t('Specs'),
  project: t('Projects'),
  checkpoint: t('Checkpoints'),
  relation: t('Relations'),
};

const TYPE_ICONS: Record<string, string> = {
  task: 'checklist',
  prd: 'book',
  design: 'lightbulb',
  spec: 'book',
  project: 'project',
  checkpoint: 'milestone',
  relation: 'link',
};

function resultContextValue(type: string): string {
  const normalized = type === 'prd' || type === 'design' ? 'task' : type;
  return `searchResult${capitalize(normalized)}`;
}

function resultCommand(row: SearchRow): vscode.Command | undefined {
  switch (row.type) {
    case 'task':
    case 'prd':
      return {
        command: 'lattice.task.openDoc',
        arguments: [{ taskId: row.taskId, doc: 'prd' }],
        title: '',
      };
    case 'design':
      return {
        command: 'lattice.task.openDoc',
        arguments: [{ taskId: row.taskId, doc: 'design' }],
        title: '',
      };
    case 'spec':
      if (row.filePath) return openFileCommand(row.filePath);
      if (row.specId)
        return { command: 'lattice.spec.openById', arguments: [{ specId: row.specId }], title: '' };
      return undefined;
    case 'project':
      return {
        command: 'lattice.project.open',
        arguments: [{ projectId: row.projectIds[0] }],
        title: '',
      };
    case 'checkpoint':
      return {
        command: 'lattice.task.openCheckpoint',
        arguments: [{ taskId: row.taskId, checkpointId: row.checkpointId }],
        title: '',
      };
    case 'relation':
      return {
        command: 'lattice.project.open',
        arguments: [{ projectId: row.projectIds[0] }],
        title: '',
      };
    default:
      return row.filePath ? openFileCommand(row.filePath) : undefined;
  }
}

/** 搜索视图：QuickPick 结果的持久沉淀，按类型分组。 */
export class SearchProvider implements vscode.TreeDataProvider<LatticeTreeItem> {
  private readonly emitter = new vscode.EventEmitter<LatticeTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly searchState: SearchStateService,
    private readonly snapshot: SnapshotStore,
  ) {
    this.disposables.push(searchState.onDidChange(() => this.refresh()));
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: LatticeTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: LatticeTreeItem): Promise<LatticeTreeItem[]> {
    if (!element) return this.getRootChildren();
    const payload = element.lattice;
    if (payload?.kind === 'group' && payload.groupId.startsWith('search:')) {
      return this.getResultsForType(payload.groupId.slice('search:'.length));
    }
    return [];
  }

  private getRootChildren(): LatticeTreeItem[] {
    const state = this.searchState.current;
    if (state.loading) {
      return [
        makeItem({
          label: t('Searching…'),
          contextValue: 'searchLoading',
          icon: new vscode.ThemeIcon('loading~spin'),
        }),
      ];
    }
    if (state.error) {
      return [
        makeItem({
          label: t('Search failed'),
          description: state.error,
          contextValue: 'searchError',
          icon: new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')),
        }),
      ];
    }
    if (state.query && state.results.length === 0) {
      return [
        makeItem({
          label: t('No results for "{0}"', state.query),
          contextValue: 'searchEmpty',
          icon: new vscode.ThemeIcon('search'),
        }),
      ];
    }
    if (state.results.length === 0) return [];
    const groups = new Map<string, number>();
    for (const row of state.results) {
      const key = TYPE_ORDER.includes(row.type as (typeof TYPE_ORDER)[number]) ? row.type : 'other';
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const items: LatticeTreeItem[] = [];
    for (const type of [...TYPE_ORDER, 'other']) {
      const count = groups.get(type);
      if (!count) continue;
      items.push(
        makeItem({
          label: `${TYPE_LABELS[type] ?? capitalize(type)} (${count})`,
          payload: { kind: 'group', groupId: `search:${type}` },
          contextValue: 'group',
          collapsible: vscode.TreeItemCollapsibleState.Expanded,
        }),
      );
    }
    return items;
  }

  private getResultsForType(type: string): LatticeTreeItem[] {
    const rows = this.searchState.current.results.filter((row) =>
      type === 'other'
        ? !TYPE_ORDER.includes(row.type as (typeof TYPE_ORDER)[number])
        : row.type === type,
    );
    return rows.map((row) => this.buildResultItem(row));
  }

  private buildResultItem(row: SearchRow): LatticeTreeItem {
    const project = row.projectIds.map((id) => this.snapshot.findProject(id)).find(Boolean);
    const descriptionParts = [project?.name, row.weakMatch ? t('weak match') : undefined].filter(
      Boolean,
    );
    const snippet =
      row.snippet && row.snippet !== row.title ? truncate(row.snippet, 80) : undefined;
    return makeItem({
      label: row.title || row.filePath || row.type,
      payload: { kind: 'searchResult', row },
      contextValue: resultContextValue(row.type),
      icon: new vscode.ThemeIcon(TYPE_ICONS[row.type] ?? 'symbol-misc'),
      description: descriptionParts.join(' · '),
      tooltip: tooltipMarkdown([
        `**${row.title}**`,
        `type: ${row.type}${project ? ` · ${project.name}` : ''}`,
        snippet,
        row.filePath,
      ]),
      command: resultCommand(row),
    });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}
