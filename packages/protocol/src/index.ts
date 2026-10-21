/**
 * Lattice 跨端契约（types-only）——宿主 ⇄ 客户端之间的唯一形状约定。
 *
 * 定位（对齐 Continue 的 `core/protocol` 与 GitLens 的单一 RPC 栈）：
 * - 所有宿主（VSCode 扩展桥 / Web HTTP / 未来 IPC）与所有客户端共用本文件的 DTO；
 * - DTO 直接复用 `@qcqx/lattice-core` 的领域类型，禁止各宿主自定义"精简形状"（历史事故：桥自造 lite 形状导致图谱崩溃）；
 * - 传输层差异（postMessage / HTTP / IPC）只体现在信封与绑定上，不体现在数据形状上。
 *
 * 约定：本包不产生运行时代码（全部为类型），消费方按需 `import type`。
 */
import type {
  CheckpointEntry,
  GitRemoteInfo,
  GitStatus,
  LatticeGitStatus,
  ParsedSpec,
  ProjectMeta,
  ProjectRelation,
  RAGStatus,
  TaskMeta,
  TaskTreeNode,
} from '@qcqx/lattice-core';

// ── 领域类型透传（客户端可直接使用 core 类型）──

export type {
  CheckpointEntry,
  GitRemoteInfo,
  GitStatus,
  LatticeGitStatus,
  ParsedSpec,
  ProjectMeta,
  ProjectRelation,
  RAGStatus,
  TaskMeta,
  TaskTreeNode,
};

// ── VSCode Webview ⇄ Extension 消息信封 ──

export type BridgeRequestMethod =
  | 'getSnapshot'
  | 'getGlobalStatus'
  | 'getPath'
  | 'getTaskDetail'
  | 'getProjectDetail'
  | 'getProjectGitStatus'
  | 'getSpecDetail'
  | 'getTaskContext'
  | 'getContent'
  | 'search'
  | 'getStats'
  | 'getDomainsData'
  // 配置中心（VSCode WebviewPanel）
  | 'getConfigState'
  | 'saveConfig'
  | 'scanProjects'
  | 'cancelScan'
  | 'registerProject'
  | 'updateProject'
  | 'runDoctor'
  | 'runRag'
  | 'gitOperation'
  | 'syncOperation'
  | 'userOperation'
  | 'pickDirectory'
  | 'copyDiagnostics'
  | 'openConfigFile'
  | 'openVscodeSettings'
  | 'getConfigDraft'
  | 'saveConfigDraft'
  | 'clearConfigDraft';

export interface BridgeRequest {
  kind: 'request';
  id: number;
  method: BridgeRequestMethod;
  params?: unknown;
}

