/** 项目元数据，存储在 ~/.lattice/users/<username>/projects/<id>/project.json */
export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  /** 项目的本地路径（数组：同一项目可能在多台机器/多个 worktree 上有多个本地路径） */
  localPaths: string[];
  /** Git remote URL 列表（normalized 后的，去 .git 后缀、统一 https/ssh 形式） */
  gitRemotes?: string[];
  /** Git 仓库首个 commit 的 SHA（最强指纹） */
  gitFirstCommit?: string;
  /** Git 默认分支名 */
  gitDefaultBranch?: string;
  /** package.json / Cargo.toml 等清单中的包名 */
  packageNames?: string[];
  /** monorepo 中所有 workspace 包名 */
  monorepoPackages?: string[];
  /** 指纹最近一次采集时间 */
  fingerprintsUpdated?: string;
  groups?: string[];
  tags?: string[];
  created: string;
  updated?: string;
}

/** 任务状态 */
export type TaskStatus = 'planning' | 'in_progress' | 'completed' | 'archived';

/** 任务元数据中的额外路径条目 */
export interface ScopePath {
  /** 绝对路径 */
  path: string;
  /** 命中的项目 ID（若该路径属于某个已注册项目） */
  projectId?: string;
  /** 备注，例如 "reference" / "share-component" / "data-sample" */
  note?: string;
  /** 添加时间 */
  addedAt: string;
}

/** 任务元数据，存储在 ~/.lattice/users/<username>/tasks/<id>/task.json */
export interface TaskMeta {
  id: string;
  title: string;
  status: TaskStatus;
  projects?: string[];
  /** 任务涉及但不属于已注册项目的额外路径 */
  scopePaths?: ScopePath[];
  parentTaskId?: string;
  /** 任务引用的 spec 列表（通过 lattice task ref-spec 管理） */
  referencedSpecs?: ReferencedSpec[];
  created: string;
  updated?: string;
}

