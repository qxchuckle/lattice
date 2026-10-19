import * as vscode from 'vscode';
import { CheckpointRow, TaskRow } from '../cli/types';
import { LatticeDataService } from '../data/service';
import { getConfig, getLatticeRoot, onConfigChanged } from '../config';
import { warnLog } from '../logging';
import { ActiveProjectService } from '../state/active-project';
import { ActiveTaskService } from '../state/active-task';
import { ViewFilterService } from '../state/view-filter';
import { taskMatchesFilter } from '../state/task-filter-logic';
import { TasksScopeService } from '../state/tasks-scope';
import { ViewSearchService } from '../state/view-search';
import {
  isViewSearchActive,
  matchesViewSearch,
  viewSearchMatchFlags,
  type ViewSearchPreviewRow,
  type ViewSearchState,
} from './view-search-logic';
import { SnapshotStore } from '../state/snapshot';
import { taskDocPath } from '../util/lattice-files';
import { fileExists } from '../util/paths';
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
import { truncate } from '../cli/parsers';
import { uniqueNodeId } from './node-id';

/**
 * 节点 id 约定（路径式，每段一个节点；父 id = 去掉最后一段）：
 *   g/<groupId>                     分组
 *   <group>/t:<taskId>              分组下的任务
 *   <task>/doc:prd · doc:design     任务文档
 *   <task>/prog · <prog>/cp:<id>    进展组 · 检查点（<prog>/all = 查看全部）
 *   <task>/refs · <refs>/ref:<id>   引用组 · 引用叶子
 *   <task>/subs · <subs>/t:<id>     子任务组 · 子任务
 *   <task>/projects · /p:<id>       关联项目组 · 项目叶子
 */

interface GroupDef {
  id: 'active' | 'in_progress' | 'planning' | 'completed' | 'archived';
  label: string;
  tasks: TaskRow[];
}

function sortByUpdated(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) =>
    String(b.updated ?? b.created ?? '').localeCompare(String(a.updated ?? a.created ?? '')),
  );
}

