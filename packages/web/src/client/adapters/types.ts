import type {
  ProjectMeta,
  TaskMeta,
  ProjectRelation,
  CheckpointEntry,
  ParsedSpec,
  SearchResult,
} from '@qcqx/lattice-core';
import type { GitStatus } from '@qcqx/lattice-core';

/**
 * 数据 adapter 接口 — 前端通过此接口获取数据，不直接调 fetch。
 * 浏览器场景实现 HttpAdapter，未来 VSCode 场景实现 WebviewAdapter。
 */
export interface LatticeDataAdapter {
  // 项目
  getProjects(): Promise<ProjectMeta[]>;
  getProject(id: string): Promise<ProjectMeta | null>;
  getProjectGitStatus(id: string): Promise<GitStatus | null>;
  getProjectSpecs(id: string): Promise<ParsedSpec[]>;
  getProjectTasks(id: string): Promise<TaskMeta[]>;
  getProjectRelations(id: string): Promise<ProjectRelation[]>;

  // 任务
  getTasks(opts?: TaskQueryOpts): Promise<TaskMeta[]>;
  getTask(id: string): Promise<TaskMeta | null>;
  getTaskProgress(id: string): Promise<CheckpointEntry[]>;
  getTaskTree(id: string): Promise<unknown>;
  getTaskLineage(id: string): Promise<unknown>;

  // 关系
  getRelations(): Promise<ProjectRelation[]>;

  // Spec
  getSpecs(scope?: SpecScope, projectId?: string): Promise<SpecResult>;

  // 搜索
  search(query: string, opts?: SearchOpts): Promise<SearchResult[]>;

  // 打开文件/目录
  openPath(path: string, app: EditorApp): Promise<boolean>;

  // 文件内容读取
  getContent(type: string, id: string): Promise<string>;

  // 统计
  getStats(): Promise<DashboardStats>;
}

export interface TaskQueryOpts {
  status?: string;
  projectId?: string;
  allUser?: boolean;
}

export type SpecScope = 'global' | 'user' | 'project';

export interface SpecResult {
  global?: ParsedSpec[];
  user?: ParsedSpec[];
  project?: ParsedSpec[];
}

export interface SearchOpts {
  type?: string;
  projectId?: string;
  limit?: number;
}

export type EditorApp = 'vscode' | 'cursor' | 'qoder' | 'finder';

export interface DashboardStats {
  projectCount: number;
  taskCount: number;
  activeTaskCount: number;
  relationCount: number;
}
