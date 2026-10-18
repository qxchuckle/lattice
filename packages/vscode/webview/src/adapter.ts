import type {
  DashboardStats,
  DomainDataPack,
  EditorApp,
  GlobalStatusLite,
  LatticeDataAdapter,
  ModelStatus,
  SearchOpts,
  SpecResult,
  SpecScope,
  TaskContextResult,
  TaskQueryOpts,
  TrashItem,
  UsersResult,
} from '@lattice-web-ui';
import type {
  CheckpointEntry,
  DoctorReport,
  GitStatus,
  ParsedSpec,
  ProjectMeta,
  ProjectRelation,
  RAGStatus,
  SearchResult,
  TaskMeta,
} from '@qcqx/lattice-core';
import { bridgeAction, bridgeRequest } from './host';
import type {
  BridgeActionName,
  BridgeRequestMethod,
  GraphSnapshot,
  ProjectDetailPayload,
  TaskDetailPayload,
} from '@qcqx/lattice-protocol';

type Row = Record<string, unknown>;

/**
 * 传输端口：默认为 webview postMessage 桥；宿主侧冒烟 harness 可注入进程内实现
 * （直接调用 bridge-requests，把同一套映射逻辑跑在 Node + jsdom 下）。
 */
export interface WebviewTransport {
  request<T>(method: BridgeRequestMethod, params?: unknown, timeoutMs?: number): Promise<T>;
  action(name: BridgeActionName, params?: unknown): void;
}

const hostTransport: WebviewTransport = {
  request: (method, params, timeoutMs) => bridgeRequest(method, params, timeoutMs),
  action: (name, params) => bridgeAction(name, params),
};

function stripIdPrefix(id: string): string {
  const idx = id.indexOf(':');
  return idx === -1 ? id : id.slice(idx + 1);
}

/**
 * VSCode Webview 数据 adapter：postMessage 桥 → 扩展宿主 → ltc CLI。
 * 只读 + 少量转发原生命令；不支持的能力显式抛错（对应 UI 在 Webview 壳中不挂载）。
 */
export class WebviewAdapter implements LatticeDataAdapter {
  private readonly transport: WebviewTransport;
  private snapshotCache: GraphSnapshot | null = null;
  private snapshotInflight: Promise<GraphSnapshot> | null = null;
  private taskDetailCache = new Map<string, Promise<TaskDetailPayload>>();
  private projectDetailCache = new Map<string, Promise<ProjectDetailPayload>>();

  constructor(transport: WebviewTransport = hostTransport) {
    this.transport = transport;
  }

  /** 扩展推送 snapshotChanged 时调用。 */
  invalidate(): void {
    this.snapshotCache = null;
    this.snapshotInflight = null;
    this.taskDetailCache.clear();
    this.projectDetailCache.clear();
  }

  private async snapshot(): Promise<GraphSnapshot> {
    if (this.snapshotCache) return this.snapshotCache;
    if (!this.snapshotInflight) {
      this.snapshotInflight = this.transport
        .request<GraphSnapshot>('getSnapshot')
        .then((payload) => {
          this.snapshotCache = payload;
          this.snapshotInflight = null;
          return payload;
        })
        .catch((error) => {
          this.snapshotInflight = null;
          throw error;
        });
    }
    return this.snapshotInflight;
  }

  private canonicalProjectId(
    snapshot: GraphSnapshot,
    anyId: string | undefined,
  ): string | undefined {
    if (!anyId) return undefined;
    const hit = snapshot.projects.find((p) => {
      const projectId = p.id ?? p.ids?.[0];
      return (
        projectId === anyId ||
        (projectId !== undefined && stripIdPrefix(projectId) === stripIdPrefix(anyId))
      );
    });
    return hit?.id ?? hit?.ids?.[0] ?? anyId;
  }

  private taskDetail(id: string): Promise<TaskDetailPayload> {
    const cached = this.taskDetailCache.get(id);
    if (cached) return cached;
    const promise = this.transport.request<TaskDetailPayload>('getTaskDetail', { id }, 45_000);
    this.taskDetailCache.set(id, promise);
    return promise;
  }

  private projectDetail(id: string): Promise<ProjectDetailPayload> {
    const cached = this.projectDetailCache.get(id);
    if (cached) return cached;
    const promise = this.transport.request<ProjectDetailPayload>(
      'getProjectDetail',
      { id },
      45_000,
    );
    this.projectDetailCache.set(id, promise);
    return promise;
  }

  // ── 用户 ──
  async getUsers(): Promise<UsersResult> {
    const snapshot = await this.snapshot();
    return { users: snapshot.username ? [snapshot.username] : [], currentUser: snapshot.username };
  }

  // ── 项目 ──
  async getProjects(): Promise<ProjectMeta[]> {
    return (await this.snapshot()).projects as unknown as ProjectMeta[];
  }

