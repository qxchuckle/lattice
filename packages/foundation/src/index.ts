// ─── 类型定义 ───
export type {
  ProjectMeta,
  TaskMeta,
  ReferencedSpec,
  TaskTreeNode,
  TaskStatus,
  ScopePath,
  CheckpointType,
  CheckpointEntry,
  ProgressFile,
  SearchDocumentType,
  SearchDocumentMeta,
  SpecFrontmatter,
  ParsedSpec,
  RAGEmbeddingConfig,
  RAGConfig,
  GlobalConfig,
  LocalConfig,
  ResolvedConfig,
  WebAuthConfig,
  DoctorReport,
  DoctorEntry,
  DoctorOptions,
  SpecConflict,
  ProjectContext,
  CrossUserProjectData,
  RelatedProjectEntry,
  RelatedProjectRelationEntry,
  SmartContext,
  CrossUserTaskData,
  SpecTemplateFile,
  SpecTemplate,
  SearchResult,
  SearchResultMeta,
  SearchDocKind,
  SemanticMatchedSection,
  SemanticSearchResult,
  RAGStatus,
  EmbeddingRecord,
  SpecSearchMeta,
  ProjectRow,
  ProjectRelation,
  ProjectFingerprintRow,
  ProjectDirRow,
  RelationsFile,
  TaskProjectRow,
  AncestorProjectInfo,
  FastStartLogEntry,
  FastStartLogFile,
} from './types';

// ─── 路径与文件工具（含内部使用的 profile 路径函数） ───
export * from './paths';

// ─── 配置（含内部使用的 readExplicitEmbeddingConfig） ───
export * from './config';

export {
  getByPath,
  setByPath,
  deleteByPath,
  deepEqual,
  diffConfig,
  isPlainObject,
} from './config/utils';

// ─── 工具 ───
export { nowISO, todayDateForId } from './utils/time';
export { CONCURRENCY } from './utils/constants';