/** 任务视图：状态分组 + 任务文档/进展/引用/子任务/关联项目（design.md §3.2）。 */
export class TasksProvider implements vscode.TreeDataProvider<LatticeTreeItem> {
  private readonly emitter = new vscode.EventEmitter<LatticeTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private progressCache = new Map<string, { rows: CheckpointRow[]; at: number }>();
  private progressInflight = new Map<string, Promise<CheckpointRow[]>>();
  private designCache = new Map<string, boolean>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly data: LatticeDataService,
    private readonly snapshot: SnapshotStore,
    private readonly activeProject: ActiveProjectService,
    private readonly activeTask: ActiveTaskService,
    private readonly viewFilter: ViewFilterService,
    private readonly tasksScope: TasksScopeService,
    private readonly viewSearch: ViewSearchService,
  ) {
    this.disposables.push(
      snapshot.onDidChange((sections) => {
        if (sections.some((s) => s === 'tasks' || s === 'projects' || s === 'user')) {
          this.progressCache.clear();
          this.designCache.clear();
          this.refresh();
        }
      }),
      activeProject.onDidChange(() => this.refresh()),
      activeTask.onDidChange(() => this.refresh()),
      viewFilter.onDidChange((target) => {
        if (target === 'tasks') this.refresh();
      }),
      tasksScope.onDidChange(() => this.refresh()),
      viewSearch.onDidChange((target) => {
        if (target === 'tasks') this.refresh();
      }),
      onConfigChanged((event) => {
        if (event.affectsConfiguration('lattice.tasks')) this.refresh();
      }),
    );
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: LatticeTreeItem): vscode.TreeItem {
    return element;
  }

  /** reveal 必需：由节点 id 推导父节点（id 为路径式，父 id 即前缀）。 */
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
    switch (payload.kind) {
      case 'group':
        return this.getGroupChildren(payload.groupId, base);
      case 'task':
        return this.getTaskChildren(payload.taskId, base);
      case 'taskProgressGroup':
        return this.getProgressChildren(payload.taskId, base);
      case 'taskRefsGroup':
        return this.getRefsChildren(payload.taskId, base);
      case 'taskSubtasksGroup':
        return this.getSubtasksChildren(payload.taskId, base);
      case 'taskProjectsGroup':
        return this.getProjectsChildren(payload.taskId, base);
      default:
        return [];
    }
  }

  // ── 分组 ──

  private async getRootChildren(): Promise<LatticeTreeItem[]> {
    await this.snapshot.ensure(['tasks', 'projects', 'user']);
    const groups = this.computeGroups();
    return groups.map((group) =>
      makeItem({
        label: `${group.label} (${group.tasks.length})`,
        id: `g/${group.id}`,
        payload: { kind: 'group', groupId: group.id },
        contextValue: 'group',
        collapsible:
          group.id === 'archived' || group.id === 'completed'
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.Expanded,
      }),
    );
  }

  private computeGroups(state: ViewSearchState = this.viewSearch.get('tasks')): GroupDef[] {
    const config = getConfig();
    const activeProjectId = this.activeProject.currentProjectId;
    const canonical = this.snapshot.canonicalProjectId(activeProjectId);
    let tasks = this.snapshot.data.tasks;
    if (this.tasksScope.effective === 'project' && canonical) {
      tasks = tasks.filter((task) =>
        task.projects.some((p) => this.snapshot.canonicalProjectId(p) === canonical),
      );
    }
    if (this.viewFilter.isActive('tasks')) {
      const filter = this.viewFilter.get('tasks');
      const canonicalId = (id: string): string => this.snapshot.canonicalProjectId(id) ?? id;
      tasks = tasks.filter((task) => taskMatchesFilter(task, filter, canonicalId));
    }
    if (isViewSearchActive(state)) {
      tasks = tasks.filter((task) =>
        matchesViewSearch({ fields: [task.title, task.id], ids: [task.id], state }),
      );
    }

    const groups: GroupDef[] = [];
    const pinnedIds = new Set<string>();
    if (canonical) {
      const pinned = tasks.filter(
        (task) =>
          task.status === 'in_progress' &&
          task.projects.some((p) => this.snapshot.canonicalProjectId(p) === canonical),
      );
      if (pinned.length > 0) {
        groups.push({ id: 'active', label: t('Active Tasks'), tasks: sortByUpdated(pinned) });
        for (const task of pinned) pinnedIds.add(task.id);
      }
    }

    const rest = tasks.filter((task) => !pinnedIds.has(task.id));
    const byStatus = (status: string) =>
      sortByUpdated(rest.filter((task) => task.status === status));
    const inProgress = byStatus('in_progress');
    const planning = byStatus('planning');
    const completed = byStatus('completed');
    const archived = config.tasksShowArchived ? byStatus('archived') : [];
    if (inProgress.length > 0)
      groups.push({ id: 'in_progress', label: t('In Progress'), tasks: inProgress });
    if (planning.length > 0) groups.push({ id: 'planning', label: t('Planning'), tasks: planning });
    if (completed.length > 0)
      groups.push({ id: 'completed', label: t('Completed'), tasks: completed });
    if (archived.length > 0) groups.push({ id: 'archived', label: t('Archived'), tasks: archived });
    return groups;
  }

  private getGroupChildren(groupId: string, base: string): LatticeTreeItem[] {
    const group = this.computeGroups().find((g) => g.id === groupId);
    if (!group) return [];
    return group.tasks.map((task) =>
      buildTaskItem(task, this.snapshot, this.activeTask.id, { idPrefix: base }),
    );
  }

  // ── 任务子节点 ──

  private async getTaskChildren(taskId: string, base: string): Promise<LatticeTreeItem[]> {
    const task = this.snapshot.taskById(taskId);
    if (!task) return [];
    const items: LatticeTreeItem[] = [];
    const root = getLatticeRoot();
    const username = this.snapshot.data.username;

    if (username) {
      items.push(
        makeItem({
          label: t('PRD'),
          id: `${base}/doc:prd`,
          payload: { kind: 'taskDoc', taskId, doc: 'prd' },
          contextValue: 'taskDoc',
          icon: new vscode.ThemeIcon('book'),
          command: openFileCommand(taskDocPath(root, username, taskId, 'prd')),
        }),
      );
      if (await this.designExists(taskId, root, username)) {
        items.push(
          makeItem({
            label: t('Design Doc'),
            id: `${base}/doc:design`,
            payload: { kind: 'taskDoc', taskId, doc: 'design' },
            contextValue: 'taskDoc',
            icon: new vscode.ThemeIcon('lightbulb'),
            command: openFileCommand(taskDocPath(root, username, taskId, 'design')),
          }),
        );
      }
    }

    const checkpoints = await this.loadProgress(taskId);
    items.push(
      makeItem({
        label: t('Progress'),
        id: `${base}/prog`,
        payload: { kind: 'taskProgressGroup', taskId },
        contextValue: 'taskProgressGroup',
        icon: new vscode.ThemeIcon('history'),
        description: `${checkpoints.length}${checkpoints.length >= 5 ? '+' : ''}`,
        collapsible:
          checkpoints.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        // 无 Checkpoint 时不是「可展开但为空」：点击打开完整进展页（页面内提示为空）
        command:
          checkpoints.length === 0
            ? { command: 'lattice.task.openProgress', arguments: [{ taskId }], title: '' }
            : undefined,
      }),
    );

    if (task.referencedSpecs.length > 0) {
      items.push(
        makeItem({
          label: `${t('Specs')} (${task.referencedSpecs.length})`,
          id: `${base}/refs`,
          payload: { kind: 'taskRefsGroup', taskId },
          contextValue: 'group',
          collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        }),
      );
    }
    const subtasks = this.snapshot.childrenOf(taskId);
    if (subtasks.length > 0) {
      items.push(
        makeItem({
          label: `${t('Subtasks')} (${subtasks.length})`,
          id: `${base}/subs`,
          payload: { kind: 'taskSubtasksGroup', taskId },
          contextValue: 'group',
          collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        }),
      );
    }
    if (task.projects.length > 0) {
      items.push(
        makeItem({
          label: `${t('Projects')} (${task.projects.length})`,
          id: `${base}/projects`,
          payload: { kind: 'taskProjectsGroup', taskId },
          contextValue: 'group',
          collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        }),
      );
    }
    return items;
  }

  private async getProgressChildren(taskId: string, base: string): Promise<LatticeTreeItem[]> {
    const rows = await this.loadProgress(taskId);
    const seen = new Set<string>();
    const items: LatticeTreeItem[] = rows.map((checkpoint) =>
      makeItem({
        label: checkpoint.title ?? checkpoint.id,
        id: uniqueNodeId(`${base}/cp:${checkpoint.id}`, seen),
        payload: { kind: 'checkpoint', taskId, checkpointId: checkpoint.id },
        contextValue: 'checkpoint',
        icon: new vscode.ThemeIcon('milestone'),
        description: [checkpoint.type, formatDate(checkpoint.time)].filter(Boolean).join(' · '),
        tooltip: tooltipMarkdown([
          `**${checkpoint.title ?? checkpoint.id}**`,
          `${checkpoint.type ?? ''} · ${checkpoint.time ?? ''}`,
          checkpoint.message ? truncate(checkpoint.message, 500) : undefined,
        ]),
        command: {
          command: 'lattice.task.openCheckpoint',
          arguments: [{ taskId, checkpointId: checkpoint.id }],
          title: '',
        },
      }),
    );
    if (rows.length >= 5) {
      items.push(
        makeItem({
          label: t('View All…'),
          id: `${base}/all`,
          payload: { kind: 'progressAll', taskId },
          contextValue: 'progressAll',
          icon: new vscode.ThemeIcon('list-unordered'),
          command: { command: 'lattice.task.openProgress', arguments: [{ taskId }], title: '' },
        }),
      );
    }
    return items;
  }

  private getRefsChildren(taskId: string, base: string): LatticeTreeItem[] {
    const task = this.snapshot.taskById(taskId);
    if (!task) return [];
    const seen = new Set<string>();
    return task.referencedSpecs.map((ref) => {
      const spec = this.snapshot.specById(ref.id);
      const title = spec?.title ?? ref.relativePath ?? ref.id ?? '';
      const filePath = spec?.filePath;
      return makeItem({
        label: title,
        id: uniqueNodeId(`${base}/ref:${ref.id ?? ''}`, seen),
        payload: {
          kind: 'refSpecLeaf',
          taskId,
          specId: ref.id ?? '',
          title,
          filePath,
        },
        contextValue: 'taskRefSpecLeaf',
        icon: new vscode.ThemeIcon(
          ref.scope === 'user' || ref.scope === 'global' ? 'globe' : 'book',
        ),
        description: ref.id,
        tooltip: tooltipMarkdown([`**${title}**`, ref.id, filePath]),
        command: filePath
          ? openFileCommand(filePath)
          : { command: 'lattice.spec.openById', arguments: [{ specId: ref.id }], title: '' },
      });
    });
  }

  private getSubtasksChildren(taskId: string, base: string): LatticeTreeItem[] {
    return this.snapshot
      .childrenOf(taskId)
      .map((subtask) =>
        buildTaskItem(subtask, this.snapshot, this.activeTask.id, { idPrefix: base }),
      );
  }

  private getProjectsChildren(taskId: string, base: string): LatticeTreeItem[] {
    const task = this.snapshot.taskById(taskId);
    if (!task) return [];
    const seen = new Set<string>();
    return task.projects
      .map((projectId) => this.snapshot.findProject(projectId))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((project) =>
        makeItem({
          label: project.name || project.id,
          id: uniqueNodeId(`${base}/p:${project.id}`, seen),
          payload: { kind: 'project', projectId: project.id },
          contextValue: 'project',
          icon: new vscode.ThemeIcon('project'),
          description: project.id,
          command: {
            command: 'lattice.project.open',
            arguments: [{ projectId: project.id }],
            title: '',
          },
        }),
      );
  }

  // ── reveal 支持 ──

  /** 实时预览：指定搜索状态下树中可见的任务行（与树同源：scope / 过滤 / 分组去重均一致）。 */
  preview(state: ViewSearchState): ViewSearchPreviewRow[] {
    const seen = new Set<string>();
    const rows: ViewSearchPreviewRow[] = [];
    for (const group of this.computeGroups(state)) {
      for (const task of group.tasks) {
        if (seen.has(task.id)) continue;
        seen.add(task.id);
        const project = task.projects.map((p) => this.snapshot.findProject(p)).find(Boolean);
        const { nameMatched } = viewSearchMatchFlags({
          fields: [task.title, task.id],
          ids: [task.id],
          state,
        });
        rows.push({
          kind: 'task',
          id: task.id,
          label: task.title,
          description: [task.status, project?.name].filter(Boolean).join(' · '),
          contentOnly: !nameMatched,
        });
      }
    }
    return rows;
  }

  /** 解析可 reveal 的元素（当前视图内的任务节点；不在范围内返回 null）。 */
  async resolveRevealElement(taskId: string): Promise<LatticeTreeItem | null> {
    await this.snapshot.ensure(['tasks', 'projects', 'user']);
    const group = this.computeGroups().find((g) => g.tasks.some((task) => task.id === taskId));
    if (!group) return null;
    return this.itemFromId(`g/${group.id}/t:${taskId}`);
  }

  /** 由路径式 id 重建节点（仅用于 reveal 的父链/目标解析；label 无需与树中一致）。 */
  private itemFromId(id: string): LatticeTreeItem | null {
    const segments = id.split('/');
    if (segments[0] !== 'g' || !segments[1]) return null;
    const groupId = segments[1];
    let payload: LatticeItemPayload = { kind: 'group', groupId };
    let label = groupId;
    let contextValue = 'group';
    let collapsible = vscode.TreeItemCollapsibleState.Collapsed;
    let currentTaskId = '';

    for (let i = 2; i < segments.length; i += 1) {
      const seg = segments[i].replace(/~\d+$/, '');
      if (seg.startsWith('t:')) {
        currentTaskId = seg.slice(2);
        payload = { kind: 'task', taskId: currentTaskId };
        label = currentTaskId;
        contextValue = 'task-planning';
      } else if (seg === 'doc:prd' || seg === 'doc:design') {
        payload = {
          kind: 'taskDoc',
          taskId: currentTaskId,
          doc: seg === 'doc:prd' ? 'prd' : 'design',
        };
        label = seg.slice(4);
        contextValue = 'taskDoc';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else if (seg === 'prog') {
        payload = { kind: 'taskProgressGroup', taskId: currentTaskId };
        label = 'progress';
        contextValue = 'taskProgressGroup';
      } else if (seg.startsWith('cp:')) {
        const checkpointId = seg.slice(3);
        payload = { kind: 'checkpoint', taskId: currentTaskId, checkpointId };
        label = checkpointId;
        contextValue = 'checkpoint';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else if (seg === 'all') {
        payload = { kind: 'progressAll', taskId: currentTaskId };
        label = 'all';
        contextValue = 'progressAll';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else if (seg === 'refs') {
        payload = { kind: 'taskRefsGroup', taskId: currentTaskId };
        label = 'refs';
      } else if (seg.startsWith('ref:')) {
        const specId = seg.slice(4);
        payload = {
          kind: 'refSpecLeaf',
          taskId: currentTaskId,
          specId,
          title: this.snapshot.specById(specId)?.title ?? specId,
          filePath: this.snapshot.specById(specId)?.filePath,
        };
        label = specId;
        contextValue = 'taskRefSpecLeaf';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else if (seg === 'subs') {
        payload = { kind: 'taskSubtasksGroup', taskId: currentTaskId };
        label = 'subs';
      } else if (seg === 'projects') {
        payload = { kind: 'taskProjectsGroup', taskId: currentTaskId };
        label = 'projects';
      } else if (seg.startsWith('p:')) {
        const projectId = seg.slice(2);
        payload = { kind: 'project', projectId };
        label = projectId;
        contextValue = 'project';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else {
        return null;
      }
    }
    return makeItem({ label, id, payload, contextValue, collapsible });
  }

  // ── 缓存 ──

  private loadProgress(taskId: string): Promise<CheckpointRow[]> {
    const cached = this.progressCache.get(taskId);
    if (cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.rows);
    const inflight = this.progressInflight.get(taskId);
    if (inflight) return inflight;
    const promise = this.data
      .taskProgress(taskId, { last: 5 })
      .then((rows) => {
        this.progressCache.set(taskId, { rows, at: Date.now() });
        this.progressInflight.delete(taskId);
        return rows;
      })
      .catch((error) => {
        warnLog(`task progress failed for ${taskId}: ${String(error)}`);
        this.progressInflight.delete(taskId);
        return [] as CheckpointRow[];
      });
    this.progressInflight.set(taskId, promise);
    return promise;
  }

  private async designExists(taskId: string, root: string, username: string): Promise<boolean> {
    const cached = this.designCache.get(taskId);
    if (cached !== undefined) return cached;
    const exists = await fileExists(taskDocPath(root, username, taskId, 'design'));
    this.designCache.set(taskId, exists);
    return exists;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}

export type { GroupDef };
export type TaskPayload = Extract<LatticeItemPayload, { kind: 'task' }>;