  async getProject(id: string): Promise<ProjectMeta | null> {
    const snapshot = await this.snapshot();
    const hit = snapshot.projects.find((p) => p.id === id) ?? null;
    return hit as unknown as ProjectMeta | null;
  }

  async getProjectGitStatus(projectId: string): Promise<GitStatus | null> {
    try {
      return await this.transport.request<GitStatus | null>(
        'getProjectGitStatus',
        { id: projectId },
        30_000,
      );
    } catch {
      return null;
    }
  }

  async getProjectSpecs(id: string): Promise<ParsedSpec[]> {
    const snapshot = await this.snapshot();
    const canonical = this.canonicalProjectId(snapshot, id);
    return snapshot.specs.filter((s) => s.projectId === canonical) as unknown as ParsedSpec[];
  }

  async getProjectTasks(id: string): Promise<TaskMeta[]> {
    const snapshot = await this.snapshot();
    const canonical = this.canonicalProjectId(snapshot, id);
    return snapshot.tasks.filter((t) =>
      (t.projects ?? []).some((p) => this.canonicalProjectId(snapshot, p) === canonical),
    ) as unknown as TaskMeta[];
  }

  async getProjectRelations(id: string): Promise<ProjectRelation[]> {
    const snapshot = await this.snapshot();
    const canonical = this.canonicalProjectId(snapshot, id);
    return snapshot.relations.filter(
      (r) =>
        this.canonicalProjectId(snapshot, r.projectA) === canonical ||
        this.canonicalProjectId(snapshot, r.projectB) === canonical,
    ) as unknown as ProjectRelation[];
  }

  // ── 宿主环境 / 路径解析 ──

  async getGlobalStatus(): Promise<GlobalStatusLite | null> {
    try {
      return await this.transport.request<GlobalStatusLite>('getGlobalStatus');
    } catch {
      return null;
    }
  }

  /** 执行宿主命令（宿主侧按白名单校验）。 */
  executeCommand(command: string, ...args: unknown[]): void {
    this.transport.action('executeCommand', { command, args });
  }

  /** 侧栏定位（宿主能力）：转发到扩展命令。 */
  async revealInSidebar(kind: 'task' | 'spec' | 'project', id: string): Promise<boolean> {
    this.transport.action('executeCommand', {
      command: 'lattice.revealInSidebar',
      args: [{ kind, id }],
    });
    return true;
  }

  async getEntityPath(pathType: string, entityId: string): Promise<string | null> {
    try {
      const payload = await this.transport.request<{ path: string | null }>('getPath', {
        pathType,
        entityId,
      });
      return payload.path;
    } catch {
      return null;
    }
  }

  async getProjectLocalPaths(projectId: string): Promise<string[]> {
    const snapshot = await this.snapshot();
    const hit = snapshot.projects.find((p) => p.id === projectId) ?? null;
    return hit?.localPaths ?? [];
  }

  // ── 任务 ──
  async getTasks(opts?: TaskQueryOpts): Promise<TaskMeta[]> {
    const snapshot = await this.snapshot();
    let tasks = snapshot.tasks;
    if (opts?.status) tasks = tasks.filter((t) => t.status === opts.status);
    if (opts?.projectId) {
      const canonical = this.canonicalProjectId(snapshot, opts.projectId);
      tasks = tasks.filter((t) =>
        (t.projects ?? []).some((p) => this.canonicalProjectId(snapshot, p) === canonical),
      );
    }
    return tasks as unknown as TaskMeta[];
  }

  async getTask(id: string): Promise<TaskMeta | null> {
    try {
      const detail = await this.taskDetail(id);
      return detail.task as unknown as TaskMeta | null;
    } catch {
      const snapshot = await this.snapshot();
      const hit = snapshot.tasks.find((t) => t.id === id) ?? null;
      return hit as unknown as TaskMeta | null;
    }
  }

  async getTaskProgress(id: string): Promise<CheckpointEntry[]> {
    const detail = await this.taskDetail(id);
    return detail.progress as unknown as CheckpointEntry[];
  }

  async getTaskTree(id: string): Promise<unknown> {
    const detail = await this.taskDetail(id);
    return detail.tree;
  }

  async getTaskLineage(id: string): Promise<unknown> {
    const detail = await this.taskDetail(id);
    return detail.lineage;
  }

  // ── 关系 ──
  async getRelations(): Promise<ProjectRelation[]> {
    return (await this.snapshot()).relations as unknown as ProjectRelation[];
  }

  // ── 任务语义上下文 ──
  async getTaskContext(id: string): Promise<TaskContextResult> {
    try {
      return await this.transport.request<TaskContextResult>('getTaskContext', { id }, 45_000);
    } catch {
      return { directSpecs: [], relatedSpecs: [], semanticSpecs: [] };
    }
  }

