import * as vscode from 'vscode';
import { SpecRow } from '../cli/types';
import { truncate } from '../cli/parsers';
import { SnapshotStore } from '../state/snapshot';
import { t } from '../t';
import {
  LatticeItemPayload,
  LatticeTreeItem,
  formatDate,
  makeItem,
  openFileCommand,
  tooltipMarkdown,
} from './items';
import { buildTaskItem } from './task-item';
import { uniqueSuffixId } from './specs-logic';
import { ViewSearchService } from '../state/view-search';
import { isViewSearchActive, matchesViewSearch } from './view-search-logic';

/**
 * 节点 id 约定（路径式，每段一个节点；父 id = 去掉最后一段）：
 *   g/conflicts · g/spec-<scope>          冲突组 · 层级组
 *   <group>/s:<specId>                    spec 节点
 *   <group>/c:<index>                     冲突节点（按快照内序号）
 *   <spec>/t:<taskId>                     引用了该 spec 的任务（叶子）
 */

const SCOPE_LABELS: Record<string, string> = {
  project: t('Project Specs'),
  user: t('User Specs'),
  global: t('Global Specs'),
};

/** 规范视图：冲突组 + 三个层级分组；spec 可展开「引用了它的任务」。 */
export class SpecsProvider implements vscode.TreeDataProvider<LatticeTreeItem> {
  private readonly emitter = new vscode.EventEmitter<LatticeTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly snapshot: SnapshotStore,
    private readonly viewSearch: ViewSearchService,
  ) {
    this.disposables.push(
      snapshot.onDidChange((sections) => {
        if (sections.some((s) => s === 'specs' || s === 'conflicts' || s === 'tasks'))
          this.refresh();
      }),
      viewSearch.onDidChange((target) => {
        if (target === 'specs') this.refresh();
      }),
    );
  }

  /** 应用搜索过滤后的层级 spec 列表（根分组计数与子节点共用）。 */
  private filteredSpecs(scope: 'project' | 'user' | 'global'): SpecRow[] {
    const rows = this.snapshot.data.specs[scope];
    const search = this.viewSearch.get('specs');
    if (!isViewSearchActive(search)) return rows;
    return rows.filter((spec) =>
      matchesViewSearch({
        fields: [spec.title, spec.description, spec.id, spec.filePath, spec.tags.join(' ')],
        ids: [spec.id],
        state: search,
      }),
    );
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: LatticeTreeItem): vscode.TreeItem {
    return element;
  }

  /** reveal 必需：由路径式 id 推导父节点。 */
  getParent(element: LatticeTreeItem): LatticeTreeItem | undefined {
    const id = element.id;
    if (!id) return undefined;
    const idx = id.lastIndexOf('/');
    if (idx <= 0) return undefined;
    return this.itemFromId(id.slice(0, idx)) ?? undefined;
  }

  async getChildren(element?: LatticeTreeItem): Promise<LatticeTreeItem[]> {
    if (!element) return this.getRootChildren();
    const payload = element.lattice;
    if (!payload) return [];
    const base = element.id ?? '';
    if (payload.kind === 'group') return this.getGroupChildren(payload.groupId, base);
    if (payload.kind === 'spec') return this.getSpecChildren(payload.specId, base);
    return [];
  }

  private async getRootChildren(): Promise<LatticeTreeItem[]> {
    await this.snapshot.ensure(['specs', 'conflicts', 'tasks']);
    const items: LatticeTreeItem[] = [];
    const conflicts = this.snapshot.data.conflicts;
    if (conflicts.length > 0) {
      items.push(
        makeItem({
          label: `${t('Conflicts')} (${conflicts.length})`,
          id: 'g/conflicts',
          payload: { kind: 'group', groupId: 'conflicts' },
          contextValue: 'group',
          icon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow')),
          collapsible: vscode.TreeItemCollapsibleState.Expanded,
        }),
      );
    }
    for (const scope of ['project', 'user', 'global'] as const) {
      const rows = this.filteredSpecs(scope);
      if (rows.length > 0) {
        items.push(
          makeItem({
            label: `${SCOPE_LABELS[scope]} (${rows.length})`,
            id: `g/spec-${scope}`,
            payload: { kind: 'group', groupId: `spec-${scope}` },
            contextValue: 'group',
            collapsible: vscode.TreeItemCollapsibleState.Expanded,
          }),
        );
      }
    }
    return items;
  }

  private getGroupChildren(groupId: string, base: string): LatticeTreeItem[] {
    if (groupId === 'conflicts') {
      return this.snapshot.data.conflicts.map((conflict, index) =>
        makeItem({
          label: conflict.fileName,
          id: `${base}/c:${index}`,
          payload: { kind: 'conflict', specId: conflict.specId, filePath: conflict.filePath },
          contextValue: 'conflict',
          icon: new vscode.ThemeIcon('warning'),
          description: conflict.scope,
          tooltip: tooltipMarkdown([
            `**${conflict.fileName}**`,
            `scope: ${conflict.scope}`,
            conflict.specId,
            conflict.filePath,
          ]),
          command: openFileCommand(conflict.filePath),
        }),
      );
    }
    const scope = groupId.replace('spec-', '') as 'project' | 'user' | 'global';
    const seen = new Set<string>();
    return this.filteredSpecs(scope).map((spec) => this.buildSpecItem(spec, base, seen));
  }

  buildSpecItem(spec: SpecRow, base = 'g/spec-' + spec.scope, seen?: Set<string>): LatticeTreeItem {
    const project = spec.projectId ? this.snapshot.findProject(spec.projectId) : undefined;
    const referenced = this.snapshot.tasksReferencingSpec(spec.id);
    const rawId = `${base}/s:${spec.id}`;
    return makeItem({
      label: spec.title || spec.id,
      id: seen ? uniqueSuffixId(rawId, seen) : rawId,
      payload: { kind: 'spec', specId: spec.id, filePath: spec.filePath, scope: spec.scope },
      contextValue: 'spec',
      icon: new vscode.ThemeIcon(
        spec.scope === 'global' ? 'globe' : spec.scope === 'user' ? 'account' : 'book',
      ),
      description: truncate(spec.description ?? '', 60),
      collapsible:
        referenced.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      tooltip: tooltipMarkdown([
        `**${spec.title}**`,
        `id: ${spec.id} · scope: ${spec.scope}${project ? ` (${project.name})` : ''}`,
        spec.tags.length ? `tags: ${spec.tags.join(', ')}` : undefined,
        spec.updated ? `updated: ${formatDate(spec.updated)}` : undefined,
        spec.filePath,
      ]),
      command: openFileCommand(spec.filePath),
    });
  }

  private getSpecChildren(specId: string, base: string): LatticeTreeItem[] {
    return this.snapshot
      .tasksReferencingSpec(specId)
      .map((task) =>
        buildTaskItem(task, this.snapshot, undefined, { mode: 'leaf', idPrefix: base }),
      );
  }

  // ── reveal 支持 ──

  /** 解析可 reveal 的 spec 节点（不在当前视图返回 null）。 */
  async resolveRevealElement(specId: string): Promise<LatticeTreeItem | null> {
    await this.snapshot.ensure(['specs', 'conflicts', 'tasks']);
    const row = this.snapshot.specById(specId);
    if (!row) return null;
    // 搜索过滤期间：被过滤掉的节点不可 reveal（与树内容一致）
    if (
      !this.filteredSpecs(row.scope as 'project' | 'user' | 'global').some((s) => s.id === row.id)
    ) {
      return null;
    }
    return this.itemFromId(`g/spec-${row.scope}/s:${specId}`);
  }

  /** 由路径式 id 重建节点（仅用于 reveal；label 无需与树中一致）。 */
  private itemFromId(id: string): LatticeTreeItem | null {
    const segments = id.split('/');
    if (segments[0] !== 'g' || !segments[1]) return null;
    const groupId = segments[1];
    let payload: LatticeItemPayload = { kind: 'group', groupId };
    let label = groupId;
    let contextValue = 'group';
    let collapsible = vscode.TreeItemCollapsibleState.Collapsed;

    for (let i = 2; i < segments.length; i += 1) {
      const seg = segments[i].replace(/~\d+$/, '');
      if (seg.startsWith('s:')) {
        const specId = seg.slice(2);
        const row = this.snapshot.specById(specId);
        if (!row) return null;
        payload = { kind: 'spec', specId: row.id, filePath: row.filePath, scope: row.scope };
        label = row.title || row.id;
        contextValue = 'spec';
      } else if (seg.startsWith('c:')) {
        const index = Number.parseInt(seg.slice(2), 10);
        const conflict = this.snapshot.data.conflicts[index];
        payload = {
          kind: 'conflict',
          specId: conflict?.specId ?? '',
          filePath: conflict?.filePath ?? '',
        };
        label = conflict?.fileName ?? seg;
        contextValue = 'conflict';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else if (seg.startsWith('t:')) {
        const taskId = seg.slice(2);
        payload = { kind: 'task', taskId };
        label = taskId;
        contextValue = 'task-planning';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else {
        return null;
      }
    }
    return makeItem({ label, id, payload, contextValue, collapsible });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}
