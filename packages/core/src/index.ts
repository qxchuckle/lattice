// 类型定义
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
  SemanticSearchResult,
  RAGStatus,
  EmbeddingRecord,
  ProjectRow,
  ProjectRelation,
  ProjectFingerprintRow,
  RelationsFile,
  TaskProjectRow,
  AncestorProjectInfo,
  FastStartLogEntry,
  FastStartLogFile,
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
  getTaskDesignPath,
  getFastStartLogDir,
  getFastStartLogFileName,
  getFastStartLogFilePath,
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
  listUserDirs,
  findUpwards,
  findAllUpwards,
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
  hashPassword,
  verifyPassword,
  generateJwtSecret,
  readWebAuth,
  writeWebAuth,
  clearWebAuth,
  isAuthEnabled,
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
  rebuildProjectsCache,
  upsertProject,
  deleteProject,
  getProjectById,
  getProjectByPath,
  listAllProjects,
  listProjectRowsById,
  upsertProjectDir,
  listProjectDirs,
  deleteProjectDir,
  upsertFingerprint,
  deleteFingerprintsByProject,
  listFingerprintsByProject,
  findProjectsByFingerprint,
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
  ensureVecStoreDimension,
  getEmbeddingsByFilePath,
  deleteEmbeddingsByFilePath,
  updateEmbeddingMetadataByFilePath,
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
  listProjectMetas,
  findProjectByPath,
  findProjectById,
  findProjectDirName,
  scanForProjects,
  resolveProjectById,
  getAllUniqueRelations,
  parseProjectRow,
  isPathPrefixOf,
  // 新模块 re-export（通过 project/index.ts 间接导出）
  computeProjectIds,
  resolveProjectIds,
  normalizeLegacyId,
  normalizeProjectMeta,
  parsePrefixedId,
  selectPrimaryId,
  sortIdsByPriority,
  mergeIds,
  ID_PREFIX,
  type IdPrefix,
  type FingerprintDerived,
  findProjectByAnyId,
  findAllProjectsByAnyId,
  findProjectsOnDisk,
  clearLookupCache,
  findUsernameAndDirName,
  getProjectMetaById,
  isTaskAssociatedWithProject,
  isTaskAssociatedWithProjectId,
  getRelatedProjectIds,
  getProjectDirNames,
  getProjectIdsFromDb,
  getVirtualProjectMeta,
  listVirtualProjectMetas,
  clearVirtualMergeCache,
  registerProjectWithIds,
  updateProjectPaths,
  autoRegisterProject,
  syncProjectIdsToDb,
  syncProjectMetaToDb,
  isBlacklisted,
  type ScanResult,
  type ScanProgress,
  type ScanProgressCallback,
  mergeProjects,
  type MergeResult,
  detectAndLinkNestedIn,
} from './project';

// 项目 git 状态
export { getProjectGitStatus, type GitStatus } from './project/git-status';

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
  deleteRelationsByFilter,
  getRelationsByProjectCrossUser,
  listRelationsCrossUser,
  type RelationWithSource,
} from './project/relation';

// 跨用户项目发现
export { findSameProjectInOtherUsers, listAllUsernames, renameUser } from './project/cross-user';

// 项目指纹
export { collectFingerprint, normalizeGitRemote, normalizeLocalPath } from './project/fingerprint';

// 项目画像
export {
  readProfileTags,
  writeProfileTags,
  addProfileTags,
  removeProfileTags,
  readProfileSummary,
  writeProfileSummary,
  readProfileCache,
  checkProfiles,
  checkSingleProfile,
  markProfileDone,
  getProfileShow,
  getProfileDirPath,
  buildProfileSection,
  getProfileBrief,
  collectProfileInputs,
  computeInputsHash,
  type ProfileCache,
  type ProfileCacheDetail,
  type ProfileCheckResult,
  type ProfileCheckResultItem,
  type ProfileShowResult,
} from './project/profile';

