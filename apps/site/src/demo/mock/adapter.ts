import type {
  CheckpointEntry,
  DoctorReport,
  GitStatus,
  ParsedSpec,
  ProjectMeta,
  ProjectRelation,
  RAGStatus,
  TaskMeta,
} from '@qcqx/lattice-core';
import type {
  DashboardStats,
  DomainDataPack,
  LatticeDataAdapter,
  ModelStatus,
  SearchOpts,
  SpecResult,
  SpecScope,
  TaskContextResult,
  TaskQueryOpts,
  TrashItem,
  UsersResult,
} from '@qcqx/lattice-web-ui';
import { NOW, allSpecs, content, progress, projects, relations, specs, tasks } from './data';
import { searchAll } from './search';

const specScope = (spec: ParsedSpec): SpecScope => {
  if (spec.projectId) return 'project';
  return spec.filePath.includes('/users/') ? 'user' : 'global';
};

const gitStatus = (projectId: string): GitStatus => {
  const branch = projectId === 'design-system' ? 'next' : 'main';
  return {
    branch,
    dirty: projectId !== 'design-system',
    uncommittedCount: projectId === 'design-system' ? 0 : 2,
    ahead: projectId === 'acme-portal' ? 3 : 0,
    behind: 0,
    lastCommitMessage:
      projectId === 'acme-api' ? 'feat(api): adopt response envelope' : 'chore: sync demo fixtures',
    lastCommitTime: '2026-10-19T17:42:00.000Z',
  };
};

const trash: TrashItem[] = [];
const deletedTasks = new Map<string, TaskMeta>();
const config = new Map<string, unknown>([
  ['theme', 'dark'],
  ['search.limit', 30],
]);

export class MockAdapter implements LatticeDataAdapter {
  async getUsers(): Promise<UsersResult> {
    return { users: ['demo'], currentUser: 'demo' };
  }

  async getProjects(username?: string): Promise<ProjectMeta[]> {
    return !username || username === 'demo' ? projects : [];
  }

  async getProject(id: string): Promise<ProjectMeta | null> {
    return projects.find((project) => project.ids.includes(id)) ?? null;
  }

  async getProjectGitStatus(id: string): Promise<GitStatus | null> {
    return (await this.getProject(id)) ? gitStatus(id) : null;
  }

  async getProjectSpecs(id: string): Promise<ParsedSpec[]> {
    return specs.project.filter(
      (spec) => spec.projectId === id || spec.filePath.includes(`/projects/${id}/`),
    );
  }

  async getProjectTasks(id: string): Promise<TaskMeta[]> {
    return tasks.filter((task) => (task.projects ?? []).includes(id));
  }

  async getProjectRelations(id: string): Promise<ProjectRelation[]> {
    return relations.filter((relation) => relation.projectA === id || relation.projectB === id);
  }

  async getGlobalStatus() {
    return { home: '/demo', pathSep: '/' };
  }

  async getEntityPath(pathType: string, entityId: string): Promise<string | null> {
    if (pathType === 'task') return `/demo/tasks/${entityId}`;
    if (pathType === 'project') return `/demo/projects/${entityId}`;
    if (pathType === 'spec') return `/demo/specs/${entityId}`;
    return null;
  }

  async getProjectLocalPaths(projectId: string): Promise<string[]> {
    return [`/demo/projects/${projectId}`];
  }

  async getTasks(opts: TaskQueryOpts = {}): Promise<TaskMeta[]> {
    return tasks.filter((task) => {
      if (opts.status && task.status !== opts.status) return false;
      if (opts.projectId && !(task.projects ?? []).includes(opts.projectId)) return false;
      if (opts.username && opts.username !== 'demo') return false;
      return true;
    });
  }

  async getTask(id: string): Promise<TaskMeta | null> {
    return tasks.find((task) => task.id === id) ?? null;
  }

  async getTaskProgress(id: string): Promise<CheckpointEntry[]> {
    return progress[id] ?? [];
  }

