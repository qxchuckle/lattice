import type {
  ProjectMeta,
  TaskMeta,
  ProjectRelation,
  CheckpointEntry,
  ParsedSpec,
  SearchResult,
} from '@qcqx/lattice-core';
import type { GitStatus } from '@qcqx/lattice-core';
import type { DoctorReport, RAGStatus } from '@qcqx/lattice-core';

/**
 * 数据 adapter 接口 — 前端通过此接口获取数据，不直接调 fetch。
 * 浏览器场景实现 HttpAdapter，未来 VSCode 场景实现 WebviewAdapter。
 */
export interface LatticeDataAdapter {
  // 用户
  getUsers(): Promise<UsersResult>;

  // 项目
  getProjects(username?: string): Promise<ProjectMeta[]>;
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
  getRelations(username?: string): Promise<ProjectRelation[]>;

  // 任务语义上下文
  getTaskContext(id: string): Promise<TaskContextResult>;

  // Spec
  getSpecs(scope?: SpecScope, projectId?: string, username?: string): Promise<SpecResult>;

  // 搜索
  search(query: string, opts?: SearchOpts): Promise<SearchResult[]>;

  // 打开文件/目录（通过 type + entityId 解析路径）
  openPath(type: string, entityId: string, app: string): Promise<boolean>;
  // 打开已知安全路径（项目目录等，后端仍会校验 isPathSafe）
  openPathByPath(path: string, app: string): Promise<boolean>;

  // 文件内容读取（成功返回 string，文件不存在返回 null）
  getContent(type: string, id: string): Promise<string | null>;

  // 统计
  getStats(): Promise<DashboardStats>;

  // ── 管理操作 ──

  // 任务管理
  updateTaskStatus(id: string, status: string): Promise<boolean>;
  archiveTask(id: string): Promise<boolean>;
  deleteTask(id: string): Promise<boolean>;
  addCheckpoint(id: string, type: string, title: string, message: string): Promise<boolean>;

  // RAG
  getRagStatus(): Promise<RAGStatus>;
  getModelStatus(): Promise<ModelStatus>;
  removeModel(): Promise<boolean>;

  // Doctor
  runDoctor(options?: DoctorOptions): Promise<DoctorReport>;

  // 垃圾桶
  getTrash(type?: string): Promise<TrashItem[]>;
  restoreTrash(id: string): Promise<boolean>;
  purgeTrash(id: string): Promise<boolean>;
  emptyTrash(): Promise<{ count: number }>;

  // 配置
  getConfig(scope: string, diffDefaults?: boolean): Promise<Record<string, unknown>>;
  setConfig(key: string, value: unknown, scope: string): Promise<boolean>;
  unsetConfig(key: string, scope: string): Promise<boolean>;

  // 文档保存
  saveContent(type: string, entityId: string, content: string): Promise<boolean>;

  // 鉴权
  getAuthStatus(): Promise<{ enabled: boolean }>;
  login(password: string, remember: boolean): Promise<{ token: string; expiresIn: number }>;
  changePassword(oldPassword: string | null, newPassword: string | null): Promise<boolean>;
  logout(): Promise<boolean>;
}

export interface TaskQueryOpts {
  status?: string;
  projectId?: string;
  allUser?: boolean;
  username?: string;
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

export interface TaskContextResult {
  directSpecs: ParsedSpec[];
  relatedSpecs: ParsedSpec[];
  semanticSpecs: ParsedSpec[];
}

export interface UsersResult {
  users: string[];
  currentUser: string;
}

// ── 管理操作相关类型 ──

export interface DoctorOptions {
  fix?: boolean;
  migrate?: boolean;
  rebuildFingerprints?: boolean;
  recheckScopePaths?: boolean;
}

export interface ModelStatus {
  installed: boolean;
  loaded: boolean;
  loadError: string | null;
  isNetworkError: boolean;
  networkHint: string | null;
}

export interface TrashItem {
  id: string;
  type: string;
  title: string;
  trashedAt: string;
  originalPath: string;
  username: string;
  entityId: string;
}