// 扫描缓存
export { readScanCache, writeScanCache, shouldScan, type ScanCache } from './cache/scan-cache';
export { getInitMetaPath, readInitMeta, writeInitMeta, type InitMeta } from './cache/init-meta';

// Spec
export {
  parseSpec,
  writeSpec,
  writeSpecRaw,
  deleteSpec,
  specExists,
  normalizeSpecFrontmatter,
  getGlobalSpecs,
  getUserSpecs,
  getProjectSpecs,
  getAllProjectSpecs,
  getCascadedSpecs,
  getCascadedSpecsWithAncestors,
  detectSpecConflicts,
  findSpecByName,
  validateSpecScope,
  validateSpecsScope,
  generateSpecId,
  isValidSpecId,
  SPEC_ID_PREFIX,
  SPEC_ID_PATTERN,
  lintSpecFrontmatter,
  lintSpecs,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  migrateSpecs,
} from './spec';
export type {
  SpecMatch,
  FindSpecOptions,
  SpecValidationWarning,
  SpecLintIssue,
  SpecLintReport,
  MigrateResult,
  MigrateOptions,
} from './spec';

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
  getTaskDesign,
  resolveTaskById,
  getTaskGraphViews,
  getTaskLineage,
  getTaskDescendantTree,
  getTaskContainingTree,
} from './task';

// 任务检查点
export { addCheckpoint, listCheckpoints, getCheckpoint, readProgress } from './task/checkpoint';
export type { AddCheckpointOptions, ListCheckpointsOptions } from './task/checkpoint';

// 任务 spec 引用
export { addSpecRefs, removeSpecRefs } from './task/refs';
export type { RefSpecResult } from './task/refs';

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
  resolveSpecScope,
  hybridSearch,
  searchProjects,
  projectSearchResultsToSearchResults,
  unifiedSearch,
  computeDynamicLimits,
  type ContextOptions,
  type DynamicLimits,
  type ProjectMatchProvenance,
  type ProjectSearchResult,
} from './search';

// RAG
export {
  indexSpec,
  indexFtsAndMeta,
  checkEmbeddingFreshness,
  storeEmbedding,
  removeSpecIndex,
  removeSearchDocumentIndex,
  semanticSearch,
  rebuildIndex,
  incrementalIndex,
  getRAGStatus,
  checkModelMigration,
  forceRebuildIndex,
  updateRagIndex,
  generateEmbedding,
  contentHash,
  isModelInstalled,
  isModelLoaded,
  isModelLoadNetworkError,
  formatModelNetworkHint,
  getModelLoadError,
  removeInstalledModel,
  collectAllSearchDocuments,
} from './rag';
export type {
  IncrementalIndexResult,
  IndexProgressCallback,
  SearchDocumentInput,
  RagUpdateResult,
} from './rag';

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
export { runDoctorCheck } from './maintenance/doctor-check';
export { getGlobalStatus } from './maintenance/status';
export type { GlobalStatus } from './maintenance/status';
export { openDirectory, openWithEditor, openLatticeRoot } from './maintenance/open';
export type { OpenMode, EditorApp } from './maintenance/open';
export {
  isGitInitialized,
  getGitStatus,
  commitAll,
  pullRebase,
  push as pushGit,
  syncAll,
  initLatticeGit,
  listRemotes,
  addRemote,
  setRemoteUrl,
  removeRemote,
} from './maintenance/git-ops';
export type { GitOpResult, LatticeGitStatus, GitRemoteInfo } from './maintenance/git-ops';

// 工具
export { nowISO, todayDateForId } from './utils/time';

// fast-start 日志
export {
  MAX_ENTRIES_PER_FILE,
  addLogEntry,
  listLogEntries,
  searchLogEntries,
  getLogEntry,
  clearAllLogs,
  getLogStats,
  getWritableFileCreatedAt,
} from './fast-start-log';
export type {
  AddLogOptions,
  ListLogOptions,
  SearchLogOptions,
  FastStartLogStats,
} from './fast-start-log';