  // ── Spec ──
  async getSpecs(scope?: SpecScope, projectId?: string): Promise<SpecResult> {
    const snapshot = await this.snapshot();
    const canonical = this.canonicalProjectId(snapshot, projectId);
    const collect = (target: 'global' | 'user' | 'project') =>
      snapshot.specs
        .filter((s) => s.scope === target)
        .filter((s) =>
          target === 'project' && canonical ? s.projectId === canonical : true,
        ) as unknown as ParsedSpec[];
    const result: SpecResult = {};
    if (!scope || scope === 'global') result.global = collect('global');
    if (!scope || scope === 'user') result.user = collect('user');
    if (!scope || scope === 'project') result.project = collect('project');
    return result;
  }

  // ── 搜索 ──
  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    const rows = await this.transport.request<Row[]>('search', {
      query,
      type: opts?.type,
      limit: opts?.limit,
      projectId: opts?.projectId,
    });
    return rows as unknown as SearchResult[];
  }

  async getDomainsData(): Promise<DomainDataPack> {
    return { domains: [], degraded: [], specs: [], tasks: [], projects: [] };
  }

  // ── 打开文件/目录 ──
  async openPath(type: string, entityId: string, app: EditorApp | string): Promise<boolean> {
    this.transport.action('openPath', { type, entityId, app });
    return true;
  }

  async openPathByPath(path: string, app: string): Promise<boolean> {
    this.transport.action('openPathByPath', { path, app });
    return true;
  }

  // ── 文件内容 ──
  async getContent(type: string, id: string): Promise<string | null> {
    try {
      const payload = await this.transport.request<{ content: string | null }>('getContent', {
        type,
        id,
      });
      return payload.content ?? null;
    } catch {
      return null;
    }
  }

  // ── 统计 ──
  async getStats(): Promise<DashboardStats> {
    const snapshot = await this.snapshot();
    return {
      projectCount: snapshot.projects.length,
      taskCount: snapshot.tasks.length,
      activeTaskCount: snapshot.tasks.filter((t) => t.status === 'in_progress').length,
      relationCount: snapshot.relations.length,
    };
  }

  // ── 管理操作（转发到原生命令，确认/交互由扩展侧提供） ──

  async updateTaskStatus(id: string, status: string): Promise<boolean> {
    const command =
      status === 'completed'
        ? 'lattice.task.complete'
        : status === 'archived'
          ? 'lattice.task.archive'
          : status === 'planning'
            ? 'lattice.task.reopen'
            : 'lattice.task.start';
    this.transport.action('executeCommand', { command, args: [{ taskId: id }] });
    return true;
  }

  async archiveTask(id: string): Promise<boolean> {
    this.transport.action('executeCommand', {
      command: 'lattice.task.archive',
      args: [{ taskId: id }],
    });
    return true;
  }

  async deleteTask(id: string): Promise<boolean> {
    this.transport.action('executeCommand', {
      command: 'lattice.task.delete',
      args: [{ taskId: id }],
    });
    return true;
  }

  async addCheckpoint(
    id: string,
    _type: string,
    _title: string,
    _message: string,
  ): Promise<boolean> {
    this.transport.action('executeCommand', {
      command: 'lattice.task.checkpoint.add',
      args: [{ taskId: id }],
    });
    return true;
  }

  // ── 以下能力在 Webview 中未挂载对应 UI；显式报错防静默失败 ──

  async getRagStatus(): Promise<RAGStatus> {
    throw new Error('RAG admin is not available in the VSCode webview');
  }

  async getModelStatus(): Promise<ModelStatus> {
    throw new Error('Model admin is not available in the VSCode webview');
  }

  async removeModel(): Promise<boolean> {
    throw new Error('Model admin is not available in the VSCode webview');
  }

  async runDoctor(): Promise<DoctorReport> {
    throw new Error('Doctor is not available in the VSCode webview');
  }

  async getTrash(): Promise<TrashItem[]> {
    throw new Error('Trash is not available in the VSCode webview');
  }

  async restoreTrash(): Promise<boolean> {
    throw new Error('Trash is not available in the VSCode webview');
  }

  async purgeTrash(): Promise<boolean> {
    throw new Error('Trash is not available in the VSCode webview');
  }

  async emptyTrash(): Promise<{ count: number }> {
    throw new Error('Trash is not available in the VSCode webview');
  }

  async getConfig(): Promise<Record<string, unknown>> {
    throw new Error('Config admin is not available in the VSCode webview');
  }

  async setConfig(): Promise<boolean> {
    throw new Error('Config admin is not available in the VSCode webview');
  }

  async unsetConfig(): Promise<boolean> {
    throw new Error('Config admin is not available in the VSCode webview');
  }

  async saveContent(): Promise<boolean> {
    throw new Error('Editing is not available in the VSCode webview — open the file in the editor');
  }

  async getAuthStatus(): Promise<{ enabled: boolean }> {
    return { enabled: false };
  }

  async login(): Promise<{ token: string; expiresIn: number }> {
    throw new Error('Auth is not available in the VSCode webview');
  }

  async changePassword(): Promise<boolean> {
    return false;
  }

  async logout(): Promise<boolean> {
    return true;
  }
}
