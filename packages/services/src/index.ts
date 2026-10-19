/**
 * Lattice 应用服务层（多宿主共享的用例实现）。
 *
 * 分层约定（详见 docs/architecture.md）：
 *   core（领域+存储+平台端口） → services（用例） → 宿主绑定（HTTP / postMessage / IPC）→ 客户端
 *
 * - 宿主（CLI / web server / VSCode 扩展 / 未来客户端）只做：参数归一、鉴权、传输绑定、UI 视图模型映射；
 * - 一切"组合与降级"（虚拟合并、文件回退、跨用户聚合、写操作前置校验）都在本层实现，保证多端语义一致；
 * - DB 初始化由宿主负责（core 的 initDb/closeDb）；本层在 DB 不可用时自动回退文件真源。
 */
export { currentUsername, listUsers } from './users';
export {
  findProjectsByPath,
  getProject,
  getProjectDetail,
  getProjectGitStatus,
  getProjectMetaPath,
  getProjectRelations,
  getProjectSpecsFor,
  getProjectTasks,
  listProjects,
  resolveProjectDirName,
  resolveProjectId,
  updateProject,
  type ProjectDetail,
  type ProjectPathMatch,
} from './projects';
export {
  createProjectGroup,
  getProjectGroupTree,
  listProjectGroupPaths,
  moveProjectGroup,
  previewProjectGroupImpact,
  removeProjectGroup,
  renameProjectGroup,
  setProjectGroups,
  type ProjectGroupImpactPreview,
  type ProjectGroupMutationResult,
  type ProjectGroupsSetResult,
  type ProjectGroupTree,
  type ProjectGroupTreeItem,
} from './project-groups';
export {
  addTaskCheckpoint,
  addTaskSpecRefs,
  associateTask,
  createTask,
  deleteTask,
  getProjectContextBundle,
  getTask,
  getTaskCheckpoint,
  getTaskContext,
  getTaskDetail,
  getTaskGraph,
  getTaskInfo,
  getTaskLineage,
  listActiveCheckpoints,
  listCheckpoints,
  listTasks,
  removeTaskSpecRefs,
  requireTask,
  setTaskStatus,
  unassociateTask,
  updateTaskParent,
  updateTaskTitle,
  type ListTasksOptions,
} from './tasks';
export {
  detectAllConflicts,
  detectConflicts,
  findSpec,
  listSpecs,
  migrateSpecs,
  updateSpecFrontmatter,
  type ListSpecsOptions,
  type SpecFrontmatterUpdates,
} from './specs';
export { addRelation, listRelations, removeRelation } from './relations';
export { readContent, resolveContentPath, type ContentPathType } from './content';
export { search, type SearchOptions } from './search';
export { getGlobalStatus, getStats, type DashboardStats } from './stats';
export { listTrash, emptyTrash, purgeTrash, restoreTrash } from './trash';
export { getRagStatus, runDoctor, updateRag } from './maintenance';
export {
  canonicalKey,
  idMatches,
  inferSpecScope,
  projectIdSet,
  type SpecScopeWire,
  type SpecWithScope,
  type TaskDetail,
} from './shared';
