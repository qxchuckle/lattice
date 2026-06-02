// 类型定义
export type {
  ProjectMeta,
  TaskMeta,
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
  ProjectFingerprintEntry,
  ProjectFingerprint,
  ProjectFingerprintRow,
  ProjectMatchCandidate,
  RelationsFile,
  TaskProjectRow,
} from './types';

// 路径与文件工具
export {
  getLatticeRoot,
  getCacheDir,
  getDbPath,
  getConfigDir,
  getGlobalConfigPath,
  getLocalConfigPath,
  getGlobalSpecDir,
  getSpecTemplatesDir,
  getTemplateRegistriesDir,
  getUsersDir,
  getUserDir,
  getUserSpecDir,
  getUserProjectsDir,
  getUserTasksDir,
  getRelationsFilePath,
  getProjectDir,
  getProjectMetaPath,
  getProjectSpecDir,
  getTaskDir,
  getTaskMetaPath,
  getTaskPrdPath,
  getTaskProgressPath,
  makeProjectDirName,
  toKebabCase,
  ensureDir,
  fileExists,
  dirExists,
  readJSON,
  writeJSON,
  readText,
  writeText,
  removeFile,
  removeDir,
  listDir,
  findUpwards,
} from './paths';

// 配置
export {
  getDefaultGlobalConfig,
  getDefaultLocalConfig,
  readGlobalConfig,
  writeGlobalConfig,
  readLocalConfig,
  writeLocalConfig,
  readResolvedConfig,
  getUsername,
  isInitialized,
} from './config';

export {
  getByPath,
  setByPath,
  deleteByPath,
  deepEqual,
  diffConfig,
  isPlainObject,
} from './config/utils';

// 数据库
export {
  initDb,
  closeDb,
  getDb,
  upsertProject,
  deleteProject,
  getProjectById,
  getProjectByPath,
  listAllProjects,
  listProjectRowsById,
  upsertFingerprint,
  deleteFingerprintsByProject,
  listFingerprintsByProject,
  findProjectsByFingerprint,
  findProjectsByFingerprintKeyPrefix,
  linkTaskProject,
  unlinkTaskProject,
  getTasksForProject,
  deleteTaskLinks,
  listTaskProjectLinks,
  upsertFtsEntry,
  deleteFtsEntry,
  upsertSpecSearchMeta,
  getSpecSearchMeta,
  deleteSpecSearchMeta,
  searchFts,
  deleteSearchDocumentsByPrefixes,
  listIndexedDocumentPaths,
  upsertEmbedding,
  getEmbeddingByPath,
  deleteEmbedding,
  upsertVecEmbedding,
  searchVec,
  countEmbeddings,
  // FTS 索引版本与通用 KV
  FTS_INDEX_VERSION,
  DB_SCHEMA_VERSION,
  getFtsIndexVersion,
  setFtsIndexVersion,
  getLatticeMeta,
  setLatticeMeta,
} from './db';

// 项目
export {
  generateProjectId,
  detectProjectInfo,
  registerProject,
  unregisterProject,
  purgeProject,
  getProjectMeta,
  updateProjectMeta,
  listProjects,
  findProjectByPath,
  findProjectsByPathSmart,
  findProjectById,
  findProjectDirName,
  scanForProjects,
  resolveProjectById,
  getAllUniqueRelations,
  parseProjectRow,
  isPathPrefixOf,
} from './project';

// 项目关系（relations.json 真源 CRUD）
export {
  generateRelationId,
  normalizePairOrder,
  readRelationsFile,
  writeRelationsFile,
  listRelations,
  getRelationById as getRelationByIdFromFile,
  getRelationsByProject,
  upsertRelation as upsertRelationFile,
  deleteRelation as deleteRelationFile,
  deleteRelationsByProject,
  getRelationsByProjectCrossUser,
  listRelationsCrossUser,
  type RelationWithSource,
} from './project/relation';

// 跨用户项目发现
export { findSameProjectInOtherUsers, listAllUsernames } from './project/cross-user';

// 项目指纹
export {
  FINGERPRINT_WEIGHTS,
  CONFIDENCE_THRESHOLDS,
  collectFingerprint,
  persistFingerprints,
  listFingerprintsForProject,
  findCandidatesByFingerprint,
  findProjectByPathSmart,
  buildFingerprint,
  hashFile,
  listAllProjectFingerprintSummaries,
  normalizeGitRemote,
  normalizeLocalPath,
} from './project/fingerprint';

// Spec
export {
  parseSpec,
  writeSpec,
  writeSpecRaw,
  deleteSpec,
  specExists,
  getGlobalSpecs,
  getUserSpecs,
  getProjectSpecs,
  getCascadedSpecs,
  detectSpecConflicts,
  findSpecByName,
  validateSpecScope,
  validateSpecsScope,
} from './spec';
export type { SpecMatch, FindSpecOptions, SpecValidationWarning } from './spec';

// 任务
export {
  generateTaskId,
  createTask,
  listTasks,
  listTasksCrossUser,
  type TaskMetaWithSource,
  getTaskMeta,
  updateTask,
  archiveTask,
  deleteTask,
  purgeTask,
  getTaskPrd,
  resolveTaskById,
  getTaskGraphViews,
  getTaskLineage,
  getTaskDescendantTree,
  getTaskContainingTree,
} from './task';

// 任务检查点
export { addCheckpoint, listCheckpoints, getCheckpoint, readProgress } from './task/checkpoint';
export type { AddCheckpointOptions, ListCheckpointsOptions } from './task/checkpoint';

// 模板
export type {
  TemplateData,
  PlatformName,
  BundledSpecTemplateConflict,
  SyncBundledSpecTemplatesOptions,
  SyncBundledSpecTemplatesResult,
  SyncedTemplateRegistry,
  SpecTemplateRegistryInfo,
} from './template-assets';
export {
  getBundledTemplateDir,
  listBundledSpecTemplates,
  renderPlatformTemplate,
  renderCursorRules,
  renderClaudeCode,
  renderWindsurfRules,
  renderKiroSteering,
  listSpecTemplates,
  getSpecTemplate,
  applySpecTemplate,
  syncBundledSpecTemplates,
  syncSpecTemplateRegistry,
  listSpecTemplateRegistries,
  removeSpecTemplateRegistry,
} from './template-assets';

// 搜索与上下文
export {
  getContextForProject,
  getSmartContext,
  formatContextAsMarkdown,
  hybridSearch,
  type ContextOptions,
} from './search';

// RAG
export {
  indexSpec,
  removeSpecIndex,
  removeSearchDocumentIndex,
  semanticSearch,
  rebuildIndex,
  incrementalIndex,
  getRAGStatus,
  generateEmbedding,
  contentHash,
  isModelInstalled,
  isModelLoaded,
  removeInstalledModel,
  collectAllSearchDocuments,
} from './rag';
export type { IncrementalIndexResult, SearchDocumentInput } from './rag';

// 垃圾桶
export type { TrashMeta } from './trash';
export {
  getTrashDir,
  moveToTrash,
  listTrashItems,
  getTrashItem,
  restoreFromTrash,
  purgeTrashItem,
  emptyTrash,
  resolveTrashById,
} from './trash';

// 维护
export { runStartupSelfCheck } from './maintenance/startup-self-check';
export type { StartupSelfCheckResult } from './maintenance/startup-self-check';