/** 任务引用的 spec 条目 */
export interface ReferencedSpec {
  /** Spec 唯一 ID（spec-{8 位 base36}） */
  id: string;
  /** 相对路径（从 spec 根目录计算） */
  relativePath: string;
  /** 作用域（global / user / project） */
  scope: 'global' | 'user' | 'project';
  /** 首次引用时间（ISO 8601） */
  firstReadAt: string;
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

/**
 * 检查点类型（11 类，按信息来源分三组）
 *
 * 用户输入类（3）——用户在对话中主动提供的信息
 * - context：背景·需求·场景·业务领域信息
 * - correction：对已做之事的纠正（3段：做错了什么 / 为什么错 / 正确做法）
 * - constraint：边界·约束·禁区
 *
 * AI 判断类（3）——AI 自身产生的推断与记录
 * - assumption：用户未明说时 AI 做出的关键推断
 * - followup：识别出但主动延后的事项
 * - note：从代码·环境·工具调用获得的客观事实（亦作颗粒度兜底）
 *
 * 进程事件类（5）——任务推进中发生的客观事件
 * - decision：中性拍板某选项
 * - pivot：原方向被推翻
 * - milestone：阶段性成果通过验证
 * - issue：已发生的问题·踩坑
 * - summary：任务收尾总结
 *
 * 设计原则：多类型是互补记录信息，不是重复记录。单条输入常需多类型并发打点。
 */
export type CheckpointType =
  | 'context'
  | 'correction'
  | 'constraint'
  | 'assumption'
  | 'followup'
  | 'note'
  | 'decision'
  | 'pivot'
  | 'milestone'
  | 'issue'
  | 'summary';

/** 检查点条目，存储在 progress.yaml */
export interface CheckpointEntry {
  id: string;
  time: string;
  type: CheckpointType;
  title: string;
  message: string;
}

/** progress.yaml 文件结构 */
export interface ProgressFile {
  entries: CheckpointEntry[];
}

/** Spec frontmatter 字段 */
export interface SpecFrontmatter {
  /** Spec 唯一 ID（CLI 自动生成，格式：spec-{8 位 base36}） */
  id?: string;
  /** 标题，必填（写入时若缺失 CLI 会用文件名 fallback） */
  title?: string;
  /**
   * 摘要（必填），三段式：作用范围 + 约束 + 作用。
   * 推荐 80~300 中文字符；缺失时 context 输出会显式标 `[缺失摘要]`。
   */
  description?: string;
  /** 可选标签 */
  tags?: string[];
  /** CLI 自动维护的最后修改时间（ISO 8601） */
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

/** 关联项目的关系条目 */
export interface RelatedProjectRelationEntry {
  /** relations.json 中关系的唯一 id */
  relId: string;
  /** 关系类型 */
  type: string;
  /** 关系描述 */
  description?: string;
}

/** 项目上下文中关联项目条目（同一项目可能有多种关系） */
export interface RelatedProjectEntry {
  id: string;
  name: string;
  relations: RelatedProjectRelationEntry[];
}

/** 跨用户聚合的项目数据（每个其他用户一个条目） */
export interface CrossUserProjectData {
  /** 数据来源用户名 */
  username: string;
  /** 该用户下匹配到的项目 ID */
  projectId: string;
  /** 该用户为同一项目编写的项目级 spec */
  projectSpecs: ParsedSpec[];
  /** 该用户的用户级 spec */
  userSpecs: ParsedSpec[];
  /** 该用户关联到同一项目的活跃任务 */
  activeTasks: TaskMeta[];
  /** 该用户为同一项目设定的关联项目 */
  relatedProjects: RelatedProjectEntry[];
}

/** 祖先项目信息（嵌套项目场景） */
export interface AncestorProjectInfo {
  /** 项目 ID */
  id: string;
  /** 项目名称 */
  name?: string;
  /** 项目本地根目录 */
  root: string;
}

/** 项目上下文（三层 spec 聚合 + 关联信息） */
export interface ProjectContext {
  projectSpecs: ParsedSpec[];
  userSpecs: ParsedSpec[];
  globalSpecs: ParsedSpec[];
  cascadedSpecs: ParsedSpec[];
  activeTasks: TaskMeta[];
  relatedProjects: RelatedProjectEntry[];
  /** 跨用户聚合数据（其他用户为同一项目贡献的信息） */
  crossUserData?: CrossUserProjectData[];
  /** 嵌套项目继承：祖先项目列表（近→远） */
  ancestors?: AncestorProjectInfo[];
  /** 嵌套项目继承：从祖先项目继承的 spec（已参与级联覆盖） */
  ancestorSpecs?: ParsedSpec[];
}

/** 跨用户聚合的任务上下文数据 */
export interface CrossUserTaskData {
  /** 数据来源用户名 */
  username: string;
  /** 该用户为同一项目编写的项目级 spec */
  directSpecs: ParsedSpec[];
  /** 该用户关联到同一项目的活跃任务 */
  activeTasks: TaskMeta[];
}

/** 任务关联的智能上下文 */
export interface SmartContext {
  task: TaskMeta;
  directSpecs: ParsedSpec[];
  relatedSpecs: ParsedSpec[];
  semanticSpecs: ParsedSpec[];
  /** 跨用户聚合数据（其他用户为同一关联项目贡献的信息） */
  crossUserData?: CrossUserTaskData[];
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
export type SearchDocumentType = 'spec' | 'task' | 'project' | 'checkpoint' | 'relation';

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

/** SQLite 中的项目行（local_path 存储 JSON 数组字符串，git_remote 存储 JSON 数组字符串） */
export interface ProjectRow {
  id: string;
  name: string;
  /** JSON 数组字符串，例如 ["/Users/a/foo","/Users/a/foo-worktree"] */
  local_path: string;
  description: string | null;
  /** JSON 数组字符串，例如 ["https://github.com/x/y"] */
  git_remote: string | null;
  git_first_commit: string | null;
  git_default_branch: string | null;
  package_names: string | null;
  monorepo_packages: string | null;
  groups: string | null;
  tags: string | null;
  username: string;
  created: string;
  updated: string | null;
}

/** SQLite 中的项目指纹行 */
export interface ProjectFingerprintRow {
  project_id: string;
  /** 指纹键，例如 'git_first_commit' / 'git_remote' / 'local_path' / 'package_name' / 'monorepo_packages' / 'local_path_prefix' / 'local_path_basename' */
  key: string;
  /** 指纹值（normalized 后的字符串） */
  value: string;
  /** 评分权重 */
  weight: number;
}

/** relations.json 文件结构 */
export interface ProjectRelation {
  /** 全局唯一 id，例如 "rel_a1b2c3d4" */
  id: string;
  /** 字典序排序后较小的项目 id */
  projectA: string;
  /** 字典序排序后较大的项目 id */
  projectB: string;
  /** 关系类型，例如 forked-from / depends-on / shares-component / related */
  type: string;
  description?: string;
  /** 创建者：'manual' | 'ai-inferred' | 'auto' */
  createdBy?: 'manual' | 'ai-inferred' | 'auto';
  /** 由哪个任务推导出（可选） */
  createdFromTaskId?: string;
  created: string;
  updated?: string;
}

export interface RelationsFile {
  version: number;
  relations: ProjectRelation[];
}

/** 项目指纹的内存视图 */
export interface ProjectFingerprintEntry {
  key: string;
  value: string;
  weight: number;
}

export interface ProjectFingerprint {
  projectId: string;
  entries: ProjectFingerprintEntry[];
  collectedAt: string;
}

/** 指纹反查的候选项 */
export interface ProjectMatchCandidate {
  projectId: string;
  projectName: string;
  /** 总评分 */
  score: number;
  /** 命中的指纹证据 */
  evidence: { key: string; value: string; weight: number }[];
  /** 高/中/低 置信度 */
  confidence: 'high' | 'medium' | 'low';
}

/** SQLite 中的任务-项目关联行 */
export interface TaskProjectRow {
  task_id: string;
  project_id: string;
}
