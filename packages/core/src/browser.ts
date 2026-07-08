/**
 * 浏览器安全入口点 — 只导出零 Node.js 依赖的纯函数和类型
 *
 * Vite dev 模式不树摇，index.ts 的全量 re-export 会拉入 node:os / better-sqlite3 等。
 * 此文件作为 web 客户端的入口，只导出浏览器实际需要的纯函数。
 */

// 纯函数（来自 identity.ts，零 Node.js 依赖）
export {
  selectPrimaryId,
  sortIdsByPriority,
  normalizeProjectMeta,
  normalizeLegacyId,
  resolveProjectIds,
  parsePrefixedId,
  mergeIds,
  normalizeGitRemote,
  ID_PREFIX,
  type IdPrefix,
  type FingerprintDerived,
} from './project/identity';

// 类型（编译时擦除，无运行时影响）
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
  GlobalConfig,
  LocalConfig,
  ResolvedConfig,
  DoctorReport,
  DoctorEntry,
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
  SemanticSearchResult,
  RAGStatus,
  EmbeddingRecord,
  ProjectRow,
  ProjectRelation,
  ProjectFingerprintRow,
  RelationsFile,
  TaskProjectRow,
  AncestorProjectInfo,
} from './types';

export type { GitStatus } from './project/git-status';
