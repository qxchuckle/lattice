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
import { TaskGroupService } from '../state/task-group';
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
import { projectIconColor } from './project-icon';
import { buildTaskItem } from './task-item';
import {
  TIME_LEVEL_BY_SEGMENT,
  TIME_LEVEL_SEGMENT,
  buildTimeGroups,
  taskTimeKeys,
  type TimeGroupNode,
} from './task-time-groups';
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
    private readonly taskGroup: TaskGroupService,
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
      taskGroup.onDidChange(() => this.refresh()),
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
        if (this.taskGroup.mode !== 'status' && payload.groupId === 'active') {
          return this.getActiveTimeChildren(base);
        }
        return this.getGroupChildren(payload.groupId, base);
      case 'timeGroup':
        return this.getTimeNodeChildren(base);
      case 'timeUnknown':
        return this.getTimeUnknownChildren(base);
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
    if (this.taskGroup.mode !== 'status') return this.getTimeRootChildren();
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

  /** 时间分组根层：活动任务置顶组（内部同层级）+ 层级树 + 未知时间。 */
  private getTimeRootChildren(): LatticeTreeItem[] {
    const view = this.timeView();
    const items: LatticeTreeItem[] = [];
    if (view.active) {
      items.push(
        makeItem({
          label: `${t('Active Tasks')} (${view.active.tasks.length})`,
          id: 'g/active',
          payload: { kind: 'group', groupId: 'active' },
          contextValue: 'group',
          collapsible: vscode.TreeItemCollapsibleState.Expanded,
        }),
      );
    }
    items.push(...this.timeNodeItems(view.roots, 'g', true));
    if (view.unknown.length > 0) items.push(this.timeUnknownItem('g', view.unknown.length));
    return items;
  }

  // ── 时间分组（基准 × 层级，见 views/task-time-groups.ts） ──

  private timeView(state: ViewSearchState = this.viewSearch.get('tasks')): {
    active?: { tasks: TaskRow[]; roots: TimeGroupNode[]; unknown: TaskRow[] };
    roots: TimeGroupNode[];
    unknown: TaskRow[];
    flat: TaskRow[];
  } {
    const { tasks, canonical } = this.visibleTasks(state);
    const basis = this.taskGroup.basis ?? 'created';
    const levels = this.taskGroup.levels;
    const activeTasks = canonical
      ? tasks.filter(
          (task) =>
            task.status === 'in_progress' &&
            task.projects.some((p) => this.snapshot.canonicalProjectId(p) === canonical),
        )
      : [];
    const activeIds = new Set(activeTasks.map((task) => task.id));
    const rest = buildTimeGroups(
      tasks.filter((task) => !activeIds.has(task.id)),
      basis,
      levels,
    );
    const activeGroups =
      activeTasks.length > 0 ? buildTimeGroups(activeTasks, basis, levels) : undefined;
    return {
      active: activeGroups
        ? { tasks: activeTasks, roots: activeGroups.roots, unknown: activeGroups.unknown }
        : undefined,
      roots: rest.roots,
      unknown: rest.unknown,
      flat: rest.flat,
    };
  }

  /** 一级时间节点 → 组条目；expandFirst 标记「最新路径」为默认展开（首渲染生效）。 */
  private timeNodeItems(
    nodes: TimeGroupNode[],
    base: string,
    expandFirst: boolean,
  ): LatticeTreeItem[] {
    return nodes.map((node, index) =>
      makeItem({
        label: `${node.key} (${node.count})`,
        id: `${base}/tg:${TIME_LEVEL_SEGMENT[node.level]}:${node.key}`,
        payload: { kind: 'timeGroup', level: node.level, key: node.key },
        contextValue: 'group',
        collapsible:
          expandFirst && index === 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
      }),
    );
  }

  private timeUnknownItem(base: string, count: number): LatticeTreeItem {
    return makeItem({
      label: `${t('Unknown Time')} (${count})`,
      id: `${base}/tg:x`,
      payload: { kind: 'timeUnknown' },
      contextValue: 'group',
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
    });
  }

  private timeTaskItems(tasks: TaskRow[], base: string): LatticeTreeItem[] {
    return tasks.map((task) =>
      buildTaskItem(task, this.snapshot, this.activeTask.id, {
        idPrefix: base,
        dateBasis: this.taskGroup.basis ?? 'created',
      }),
    );
  }

  private getActiveTimeChildren(base: string): LatticeTreeItem[] {
    const view = this.timeView();
    if (!view.active) return [];
    const items = this.timeNodeItems(view.active.roots, base, true);
    if (view.active.unknown.length > 0) {
      items.push(this.timeUnknownItem(base, view.active.unknown.length));
    }
    return items;
  }

  private getTimeNodeChildren(base: string): LatticeTreeItem[] {
    const view = this.timeView();
    const segments = base.split('/');
    const isActive = segments[1] === 'active';
    const keys = segments
      .slice(isActive ? 2 : 1)
      .map((seg) => /^tg:[ymd]:(.+)$/.exec(seg)?.[1])
      .filter((key): key is string => Boolean(key));
    let nodes = isActive ? (view.active?.roots ?? []) : view.roots;
    let node: TimeGroupNode | undefined;
    for (const key of keys) {
      node = nodes.find((child) => child.key === key);
      if (!node) return [];
      nodes = node.children;
    }
    if (!node) return [];
    if (node.children.length > 0) return this.timeNodeItems(node.children, base, true);
    return this.timeTaskItems(node.tasks, base);
  }

  private getTimeUnknownChildren(base: string): LatticeTreeItem[] {
    const view = this.timeView();
    const isActive = base.split('/')[1] === 'active';
    const tasks = isActive ? (view.active?.unknown ?? []) : view.unknown;
    return this.timeTaskItems(tasks, base);
  }

  /** 应用「任务范围 → 过滤 → 搜索」后的可见任务集（状态/时间两种分组模式共用上游管线）。 */
  private visibleTasks(state: ViewSearchState): { tasks: TaskRow[]; canonical?: string } {
    const canonical = this.snapshot.canonicalProjectId(this.activeProject.currentProjectId);
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
    return { tasks, canonical };
  }

  private computeGroups(state: ViewSearchState = this.viewSearch.get('tasks')): GroupDef[] {
    const config = getConfig();
    const { tasks, canonical } = this.visibleTasks(state);

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
          icon: new vscode.ThemeIcon(
            'project',
            new vscode.ThemeColor(projectIconColor(project.id)),
          ),
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
    const pushTask = (task: TaskRow): void => {
      if (seen.has(task.id)) return;
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
    };
    if (this.taskGroup.mode === 'status') {
      for (const group of this.computeGroups(state)) {
        for (const task of group.tasks) pushTask(task);
      }
    } else {
      const view = this.timeView(state);
      for (const task of view.active?.tasks ?? []) pushTask(task);
      for (const task of view.flat) pushTask(task);
      for (const task of view.unknown) pushTask(task);
    }
    return rows;
  }

  /** 解析可 reveal 的元素（当前视图内的任务节点；不在范围内返回 null）。 */
  async resolveRevealElement(taskId: string): Promise<LatticeTreeItem | null> {
    await this.snapshot.ensure(['tasks', 'projects', 'user']);
    if (this.taskGroup.mode === 'status') {
      const group = this.computeGroups().find((g) => g.tasks.some((task) => task.id === taskId));
      if (!group) return null;
      return this.itemFromId(`g/${group.id}/t:${taskId}`);
    }
    const view = this.timeView();
    const task = this.snapshot.taskById(taskId);
    if (!task) return null;
    const basis = this.taskGroup.basis ?? 'created';
    const levels = this.taskGroup.levels;
    const segmentPath = (keys: string[]): string =>
      keys.map((key, index) => `/tg:${TIME_LEVEL_SEGMENT[levels[index]]}:${key}`).join('');
    if (view.active?.tasks.some((entry) => entry.id === taskId)) {
      const keys = taskTimeKeys(task, basis, levels);
      return this.itemFromId(
        keys ? `g/active${segmentPath(keys)}/t:${taskId}` : `g/active/tg:x/t:${taskId}`,
      );
    }
    if (view.flat.some((entry) => entry.id === taskId)) {
      const keys = taskTimeKeys(task, basis, levels);
      if (!keys) return null;
      return this.itemFromId(`g${segmentPath(keys)}/t:${taskId}`);
    }
    if (view.unknown.some((entry) => entry.id === taskId)) {
      return this.itemFromId(`g/tg:x/t:${taskId}`);
    }
    return null;
  }

  /** 由路径式 id 重建节点（仅用于 reveal 的父链/目标解析；label 无需与树中一致）。 */
  private itemFromId(id: string): LatticeTreeItem | null {
    const segments = id.split('/');
    if (segments[0] !== 'g' || !segments[1]) return null;
    const parseTimeSegment = (
      seg: string,
    ): { level: 'year' | 'month' | 'day'; key: string } | undefined => {
      const match = /^tg:([ymd]):(.+)$/.exec(seg);
      if (!match) return undefined;
      return { level: TIME_LEVEL_BY_SEGMENT[match[1]], key: match[2] };
    };

    let payload: LatticeItemPayload = { kind: 'group', groupId: segments[1] };
    let label = segments[1];
    let contextValue = 'group';
    let collapsible = vscode.TreeItemCollapsibleState.Collapsed;
    let currentTaskId = '';

    if (segments[1] !== 'active') {
      if (segments[1] === 'tg:x') {
        payload = { kind: 'timeUnknown' };
        label = 'unknown';
      } else {
        const parsed = parseTimeSegment(segments[1]);
        if (parsed) {
          payload = { kind: 'timeGroup', level: parsed.level, key: parsed.key };
          label = parsed.key;
        }
      }
    }

    for (let i = 2; i < segments.length; i += 1) {
      const seg = segments[i].replace(/~\d+$/, '');
      if (seg === 'tg:x') {
        payload = { kind: 'timeUnknown' };
        label = 'unknown';
        contextValue = 'group';
        continue;
      }
      const parsedTime = parseTimeSegment(seg);
      if (parsedTime) {
        payload = { kind: 'timeGroup', level: parsedTime.level, key: parsedTime.key };
        label = parsedTime.key;
        contextValue = 'group';
        continue;
      }
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
