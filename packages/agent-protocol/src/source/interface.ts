/**
 * 源接口（核心契约）— ISource 最终表面（设计轴十三 D5 总账）
 *
 * 原子化铁律：ISource 只提供原子操作；组合行为（retry=fork+prompt、continue、undo 树操作）
 * 永远在消费层。能力差异走三层机制：声明（capabilities）→ 类型（策略表）→ 错误（兜底）。
 *
 * 相比旧版删除的表面（去向）：
 * - abort(sessionId)        → PromptOpts.signal 是唯一取消真相（driver 内部映射 SDK abort）
 * - injectTools(...)        → SessionToolsConfig 随 prompt 会话建立传入（消灭源级可变状态）
 * - getBuiltinTools()       → capabilities.tools.builtin（声明即数据）
 * - isSessionAlive()        → 句柄状态是 driver 内部事
 * - systemPromptPolicy 字段 → capabilities.prompt.systemPrompt
 * - modelPolicy 字段        → capabilities.models.policy
 *
 * 无显式 createSession：prompt 传 sessionId 继续，传 null 新建（PromptResult 返回新 ID）。
 */
import type { SourceEventStream } from './event-stream.js';
import type { ContentBlock } from './messages.js';
import type { ModelInfo } from './models.js';
import type { AuthStatus } from './auth.js';
import type { ToolDefinition } from './tools.js';
import type { SourceResourceInfo, SourceResourceQuery } from './resources.js';
import type { SourceManifest, ResolvedManifest } from './manifest.js';
import type { PermissionRequestHandler } from './permission.js';

// ── SystemPrompt 配置（prompt 期传入；能力门槛见 capabilities.prompt.systemPrompt） ──

export type SystemPromptConfig =
  | { mode: 'source-default' }
  | { mode: 'override'; prompt: string }
  | { mode: 'append'; additional: string };

// ── 会话工具装配（取代源级 injectTools 可变状态） ──

/** 宿主工具随会话建立装配：仅在该源会话生效，跨会话/跨宿主互不污染 */
export interface SessionToolsConfig {
  tools: ToolDefinition[];
  /** 同名时是否覆盖源内置工具 */
  override?: boolean;
}

// ── Prompt 配置 ──

export interface PromptOpts {
  model?: string;
  cwd?: string;
  systemPrompt?: SystemPromptConfig;
  /** 思考深度（取值由模型 tuning 规格约束，freeform 模型可为任意字符串） */
  thinkingLevel?: string;
  /** 上下文窗口 tokens（取值由模型 tuning 规格约束） */
  contextWindow?: number;
  /** 唯一取消真相：中止本次 prompt（在途流终止并发 done/error 收尾） */
  signal?: AbortSignal;
  /** 宿主工具装配（会话首次建立时生效；对已存在会话，新增工具是否生效由源语义决定） */
  tools?: SessionToolsConfig;
  /** 权限模式（取值由 capabilities.prompt.permissionModes.available 约束） */
  permissionMode?: string;
  /** 反向权限问答通道；缺省 → driver 按 permissionModes.default 策略执行 */
  onPermissionRequest?: PermissionRequestHandler;
}

// ── 源接口 ──

export interface ISource {
  /** 源 ID（LatticeSourceMap 声明合并的 key） */
  readonly id: string;

  // 生命周期
  init(config?: Record<string, unknown>): Promise<void>;
  dispose(): Promise<void>;

  // 声明与握手（信任链前半段）
  /** 静态自述，无 I/O：info + declared capabilities */
  describe(): SourceManifest;
  /** 实探握手：SDK/CLI 版本、auth、（ACP）initialize；失败不抛错，落 available:false */
  handshake(): Promise<ResolvedManifest>;

  // 动态通道（快照之外的权威事实）
  listModels(): Promise<ModelInfo[]>;
  checkAuth(): Promise<AuthStatus>;

  /** 枚举源环境可发现资源（command/agent/skill/rule）。
   *  实现手段是源层私有知识；query.cwd 缺省 = 用户主目录；
   *  失败返回 []，不抛错；capabilities.resources=false 的源恒返 [] */
  listResources(query?: SourceResourceQuery): Promise<SourceResourceInfo[]>;

  // 核心交互：传 sessionId 继续对话，传 null 新建
  prompt(sessionId: string | null, message: ContentBlock[], opts?: PromptOpts): SourceEventStream;

  // 会话原子操作（能力缺口时抛 unsupported_operation / unsupported_option，纵深防御）
  forkSession(sessionId: string, atMessage?: string): Promise<string>;
  renameSession(sessionId: string, title: string): Promise<void>;
  destroySession(sessionId: string): Promise<void>;
}

// ── 声明合并源表（typed getSource：源包各自 merge 注入，源 ID 编译期收紧） ──

/**
 * @example 源包内声明合并：
 * ```ts
 * declare module '@qcqx/lattice-agent-protocol' {
 *   interface LatticeSourceMap { pi: PiSource }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LatticeSourceMap {}

/** 已注册源 ID（无声明合并时退化为 string） */
export type KnownSourceId = keyof LatticeSourceMap extends never
  ? string
  : keyof LatticeSourceMap & string;
