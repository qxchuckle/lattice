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
  GitStatus,
  ParsedSpec,
  ProjectMeta,
  ProjectRelation,
  TaskMeta,
  TaskTreeNode,
} from '@qcqx/lattice-core';

// ── 领域类型透传（客户端可直接使用 core 类型）──

export type {
  CheckpointEntry,
  GitStatus,
  ParsedSpec,
  ProjectMeta,
  ProjectRelation,
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
  | 'getDomainsData';

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
  event: 'snapshotChanged' | 'themeChanged' | 'routeTo';
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