export interface BridgeResponse {
  kind: 'response';
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export type BridgeActionName =
  | 'openPath'
  | 'openPathByPath'
  | 'copyText'
  | 'openExternal'
  | 'executeCommand';

export interface BridgeAction {
  kind: 'action';
  action: BridgeActionName;
  params?: unknown;
}

export interface BridgeReady {
  kind: 'ready';
}

export type WebviewToExtension = BridgeRequest | BridgeAction | BridgeReady;

export interface BridgeEvent {
  kind: 'event';
  event: 'snapshotChanged' | 'themeChanged' | 'routeTo' | 'configProgress' | 'configStateChanged';
  payload?: unknown;
}

export type ExtensionToWebview = BridgeResponse | BridgeEvent;

// ── 数据面 DTO（宿主构造、客户端消费）──

export type SpecScopeWire = 'global' | 'user' | 'project';

/**
 * 快照/列表中的 spec 行：ParsedSpec 同形 +
 * - `scope`：级联层级（core ParsedSpec 无此字段，由宿主按来源标注）；
 * - `content` 恒为 `''`：正文经 `getContent` 按需拉取（避免快照携带全量正文）；
 * - 便捷字段 `id/title/description/tags`：= frontmatter 对应值（树/列表直接消费，避免层层兜底）。
 */
export interface SnapshotSpec extends Omit<ParsedSpec, 'content'> {
  content: '';
  scope: SpecScopeWire;
  id: string;
  title: string;
  description?: string;
  tags: string[];
  updated?: string;
}

/** 全局图谱快照：一次拉取项目/任务/spec/关系全量。 */
export interface GraphSnapshot {
  username: string;
  projects: ProjectMeta[];
  tasks: TaskMeta[];
  specs: SnapshotSpec[];
  relations: ProjectRelation[];
}

/** 任务详情 bundle：meta + 检查点 + 子树 + 血缘。 */
export interface TaskDetailPayload {
  task: TaskMeta | null;
  progress: CheckpointEntry[];
  tree: TaskTreeNode | null;
  lineage: TaskMeta[];
}

/** 项目详情 bundle：meta + 项目 spec + 任务 + 关系。 */
export interface ProjectDetailPayload {
  project: ProjectMeta | null;
  specs: SnapshotSpec[];
  tasks: TaskMeta[];
  relations: ProjectRelation[];
}

/** spec 详情（含 scope 标注）。 */
export interface SpecDetailPayload {
  spec: SnapshotSpec | null;
}

export interface ContentParams {
  type: 'prd' | 'design' | 'progress' | 'spec' | 'profile';
  id: string;
}

export interface SearchBridgeParams {
  query: string;
  type?: string;
  limit?: number;
  projectId?: string;
}

export interface GlobalStatusPayload {
  home: string;
  pathSep: string;
}

export interface StatsPayload {
  projectCount: number;
  taskCount: number;
  activeTaskCount: number;
  relationCount: number;
}

// ── VSCode 配置中心 ──

export type ConfigSectionId =
  | 'overview'
  | 'projects'
  | 'editor'
  | 'core'
  | 'users'
  | 'diagnostics'
  | 'advanced';

export type ConfigSettingsTarget = 'user' | 'workspace';

export interface ConfigRuntimeInfo {
  extensionVersion: string;
  coreVersion: string;
  vscodeVersion: string;
  nodeVersion: string;
  platform: string;
  root: string;
  initialized: boolean;
  configPaths: { global: string; local: string };
  db: {
    driver: string;
    available: boolean;
    error: string | null;
    path: string;
    sizeKB: number;
  };
  watcher: {
    healthy: boolean;
    autoRefresh: boolean;
    fallbackPollMs: number;
  };
}

export interface ConfigStats {
  projectCount: number;
  taskCount: number;
  activeTaskCount: number;
  specCount: number;
  relationCount: number;
}

export type ConfigSettingSource = 'user' | 'workspace' | 'workspaceFolder' | 'default';

export interface ConfigSettingsState {
  target: ConfigSettingsTarget;
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  sources: Record<string, ConfigSettingSource>;
}

export interface ConfigCoreState {
  /** 文件中的全局配置，保留未在表单中暴露的键。 */
  global: Record<string, unknown>;
  local: Record<string, unknown>;
  globalDefaults: Record<string, unknown>;
  localDefaults: Record<string, unknown>;
  /** 合并 local / 内置默认值后的实际生效全局配置（用于表单展示）。 */
  globalEffective?: Record<string, unknown>;
}

export interface ConfigProjectRow {
  id: string;
  ids: string[];
  name: string;
  description: string | null;
  localPaths: string[];
  gitRemotes: string[];
  groups: string[];
  groupIds: string[];
  tags: string[];
  updated: string | null;
}

export type ConfigWorkspaceStateKind =
  | 'registered'
  | 'registered-via-git'
  | 'unregistered-git'
  | 'unregistered-anchor'
  | 'unregistered-no-anchor'
  | 'nested';

export interface ConfigWorkspaceProject {
  /** 所属 workspace folder 路径。 */
  folder: string;
  /** 展示名称（项目名优先，否则目录名）。 */
  name: string;
  /** 候选项目根 / 注册目标路径。 */
  path: string;
  anchorRoot: string | null;
  gitRoot: string | null;
  projectId: string | null;
  projectName: string | null;
  state: ConfigWorkspaceStateKind;
  targetPath: string;
  isRoot: boolean;
  active: boolean;
}

export interface ConfigWorkspaceState {
  folder: string;
  name: string;
  anchorRoot: string | null;
  gitRoot: string | null;
  projectId: string | null;
  projectName: string | null;
  state: ConfigWorkspaceStateKind;
  /** 根候选的注册目标路径（锚点/Git 根/项目根）。 */
  targetPath: string;
  /** 该 workspace folder 内的项目候选（根项目 + 已注册嵌套项目）。 */
  projects: ConfigWorkspaceProject[];
}

export interface ConfigDomainLastSync {
  status: 'ok' | 'error';
  message: string;
  at: string;
}

export interface ConfigDomainStats {
  users: number;
  projects: number;
  specs: number;
  tasks: number;
}

export interface ConfigDomainInfo {
  hash: string;
  remote: string;
  branch: string;
  label?: string;
  use: 'trusted' | 'reference' | 'off';
  routes?: string[];
  pushState: string;
  mirrorExists: boolean;
  lastPushAt: string | null;
  priority: number;
  lastSync: ConfigDomainLastSync | null;
  stats: ConfigDomainStats | null;
}

export interface ConfigGitState {
  status: LatticeGitStatus;
  remotes: GitRemoteInfo[];
}

export interface ConfigStatePayload {
  initialized: boolean;
  runtime: ConfigRuntimeInfo;
  user: string;
  users: string[];
  stats: ConfigStats;
  rag: RAGStatus | null;
  settings: ConfigSettingsState;
  core: ConfigCoreState;
  workspace: ConfigWorkspaceState[];
  projects: ConfigProjectRow[];
  groupPaths: string[];
  git: ConfigGitState;
  domains: ConfigDomainInfo[];
  errors: Record<string, string>;
}

export interface ConfigSavePayload {
  vscode?: {
    target: ConfigSettingsTarget;
    set?: Record<string, unknown>;
    unset?: string[];
  };
  global?: {
    set?: Record<string, unknown>;
    unset?: string[];
  };
  local?: {
    set?: Record<string, unknown>;
    unset?: string[];
  };
}

export interface ConfigSaveResult {
  changedKeys: string[];
  warnings: string[];
  requiresReload: boolean;
  requiresRagRebuild: boolean;
}

export interface ConfigDraftSnapshot {
  draft: unknown;
  settingsTarget: ConfigSettingsTarget;
  savedAt: string;
}

export interface ConfigScanPayload {
  dirs: string[];
  saveAsDefault?: boolean;
}

export interface ConfigScanResult {
  added: string[];
  updated: string[];
  canceled?: boolean;
}

export interface ConfigRegisterPayload {
  path: string;
  target?: 'git-root' | 'folder';
  createAnchor?: boolean;
  name?: string;
}

export interface ConfigRegisterResult {
  projectId: string;
  projectName: string;
  created: boolean;
  anchorPath?: string;
  ids: string[];
}

export interface ConfigUpdateProjectPayload {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  groups?: string[];
}

export interface ConfigRagPayload {
  action: 'update' | 'rebuild';
}

export interface ConfigDoctorPayload {
  fix?: boolean;
}

export type ConfigGitOperation =
  | { op: 'commit'; message?: string }
  | { op: 'pull' }
  | { op: 'push' }
  | { op: 'sync' }
  | { op: 'init'; remote?: string }
  | { op: 'remote-add'; name: string; url: string }
  | { op: 'remote-set'; name: string; url: string }
  | { op: 'remote-remove'; name: string };

export type ConfigSyncOperation =
  | { op: 'join'; remote: string; branch?: string; label?: string; use?: string; routes?: string[] }
  | {
      op: 'update';
      hash: string;
      remote?: string;
      branch?: string;
      label?: string;
      use?: string;
      routes?: string[];
    }
  | { op: 'unlink'; hash: string }
  | { op: 'reorder'; hashes: string[] }
  | { op: 'sync' }
  | { op: 'preview'; hash: string; routes?: string[] };

export type ConfigUserOperation =
  | { op: 'switch'; username: string }
  | { op: 'create'; username: string }
  | { op: 'rename'; username: string; force?: boolean };

export type ConfigOperationKind = 'scan' | 'rag' | 'doctor' | 'git' | 'sync';

export interface ConfigProgressEvent {
  kind: ConfigOperationKind;
  phase: 'start' | 'progress' | 'done' | 'error' | 'canceled';
  message?: string;
  current?: number;
  total?: number;
  currentDir?: string;
  added?: number;
  updated?: number;
  found?: number;
}
