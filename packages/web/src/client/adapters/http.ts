import type {
  LatticeDataAdapter,
  TaskQueryOpts,
  SpecScope,
  SpecResult,
  SearchOpts,
  DashboardStats,
  TaskContextResult,
  UsersResult,
  DoctorOptions,
  ModelStatus,
  TrashItem,
} from './types';
import type {
  ProjectMeta,
  TaskMeta,
  ProjectRelation,
  CheckpointEntry,
  ParsedSpec,
  SearchResult,
  GitStatus,
} from '@qcqx/lattice-core';
import type { DoctorReport, RAGStatus } from '@qcqx/lattice-core';
import { get, post } from '../api/request';

const API_BASE = '/api';

/** 浏览器环境 adapter：通过 fetch 调 Fastify API */
export class HttpAdapter implements LatticeDataAdapter {
  // ── 用户 ──
  getUsers(): Promise<UsersResult> {
    return get<UsersResult>(`${API_BASE}/users`);
  }

  // ── 项目 ──
  getProjects(username?: string): Promise<ProjectMeta[]> {
    const qs = username ? `?username=${encodeURIComponent(username)}` : '';
    return get<ProjectMeta[]>(`${API_BASE}/projects${qs}`);
  }
  getProject(id: string): Promise<ProjectMeta | null> {
    return get<ProjectMeta | null>(`${API_BASE}/projects/${encodeURIComponent(id)}`);
  }
  getProjectGitStatus(id: string): Promise<GitStatus | null> {
    return get<GitStatus | null>(`${API_BASE}/projects/${encodeURIComponent(id)}/git-status`);
  }
  getProjectSpecs(id: string): Promise<ParsedSpec[]> {
    return get<ParsedSpec[]>(`${API_BASE}/projects/${encodeURIComponent(id)}/specs`);
  }
  getProjectTasks(id: string): Promise<TaskMeta[]> {
    return get<TaskMeta[]>(`${API_BASE}/projects/${encodeURIComponent(id)}/tasks`);
  }
  getProjectRelations(id: string): Promise<ProjectRelation[]> {
    return get<ProjectRelation[]>(`${API_BASE}/projects/${encodeURIComponent(id)}/relations`);
  }

