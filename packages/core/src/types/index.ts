/** 项目元数据，存储在 ~/.lattice/users/<username>/projects/<id>/project.json */
export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  localPath: string;
  gitRemote?: string;
  groups?: string[];
  tags?: string[];
  created: string;
  updated?: string;
}

/** 任务状态 */
export type TaskStatus = 'planning' | 'in_progress' | 'completed' | 'archived';

/** 任务元数据，存储在 ~/.lattice/users/<username>/tasks/<id>/task.json */
export interface TaskMeta {
  id: string;
  title: string;
  status: TaskStatus;
  projects?: string[];
  parentTaskId?: string;
  created: string;
  updated?: string;
}

/** 任务树节点（运行时计算，不落盘） */
export interface TaskTreeNode {
  id: string;
  title: string;
  status: TaskStatus;
  projects?: string[];
  parentTaskId?: string;
  created: string;
  updated?: string;
  nextTasks: TaskTreeNode[];
}

/** Spec frontmatter 字段 */
export interface SpecFrontmatter {
  title?: string;
  tags?: string[];
  updated?: string;
  [key: string]: unknown;
}

/** 解析后的 Spec 文件 */
export interface ParsedSpec {
  frontmatter: SpecFrontmatter;
  content: string;
  filePath: string;
  fileName: string;
  relativePath: string;
}

/** 全局配置 config.json */
export interface RAGEmbeddingConfig {
  modelId?: string;
  remoteHost?: string;
  remotePathTemplate?: string;
  localModelPath?: string;
  cacheDir?: string;
  allowRemoteModels?: boolean;
  allowLocalModels?: boolean;
  proxy?: string;
}

export interface RAGConfig {
  embedding?: RAGEmbeddingConfig;
}

export interface GlobalConfig {
  version: string;
  registryTemplates?: string[];
  rag?: RAGConfig;
  [key: string]: unknown;
}

/** 本机配置 config-local.json（gitignored） */
export interface LocalConfig {
  username: string;
  scanDirs?: string[];
  gitEnabled?: boolean;
  gitRemote?: string;
  registryTemplates?: string[];
  [key: string]: unknown;
}

export type ResolvedConfig = GlobalConfig & Partial<LocalConfig>;

/** doctor 检查报告 */
export interface DoctorReport {
  total: number;
  healthy: number;
  stale: number;
  error: number;
  repaired: number;
  entries: DoctorEntry[];
}

/** doctor 单项检查结果 */
export interface DoctorEntry {
  item: string;
  status: 'healthy' | 'stale' | 'error' | 'repaired';
  message: string;
  fix?: string;
}

/** Spec 冲突信息 */
export interface SpecConflict {
  fileName: string;
  levels: {
    scope: 'project' | 'user' | 'global';
    filePath: string;
    snippet: string;
  }[];
}

/** 项目上下文（三层 spec 聚合 + 关联信息） */
export interface ProjectContext {
  projectSpecs: ParsedSpec[];
  userSpecs: ParsedSpec[];
  globalSpecs: ParsedSpec[];
  cascadedSpecs: ParsedSpec[];
  activeTasks: TaskMeta[];
  relatedProjects: { id: string; name: string; relation?: string }[];
}

/** 任务关联的智能上下文 */
export interface SmartContext {
  task: TaskMeta;
  directSpecs: ParsedSpec[];
  relatedSpecs: ParsedSpec[];
  semanticSpecs: ParsedSpec[];
}

/** Spec 模板定义 */
export interface SpecTemplateFile {
  relativePath: string;
  frontmatter?: SpecFrontmatter;
  content: string;
}

export interface SpecTemplate {
  name: string;
  description: string;
  defaultScope: 'project' | 'user' | 'global';
  source: 'built-in' | 'custom';
  files: SpecTemplateFile[];
}

/** 搜索结果条目 */
export type SearchDocumentType = 'spec' | 'task' | 'project';

export interface SearchResult {
  type: SearchDocumentType;
  score: number;
  title: string;
  snippet: string;
  meta: Record<string, unknown>;
}

export type SearchDocKind = 'overview' | 'structure' | 'guideline' | 'reference' | 'unknown';

export interface SearchDocumentMeta {
  filePath: string;
  docKind: SearchDocKind;
  tags: string[];
  headings: string[];
  keywords: string[];
  titleTerms: string[];
  pathTerms: string[];
  scopeKey: string;
  scopeTerms: string[];
  domainTerms: string[];
}

export type SpecSearchMeta = SearchDocumentMeta;

/** 语义搜索结果 */
export interface SemanticSearchResult {
  id: string;
  filePath: string;
  type: SearchDocumentType;
  title: string;
  username?: string;
  projectId?: string;
  projectIds?: string[];
  distance: number;
}

/** RAG 索引状态 */
export interface RAGStatus {
  dbPath: string;
  indexedDocuments: number;
  totalEmbeddings: number;
  vectorStoreReady: boolean;
  modelInstalled: boolean;
  modelLoaded: boolean;
  modelId: string;
  remoteHost: string | null;
  proxy: string | null;
  lastUpdated: string | null;
}

/** Embedding 记录 */
export interface EmbeddingRecord {
  id: string;
  filePath: string;
  contentHash: string;
  embedding: Float32Array;
}

/** SQLite 中的项目行 */
export interface ProjectRow {
  id: string;
  name: string;
  local_path: string;
  description: string | null;
  git_remote: string | null;
  groups: string | null;
  tags: string | null;
  username: string;
  created: string;
  updated: string | null;
}

/** SQLite 中的项目关系行 */
export interface ProjectRelationRow {
  project_a: string;
  project_b: string;
  relation_type: string;
  description: string | null;
}

/** SQLite 中的任务-项目关联行 */
export interface TaskProjectRow {
  task_id: string;
  project_id: string;
}
