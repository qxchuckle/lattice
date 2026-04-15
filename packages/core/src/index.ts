// 类型定义
export type {
  ProjectMeta,
  TaskMeta,
  TaskStatus,
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
  SmartContext,
  SpecTemplateFile,
  SpecTemplate,
  SearchResult,
  SemanticSearchResult,
  RAGStatus,
  EmbeddingRecord,
  ProjectRow,
  ProjectRelationRow,
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
  getProjectDir,
  getProjectMetaPath,
  getProjectSpecDir,
  getTaskDir,
  getTaskMetaPath,
  getTaskPrdPath,
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
  upsertRelation,
  getRelationsForProject,
  linkTaskProject,
  unlinkTaskProject,
  getProjectsForTask,
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
} from './db';

// 项目
export {
  generateProjectId,
  detectProjectInfo,
  registerProject,
  unregisterProject,
  getProjectMeta,
  updateProjectMeta,
  listProjects,
  findProjectByPath,
  findProjectById,
  findProjectDirName,
  scanForProjects,
} from './project';

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
} from './spec';

// 任务
export {
  generateTaskId,
  createTask,
  listTasks,
  getTaskMeta,
  updateTask,
  archiveTask,
  deleteTask,
  getTaskPrd,
} from './task';

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
} from './search';

// RAG
export {
  indexSpec,
  removeSpecIndex,
  removeSearchDocumentIndex,
  semanticSearch,
  rebuildIndex,
  getRAGStatus,
  generateEmbedding,
  contentHash,
  isModelInstalled,
  isModelLoaded,
  removeInstalledModel,
} from './rag';

// 维护
export { runStartupSelfCheck } from './maintenance/startup-self-check';
export type { StartupSelfCheckResult } from './maintenance/startup-self-check';