  // ── 任务 ──
  getTasks(opts?: TaskQueryOpts): Promise<TaskMeta[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.projectId) params.set('projectId', opts.projectId);
    if (opts?.allUser) params.set('allUser', 'true');
    if (opts?.username) params.set('username', opts.username);
    const qs = params.toString();
    return get<TaskMeta[]>(`${API_BASE}/tasks${qs ? `?${qs}` : ''}`);
  }
  getTask(id: string): Promise<TaskMeta | null> {
    return get<TaskMeta | null>(`${API_BASE}/tasks/${encodeURIComponent(id)}`);
  }
  getTaskProgress(id: string): Promise<CheckpointEntry[]> {
    return get<CheckpointEntry[]>(`${API_BASE}/tasks/${encodeURIComponent(id)}/progress`);
  }
  getTaskTree(id: string): Promise<unknown> {
    return get<unknown>(`${API_BASE}/tasks/${encodeURIComponent(id)}/tree`);
  }
  getTaskLineage(id: string): Promise<unknown> {
    return get<unknown>(`${API_BASE}/tasks/${encodeURIComponent(id)}/lineage`);
  }

  // ── 关系 ──
  getRelations(username?: string): Promise<ProjectRelation[]> {
    const qs = username ? `?username=${encodeURIComponent(username)}` : '';
    return get<ProjectRelation[]>(`${API_BASE}/relations${qs}`);
  }

  // ── 任务语义上下文 ──
  getTaskContext(id: string): Promise<TaskContextResult> {
    return get<TaskContextResult>(`${API_BASE}/tasks/${encodeURIComponent(id)}/context`);
  }

  // ── Spec ──
  getSpecs(scope?: SpecScope, projectId?: string, username?: string): Promise<SpecResult> {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (projectId) params.set('projectId', projectId);
    if (username) params.set('username', username);
    const qs = params.toString();
    return get<SpecResult>(`${API_BASE}/specs${qs ? `?${qs}` : ''}`);
  }

  // ── 搜索 ──
  search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (opts?.type) params.set('type', opts.type);
    if (opts?.projectId) params.set('projectId', opts.projectId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return get<SearchResult[]>(`${API_BASE}/search?${params.toString()}`, { signal: opts?.signal });
  }

  // ── 打开文件/目录 ──
  async openPath(type: string, entityId: string, app: string): Promise<boolean> {
    await post(`${API_BASE}/open`, { type, entityId, app });
    return true;
  }

  // ── 文件内容 ──
  async getContent(type: string, id: string): Promise<string | null> {
    // spec 类型用 POST 避免 URL 过长
    if (type === 'spec') {
      const data = await post<{ content?: string }>(`${API_BASE}/spec/content`, { specId: id });
      return data?.content ?? null;
    }
    const data = await get<{ content?: string }>(
      `${API_BASE}/content/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    );
    return data?.content ?? null;
  }

  // ── 统计 ──
  getStats(): Promise<DashboardStats> {
    return get<DashboardStats>(`${API_BASE}/stats`);
  }

  // ── 管理操作 ──

  // 任务管理
  async updateTaskStatus(id: string, status: string): Promise<boolean> {
    await post(`${API_BASE}/tasks/${encodeURIComponent(id)}/status`, { status });
    return true;
  }

  async archiveTask(id: string): Promise<boolean> {
    await post(`${API_BASE}/tasks/${encodeURIComponent(id)}/archive`);
    return true;
  }

  async deleteTask(id: string): Promise<boolean> {
    await post(`${API_BASE}/tasks/${encodeURIComponent(id)}/delete`);
    return true;
  }

  async addCheckpoint(id: string, type: string, title: string, message: string): Promise<boolean> {
    await post(`${API_BASE}/tasks/${encodeURIComponent(id)}/checkpoint`, {
      type,
      title,
      message,
    });
    return true;
  }

  // RAG
  getRagStatus(): Promise<RAGStatus> {
    return get<RAGStatus>(`${API_BASE}/rag/status`);
  }

  async getModelStatus(): Promise<ModelStatus> {
    return get<ModelStatus>(`${API_BASE}/rag/model/status`);
  }

  async removeModel(): Promise<boolean> {
    await post(`${API_BASE}/rag/model/remove`);
    return true;
  }

  // Doctor
  async runDoctor(options?: DoctorOptions): Promise<DoctorReport> {
    return post<DoctorReport>(`${API_BASE}/doctor/run`, options ?? {});
  }

  // 垃圾桶
  getTrash(type?: string): Promise<TrashItem[]> {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    return get<TrashItem[]>(`${API_BASE}/trash${qs}`);
  }

  async restoreTrash(id: string): Promise<boolean> {
    await post(`${API_BASE}/trash/restore/${encodeURIComponent(id)}`);
    return true;
  }

  async purgeTrash(id: string): Promise<boolean> {
    await post(`${API_BASE}/trash/purge/${encodeURIComponent(id)}`);
    return true;
  }

  async emptyTrash(): Promise<{ count: number }> {
    return post<{ count: number }>(`${API_BASE}/trash/empty`);
  }

  // 配置
  async getConfig(scope: string, diffDefaults?: boolean): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (diffDefaults) params.set('diffDefaults', 'true');
    return get<Record<string, unknown>>(`${API_BASE}/config?${params.toString()}`);
  }

  async setConfig(key: string, value: unknown, scope: string): Promise<boolean> {
    await post(`${API_BASE}/config/set`, { key, value, scope });
    return true;
  }

  async unsetConfig(key: string, scope: string): Promise<boolean> {
    await post(`${API_BASE}/config/unset`, { key, scope });
    return true;
  }

  // 文档保存
  async saveContent(type: string, entityId: string, content: string): Promise<boolean> {
    await post(`${API_BASE}/content/save`, { type, entityId, content });
    return true;
  }

  // 打开已知安全路径（后端校验 isPathSafe）
  async openPathByPath(path: string, app: string): Promise<boolean> {
    await post(`${API_BASE}/open-path`, { path, app });
    return true;
  }

  // ── 鉴权 ──

  async getAuthStatus(): Promise<{ enabled: boolean }> {
    return get<{ enabled: boolean }>(`${API_BASE}/auth/status`);
  }

  async login(password: string, remember: boolean): Promise<{ token: string; expiresIn: number }> {
    return post<{ token: string; expiresIn: number }>(`${API_BASE}/auth/login`, {
      password,
      remember,
    });
  }

  async changePassword(newPassword: string | null): Promise<boolean> {
    await post(`${API_BASE}/auth/password`, { newPassword });
    return true;
  }

  async logout(): Promise<boolean> {
    await post(`${API_BASE}/auth/logout`);
    return true;
  }
}