  async getTaskTree(id: string): Promise<unknown> {
    const task = tasks.find((item) => item.id === id);
    if (!task) return null;
    return { ...task, nextTasks: [] };
  }

  async getTaskLineage(id: string): Promise<unknown> {
    const task = tasks.find((item) => item.id === id);
    if (!task) return [];
    const lineage: TaskMeta[] = [task];
    let parentId = task.parentTaskId;
    while (parentId) {
      const parent = tasks.find((item) => item.id === parentId);
      if (!parent) break;
      lineage.push(parent);
      parentId = parent.parentTaskId;
    }
    return lineage;
  }

  async getRelations(username?: string): Promise<ProjectRelation[]> {
    return !username || username === 'demo' ? relations : [];
  }

  async getTaskContext(id: string): Promise<TaskContextResult> {
    const task = tasks.find((item) => item.id === id);
    if (!task) return { directSpecs: [], relatedSpecs: [], semanticSpecs: [] };
    const referenced = new Set((task.referencedSpecs ?? []).map((item) => item.id));
    const directSpecs = allSpecs.filter((spec) => referenced.has(spec.frontmatter.id ?? ''));
    const projectIds = new Set(task.projects ?? []);
    const relatedSpecs = allSpecs.filter(
      (spec) =>
        !referenced.has(spec.frontmatter.id ?? '') &&
        specScope(spec) === 'project' &&
        spec.projectId &&
        projectIds.has(spec.projectId),
    );
    const semanticSpecs = allSpecs.filter(
      (spec) => specScope(spec) !== 'project' && !referenced.has(spec.frontmatter.id ?? ''),
    );
    return { directSpecs, relatedSpecs, semanticSpecs };
  }

  async getSpecs(scope?: SpecScope, projectId?: string, username?: string): Promise<SpecResult> {
    if (username && username !== 'demo') return {};
    if (scope) {
      if (scope === 'project') {
        return {
          project: specs.project.filter(
            (spec) =>
              !projectId || spec.projectId === projectId || spec.filePath.includes(projectId),
          ),
        };
      }
      return { [scope]: specs[scope] };
    }
    if (projectId) {
      return {
        project: specs.project.filter(
          (spec) => spec.projectId === projectId || spec.filePath.includes(projectId),
        ),
      };
    }
    return {
      global: specs.global,
      user: specs.user,
      project: specs.project,
    };
  }

  async search(
    query: string,
    opts?: SearchOpts,
  ): Promise<Array<import('@qcqx/lattice-core').SearchResult>> {
    return searchAll(query, opts);
  }

  async getDomainsData(): Promise<DomainDataPack> {
    return { domains: [], degraded: [], specs: [], tasks: [], projects: [] };
  }

  async openPath(): Promise<boolean> {
    return false;
  }

  async openPathByPath(): Promise<boolean> {
    return false;
  }

  async getContent(type: string, id: string): Promise<string | null> {
    return content[`${type}:${id}`] ?? null;
  }

  async getStats(): Promise<DashboardStats> {
    return {
      projectCount: projects.length,
      taskCount: tasks.length,
      activeTaskCount: tasks.filter((task) => task.status === 'in_progress').length,
      relationCount: relations.length,
    };
  }

  async updateTaskStatus(id: string, status: string): Promise<boolean> {
    const task = tasks.find((item) => item.id === id);
    if (!task) return false;
    task.status = status as TaskMeta['status'];
    task.updated = NOW;
    return true;
  }

  async archiveTask(id: string): Promise<boolean> {
    return this.updateTaskStatus(id, 'archived');
  }

  async deleteTask(id: string): Promise<boolean> {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return false;
    const [task] = tasks.splice(index, 1);
    deletedTasks.set(task.id, task);
    trash.push({
      id: `trash-${task.id}`,
      type: 'task',
      title: task.title,
      trashedAt: NOW,
      originalPath: `/demo/tasks/${task.id}`,
      username: 'demo',
      entityId: task.id,
    });
    return true;
  }

