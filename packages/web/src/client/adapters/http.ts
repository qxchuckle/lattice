import type {
  LatticeDataAdapter,
  TaskQueryOpts,
  SpecScope,
  SpecResult,
  SearchOpts,
  EditorApp,
  DashboardStats,
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

const API_BASE = '/api';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

/** 浏览器环境 adapter：通过 fetch 调 Fastify API */
export class HttpAdapter implements LatticeDataAdapter {
  // ── 项目 ──
  getProjects(): Promise<ProjectMeta[]> {
    return fetchJson<ProjectMeta[]>(`${API_BASE}/projects`);
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
  getRelations(): Promise<ProjectRelation[]> {
    return fetchJson<ProjectRelation[]>(`${API_BASE}/relations`);
  }

  // ── Spec ──
  getSpecs(scope?: SpecScope, projectId?: string): Promise<SpecResult> {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (projectId) params.set('projectId', projectId);
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
  async openPath(path: string, app: EditorApp): Promise<boolean> {
    const params = new URLSearchParams({ path, app });
    const res = await fetch(`${API_BASE}/open?${params.toString()}`);
    const json = (await res.json()) as { success?: boolean };
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
}
