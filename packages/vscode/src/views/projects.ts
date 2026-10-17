import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { ProjectRow } from '../cli/types';
import { getLatticeRoot } from '../config';
import { ActiveProjectService } from '../state/active-project';
import { SnapshotStore } from '../state/snapshot';
import { projectProfilePath } from '../util/lattice-files';
import { fileExists } from '../util/paths';
import { t } from '../t';
import {
  LatticeItemPayload,
  LatticeTreeItem,
  formatDate,
  makeItem,
  openFileCommand,
  tooltipMarkdown,
  RELATION_TYPE_LABELS,
} from './items';
import { buildTaskItem } from './task-item';
import { ActiveTaskService } from '../state/active-task';
import { ViewSearchService } from '../state/view-search';
import { isViewSearchActive, matchesViewSearch } from './view-search-logic';

/**
 * 节点 id 约定（路径式，每段一个节点；父 id = 去掉最后一段）：
 *   g/project-single:<id> · g/projects-all          根分组
 *   <group>/p:<projectId>                           项目节点
 *   <project>/project-specs:<id> | …-tasks: | …-relations:   项目子分组
 *   <子分组>/s:<specId> · /t:<taskId> · /r:<relationId>      叶子
 */

function tilde(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** 项目视图：当前项目置顶 + 全部项目（规范/任务/关系/画像）。 */
export class ProjectsProvider implements vscode.TreeDataProvider<LatticeTreeItem> {
  private readonly emitter = new vscode.EventEmitter<LatticeTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private disposables: vscode.Disposable[] = [];
  private profileCache = new Map<string, boolean>();

  constructor(
    private readonly snapshot: SnapshotStore,
    private readonly activeProject: ActiveProjectService,
    private readonly activeTask: ActiveTaskService,
    private readonly viewSearch: ViewSearchService,
  ) {
    this.disposables.push(
      snapshot.onDidChange((sections) => {
        if (
          sections.some((s) => s === 'projects' || s === 'tasks' || s === 'specs' || s === 'user')
        ) {
          this.profileCache.clear();
          this.refresh();
        }
      }),
      activeProject.onDidChange(() => this.refresh()),
      viewSearch.onDidChange((target) => {
        if (target === 'projects') this.refresh();
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
    if (payload.kind === 'project') return this.getProjectChildren(payload.projectId, base);
    return [];
  }

  /** 应用搜索过滤后的项目列表（根分组计数与子节点共用；按名称排序）。 */
  private filteredProjects(): ProjectRow[] {
    const rows = [...this.snapshot.data.projects].sort((a, b) =>
      (a.name || a.id).localeCompare(b.name || b.id),
    );
    const search = this.viewSearch.get('projects');
    if (!isViewSearchActive(search)) return rows;
    return rows.filter((project) =>
      matchesViewSearch({
        fields: [
          project.name,
          project.description,
          project.id,
          project.packageNames.join(' '),
          project.localPaths.join(' '),
        ],
        ids: [project.id],
        state: search,
      }),
    );
  }

  private async getRootChildren(): Promise<LatticeTreeItem[]> {
    await this.snapshot.ensure(['projects', 'tasks', 'specs', 'user']);
    const items: LatticeTreeItem[] = [];
    const currentId = this.activeProject.currentProjectId;
    const current = this.snapshot.findProject(currentId);
    const all = this.filteredProjects();
    if (current && all.some((project) => project.id === current.id)) {
      items.push(
        makeItem({
          label: t('Current Project'),
          id: `g/project-single:${current.id}`,
          payload: { kind: 'group', groupId: `project-single:${current.id}` },
          contextValue: 'group',
          icon: new vscode.ThemeIcon('pin'),
          collapsible: vscode.TreeItemCollapsibleState.Expanded,
        }),
      );
    }
    if (all.length > 0) {
      items.push(
        makeItem({
          label: `${t('All Projects')} (${all.length})`,
          id: 'g/projects-all',
          payload: { kind: 'group', groupId: 'projects-all' },
          contextValue: 'group',
          collapsible: vscode.TreeItemCollapsibleState.Expanded,
        }),
      );
    }
    return items;
  }

  private async getGroupChildren(groupId: string, base: string): Promise<LatticeTreeItem[]> {
    if (groupId.startsWith('project-single:')) {
      const project = this.snapshot.findProject(groupId.slice('project-single:'.length));
      if (!project) return [];
      return [await this.buildProjectItem(project, base)];
    }
    if (groupId === 'projects-all') {
      return Promise.all(
        this.filteredProjects().map((project) => this.buildProjectItem(project, base)),
      );
    }
    if (groupId.startsWith('project-specs:')) {
      const projectId = groupId.slice('project-specs:'.length);
      return this.snapshot.projectSpecs(projectId).map((spec) =>
        makeItem({
          label: spec.title || spec.id,
          id: `${base}/s:${spec.id}`,
          payload: { kind: 'spec', specId: spec.id, filePath: spec.filePath, scope: spec.scope },
          contextValue: 'spec',
          icon: new vscode.ThemeIcon('book'),
          command: openFileCommand(spec.filePath),
        }),
      );
    }
    if (groupId.startsWith('project-tasks:')) {
      const projectId = groupId.slice('project-tasks:'.length);
      return this.snapshot.tasksForProject(projectId).map((task) =>
        buildTaskItem(task, this.snapshot, this.activeTask.id, {
          mode: 'leaf',
          idPrefix: base,
        }),
      );
    }
    if (groupId.startsWith('project-relations:')) {
      const projectId = groupId.slice('project-relations:'.length);
      return this.snapshot.relationsForProject(projectId).map((relation) => {
        const peerId = this.snapshot.relationPeer(relation, projectId);
        const peer = this.snapshot.findProject(peerId);
        return makeItem({
          label: `${RELATION_TYPE_LABELS[relation.type] ?? relation.type} → ${peer?.name ?? peerId}`,
          id: `${base}/r:${relation.id}`,
          payload: { kind: 'relation', relationId: relation.id, projectId },
          contextValue: 'relation',
          icon: new vscode.ThemeIcon('link'),
          tooltip: tooltipMarkdown([
            `**${relation.type}**`,
            relation.description,
            `created by: ${relation.createdBy ?? 'unknown'}${
              relation.createdFromTaskId ? ` (task ${relation.createdFromTaskId})` : ''
            }`,
          ]),
        });
      });
    }
    return [];
  }

  private async buildProjectItem(project: ProjectRow, base: string): Promise<LatticeTreeItem> {
    const specs = this.snapshot.projectSpecs(project.id);
    const tasks = this.snapshot.tasksForProject(project.id);
    const relations = this.snapshot.relationsForProject(project.id);
    const childrenCount = specs.length + tasks.length + relations.length;
    const item = makeItem({
      label: project.name || project.id,
      id: `${base}/p:${project.id}`,
      payload: { kind: 'project', projectId: project.id },
      contextValue: 'project',
      icon: new vscode.ThemeIcon('project'),
      description: project.packageNames[0] ?? tilde(project.localPaths[0]) ?? '',
      collapsible:
        childrenCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      tooltip: tooltipMarkdown([
        `**${project.name || project.id}**`,
        project.id,
        project.description ?? undefined,
        project.localPaths.length
          ? `paths: ${project.localPaths.map((p) => tilde(p)).join(', ')}`
          : undefined,
        project.gitRemotes.length ? `git: ${project.gitRemotes.join(', ')}` : undefined,
        project.created ? `created: ${formatDate(project.created)}` : undefined,
      ]),
    });
    return item;
  }

  private async getProjectChildren(projectId: string, base: string): Promise<LatticeTreeItem[]> {
    const project = this.snapshot.findProject(projectId);
    if (!project) return [];
    const result: LatticeTreeItem[] = [];
    const groups = ['project-specs', 'project-tasks', 'project-relations'].map(
      (prefix) => `${prefix}:${project.id}`,
    );
    for (const groupId of groups) {
      const existing = await this.getGroupChildren(groupId, `${base}/${groupId}`);
      if (existing.length > 0) {
        const label = groupId.startsWith('project-specs')
          ? `${t('Specs')} (${existing.length})`
          : groupId.startsWith('project-tasks')
            ? `${t('Tasks')} (${existing.length})`
            : `${t('Relations')} (${existing.length})`;
        result.push(
          makeItem({
            label,
            id: `${base}/${groupId}`,
            payload: { kind: 'group', groupId },
            contextValue: 'group',
            collapsible: vscode.TreeItemCollapsibleState.Collapsed,
          }),
        );
      }
    }
    if (await this.profileExists(project.id)) {
      const username = this.snapshot.data.username;
      if (username) {
        result.push(
          makeItem({
            label: t('Profile'),
            contextValue: 'profile',
            icon: new vscode.ThemeIcon('account'),
            command: openFileCommand(projectProfilePath(getLatticeRoot(), username, project.id)),
          }),
        );
      }
    }
    return result;
  }

  // ── reveal 支持 ──

  /** 解析可 reveal 的项目节点（优先「当前项目」分组）。 */
  async resolveRevealElement(projectId: string): Promise<LatticeTreeItem | null> {
    await this.snapshot.ensure(['projects', 'tasks', 'specs', 'user']);
    const row = this.snapshot.findProject(projectId);
    if (!row) return null;
    const current = this.snapshot.findProject(this.activeProject.currentProjectId);
    const base = current && current.id === row.id ? `g/project-single:${row.id}` : 'g/projects-all';
    return this.itemFromId(`${base}/p:${row.id}`);
  }

  /** 由路径式 id 重建节点（仅用于 reveal；label 无需与树中一致）。 */
  private itemFromId(id: string): LatticeTreeItem | null {
    const segments = id.split('/');
    if (segments[0] !== 'g' || !segments[1]) return null;
    const rootGroupId = segments[1];
    let payload: LatticeItemPayload = { kind: 'group', groupId: rootGroupId };
    let label = rootGroupId;
    let contextValue = 'group';
    let collapsible = vscode.TreeItemCollapsibleState.Collapsed;
    let currentProjectId = '';

    for (let i = 2; i < segments.length; i += 1) {
      const seg = segments[i].replace(/~\d+$/, '');
      if (seg.startsWith('p:')) {
        currentProjectId = seg.slice(2);
        const row = this.snapshot.findProject(currentProjectId);
        payload = { kind: 'project', projectId: currentProjectId };
        label = row?.name || currentProjectId;
        contextValue = 'project';
      } else if (
        seg.startsWith('project-specs:') ||
        seg.startsWith('project-tasks:') ||
        seg.startsWith('project-relations:')
      ) {
        payload = { kind: 'group', groupId: seg };
        label = seg;
        contextValue = 'group';
      } else if (seg.startsWith('s:')) {
        const specId = seg.slice(2);
        const row = this.snapshot.specById(specId);
        payload = {
          kind: 'spec',
          specId,
          filePath: row?.filePath ?? '',
          scope: row?.scope ?? 'project',
        };
        label = row?.title || specId;
        contextValue = 'spec';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else if (seg.startsWith('t:')) {
        const taskId = seg.slice(2);
        payload = { kind: 'task', taskId };
        label = taskId;
        contextValue = 'task-planning';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else if (seg.startsWith('r:')) {
        const relationId = seg.slice(2);
        payload = { kind: 'relation', relationId, projectId: currentProjectId };
        label = relationId;
        contextValue = 'relation';
        collapsible = vscode.TreeItemCollapsibleState.None;
      } else {
        return null;
      }
    }
    return makeItem({ label, id, payload, contextValue, collapsible });
  }

  private async profileExists(projectId: string): Promise<boolean> {
    const cached = this.profileCache.get(projectId);
    if (cached !== undefined) return cached;
    const username = this.snapshot.data.username;
    if (!username) return false;
    const exists = await fileExists(projectProfilePath(getLatticeRoot(), username, projectId));
    this.profileCache.set(projectId, exists);
    return exists;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}