  async addCheckpoint(id: string, type: string, title: string, message: string): Promise<boolean> {
    if (!tasks.some((task) => task.id === id)) return false;
    if (!progress[id]) progress[id] = [];
    progress[id].push({
      id: `cp-${Date.now()}`,
      time: new Date().toISOString(),
      type: type as CheckpointEntry['type'],
      title,
      message,
    });
    return true;
  }

  async getRagStatus(): Promise<RAGStatus> {
    return {
      dbPath: '/demo/.cache/rag.sqlite',
      indexedDocuments: allSpecs.length + tasks.length,
      totalEmbeddings: 128,
      vectorStoreReady: true,
      vectorDimension: 384,
      modelInstalled: true,
      modelId: 'all-MiniLM-L6-v2',
      dtype: 'q8',
      pooling: 'mean',
      batchSize: 32,
      minChunkSize: 50,
      distanceThreshold: 1.2,
      ftsIndexVersion: 1,
      expectedFtsVersion: 1,
      remoteHost: null,
      proxy: null,
      lastUpdated: NOW,
      modelChanged: false,
      lastModelId: 'all-MiniLM-L6-v2',
    };
  }

  async getModelStatus(): Promise<ModelStatus> {
    return {
      installed: true,
      loaded: true,
      loadError: null,
      isNetworkError: false,
      networkHint: null,
    };
  }

  async removeModel(): Promise<boolean> {
    return true;
  }

  async runDoctor(): Promise<DoctorReport> {
    return {
      total: 3,
      healthy: 3,
      stale: 0,
      error: 0,
      repaired: 0,
      entries: [
        { item: 'registry', status: 'healthy', message: 'Project registry is writable.' },
        { item: 'specs', status: 'healthy', message: 'All spec frontmatter is valid.' },
        { item: 'index', status: 'healthy', message: 'Search index is current.' },
      ],
    };
  }

  async getTrash(type?: string): Promise<TrashItem[]> {
    return type ? trash.filter((item) => item.type === type) : trash;
  }

  async restoreTrash(id: string): Promise<boolean> {
    const item = trash.find((entry) => entry.id === id);
    if (!item) return false;
    const task = deletedTasks.get(item.entityId);
    if (!task) return false;
    tasks.push(task);
    deletedTasks.delete(item.entityId);
    const index = trash.findIndex((entry) => entry.id === id);
    if (index >= 0) trash.splice(index, 1);
    return true;
  }

  async purgeTrash(id: string): Promise<boolean> {
    const item = trash.find((entry) => entry.id === id);
    if (!item) return false;
    deletedTasks.delete(item.entityId);
    const index = trash.findIndex((entry) => entry.id === id);
    if (index >= 0) trash.splice(index, 1);
    return true;
  }

  async emptyTrash(): Promise<{ count: number }> {
    const count = trash.length;
    trash.length = 0;
    deletedTasks.clear();
    return { count };
  }

  async getConfig(scope: string, diffDefaults?: boolean): Promise<Record<string, unknown>> {
    if (diffDefaults) return Object.fromEntries(config);
    return Object.fromEntries(config);
  }

  async setConfig(key: string, value: unknown): Promise<boolean> {
    config.set(key, value);
    return true;
  }

  async unsetConfig(key: string): Promise<boolean> {
    config.delete(key);
    return true;
  }

  async saveContent(type: string, entityId: string, value: string): Promise<boolean> {
    content[`${type}:${entityId}`] = value;
    if (type === 'spec') {
      const spec = allSpecs.find((item) => item.frontmatter.id === entityId);
      if (spec) spec.content = value;
    }
    return true;
  }

  async getAuthStatus(): Promise<{ enabled: boolean }> {
    return { enabled: false };
  }

  async login(): Promise<{ token: string; expiresIn: number }> {
    return { token: 'demo-token', expiresIn: 3600 };
  }

  async changePassword(): Promise<boolean> {
    return true;
  }

  async logout(): Promise<boolean> {
    return true;
  }
}
