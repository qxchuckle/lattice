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

const API_BASE = '/api';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

/** POST 请求辅助：检查 res.ok，返回 { success } JSON */
async function postJson(
  url: string,
  body?: unknown,
): Promise<{ success?: boolean; [key: string]: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** 浏览器环境 adapter：通过 fetch 调 Fastify API */
export class HttpAdapter implements LatticeDataAdapter {
  // ── 用户 ──
  getUsers(): Promise<UsersResult> {
    return fetchJson<UsersResult>(`${API_BASE}/users`);
  }

  // ── 项目 ──
  getProjects(username?: string): Promise<ProjectMeta[]> {
    const qs = username ? `?username=${encodeURIComponent(username)}` : '';
    return fetchJson<ProjectMeta[]>(`${API_BASE}/projects${qs}`);
  }
  getProject(id: string): Promise<ProjectMeta | null> {
    return fetchJson<ProjectMeta | null>(`${API_BASE}/projects/${encodeURIComponent(id)}`);
  }
  getProjectGitStatus(id: string): Promise<GitStatus | null> {
    return fetchJson<GitStatus | null>(`${API_BASE}/projects/${encodeURIComponent(id)}/git-status`);
  }
  getProjectSpecs(id: string): Promise<ParsedSpec[]> {
    return fetchJson<ParsedSpec[]>(`${API_BASE}/projects/${encodeURIComponent(id)}/specs`);
  }
  getProjectTasks(id: string): Promise<TaskMeta[]> {
    return fetchJson<TaskMeta[]>(`${API_BASE}/projects/${encodeURIComponent(id)}/tasks`);
  }
  getProjectRelations(id: string): Promise<ProjectRelation[]> {
    return fetchJson<ProjectRelation[]>(`${API_BASE}/projects/${encodeURIComponent(id)}/relations`);
  }

  // ── 任务 ──
  getTasks(opts?: TaskQueryOpts): Promise<TaskMeta[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.projectId) params.set('projectId', opts.projectId);
    if (opts?.allUser) params.set('allUser', 'true');
    if (opts?.username) params.set('username', opts.username);
    const qs = params.toString();
    return fetchJson<TaskMeta[]>(`${API_BASE}/tasks${qs ? `?${qs}` : ''}`);
  }
  getTask(id: string): Promise<TaskMeta | null> {
    return fetchJson<TaskMeta | null>(`${API_BASE}/tasks/${encodeURIComponent(id)}`);
  }
  getTaskProgress(id: string): Promise<CheckpointEntry[]> {
    return fetchJson<CheckpointEntry[]>(`${API_BASE}/tasks/${encodeURIComponent(id)}/progress`);
  }
  getTaskTree(id: string): Promise<unknown> {
    return fetchJson<unknown>(`${API_BASE}/tasks/${encodeURIComponent(id)}/tree`);
  }
  getTaskLineage(id: string): Promise<unknown> {
    return fetchJson<unknown>(`${API_BASE}/tasks/${encodeURIComponent(id)}/lineage`);
  }

  // ── 关系 ──
  getRelations(username?: string): Promise<ProjectRelation[]> {
    const qs = username ? `?username=${encodeURIComponent(username)}` : '';
    return fetchJson<ProjectRelation[]>(`${API_BASE}/relations${qs}`);
  }

  // ── 任务语义上下文 ──
  getTaskContext(id: string): Promise<TaskContextResult> {
    return fetchJson<TaskContextResult>(`${API_BASE}/tasks/${encodeURIComponent(id)}/context`);
  }

  // ── Spec ──
  getSpecs(scope?: SpecScope, projectId?: string, username?: string): Promise<SpecResult> {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (projectId) params.set('projectId', projectId);
    if (username) params.set('username', username);
    const qs = params.toString();
    return fetchJson<SpecResult>(`${API_BASE}/specs${qs ? `?${qs}` : ''}`);
  }

  // ── 搜索 ──
  search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (opts?.type) params.set('type', opts.type);
    if (opts?.projectId) params.set('projectId', opts.projectId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return fetchJson<SearchResult[]>(`${API_BASE}/search?${params.toString()}`);
  }

  // ── 打开文件/目录 ──
  async openPath(path: string, app: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/open`, { path, app });
    return json.success === true;
  }

  // ── 文件内容 ──
  async getContent(type: string, id: string): Promise<string | null> {
    const res = await fetchJson<{ content?: string; error?: string }>(
      `${API_BASE}/content/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    );
    // 服务端成功时返回 { content: string }，失败时返回 { error: string, message: string }
    return res.content ?? null;
  }

  // ── 统计 ──
  getStats(): Promise<DashboardStats> {
    return fetchJson<DashboardStats>(`${API_BASE}/stats`);
  }

  // ── 管理操作 ──

  // 任务管理
  async updateTaskStatus(id: string, status: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/tasks/${encodeURIComponent(id)}/status`, { status });
    return json.success === true;
  }

  async archiveTask(id: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/tasks/${encodeURIComponent(id)}/archive`);
    return json.success === true;
  }

  async deleteTask(id: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/tasks/${encodeURIComponent(id)}/delete`);
    return json.success === true;
  }

  async addCheckpoint(id: string, type: string, title: string, message: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/tasks/${encodeURIComponent(id)}/checkpoint`, {
      type,
      title,
      message,
    });
    return json.success === true;
  }

  // RAG
  getRagStatus(): Promise<RAGStatus> {
    return fetchJson<RAGStatus>(`${API_BASE}/rag/status`);
  }

  async getModelStatus(): Promise<ModelStatus> {
    return fetchJson<ModelStatus>(`${API_BASE}/rag/model/status`);
  }

  async removeModel(): Promise<boolean> {
    const json = await postJson(`${API_BASE}/rag/model/remove`);
    return json.success === true;
  }

  // Doctor
  async runDoctor(options?: DoctorOptions): Promise<DoctorReport> {
    const json = await postJson(`${API_BASE}/doctor/run`, options ?? {});
    return json as unknown as DoctorReport;
  }

  // 垃圾桶
  getTrash(type?: string): Promise<TrashItem[]> {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    return fetchJson<TrashItem[]>(`${API_BASE}/trash${qs}`);
  }

  async restoreTrash(id: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/trash/restore/${encodeURIComponent(id)}`);
    return json.success === true;
  }

  async purgeTrash(id: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/trash/purge/${encodeURIComponent(id)}`);
    return json.success === true;
  }

  async emptyTrash(): Promise<{ count: number }> {
    const json = await postJson(`${API_BASE}/trash/empty`);
    return json as unknown as { count: number };
  }

  // 配置
  async getConfig(scope: string, diffDefaults?: boolean): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (diffDefaults) params.set('diffDefaults', 'true');
    return fetchJson<Record<string, unknown>>(`${API_BASE}/config?${params.toString()}`);
  }

  async setConfig(key: string, value: unknown, scope: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/config/set`, { key, value, scope });
    return json.success === true;
  }

  async unsetConfig(key: string, scope: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/config/unset`, { key, scope });
    return json.success === true;
  }

  // 文档保存
  async saveContent(path: string, content: string): Promise<boolean> {
    const json = await postJson(`${API_BASE}/content/save`, { path, content });
    return json.success === true;
  }
}
