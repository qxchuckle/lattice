/**
 * 会话编排层的公共类型（controller / turn-runner / tree-ops / tree-runtime 共用）
 *
 * 单独成文件的理由：这些类型被四个实现文件互相引用，放在任一实现里都会造成循环导入。
 */
import type {
  SourceEvent,
  ISourceRegistry,
  PromptSegment,
  PermissionRequestHandler,
  ConversationBranch,
  QueuedMessage,
} from '@qcqx/lattice-agent-protocol';
import type { SessionManager } from '../session/session-manager.js';
import type { PromptComposerDeps } from '../prompt/prompt-composer.js';
import type { SourceProfileProvider } from './source-profiles.js';
import type { TreeRuntimeState } from './runtime-state.js';
import type { SessionState } from './session-state.js';
import type { EventBus } from '../events/event-bus.js';

/** 每个 WS session 的运行时状态（轻量：连接身份 + 当前树）；锁域在 TreeRuntime */
export interface SessionContext {
  sessionId: string;
  sourceId: string;
  /** 当前树 id（保留：agent 内及下游直接读取；阶段真相在 state） */
  treeId: string | null;
  /** 会话生命周期状态（session-state.ts 状态机推进，替代 treeId 判空的隐式表达） */
  state: SessionState;
}

/**
 * per-tree 运行时锁域（多连接共享）：同一 treeId 的多个连接共用同一 TreeRuntime，
 * 保证同源 session 不并发 prompt；树创建前用 `session:<sid>` bootstrap key 兜底（单连接）。
 */
export interface TreeRuntime {
  /** 进行中请求：requestId → AbortController */
  abortControllers: Map<string, AbortController>;
  /** 树结构变更串行锁（快操作：fork/addNode/标记，不含流式） */
  queue: Promise<void>;
  /** 分支级流式队列：branchId → 队尾 Promise（同分支串行，跨分支并行） */
  streamQueues: Map<string, Promise<void>>;
  /** 运行阶段（runtime-state.ts 状态机推进：queue × stream 两个正交维度） */
  state: TreeRuntimeState;
  /** 最近一次任务/流的错误（原先被无痕吞掉；配合 state.*.failed 观测） */
  lastError?: unknown;
  /** 排队中的用户消息（per-tree，多端共享；streaming 期间用户提交的待发消息） */
  pendingMessages: QueuedMessage[];
  /** 正在 dispatch 的排队消息 ID（防重入标记） */
  pendingDispatching: string | null;
  /** 排队消息排序计数器（单调递增，不回收，避免删除后 order 碰撞） */
  pendingOrderCounter: number;
}

/** 传输层注入的回调（controller 不感知 WS） */
export interface ConversationHooks {
  onEvent: (event: SourceEvent, requestId: string) => void;
  onError: (message: string, requestId?: string) => void;
  onTreeUpdated: (treeId: string, headNodeId: string | null, requestId?: string) => void;
  /** 首条消息懒创建树后触发（传输层发 session.created） */
  onTreeCreated?: (treeId: string) => void;
  /** 命令被状态机/只读守卫拒绝（发起端据此回滚乐观态或重拉，避免静默发散） */
  onReject?: (requestId: string | undefined, reason: string) => void;
  /** 在途流被中止（撤销/删除子树时）：广播给订阅端停渲染 */
  onStreamAborted?: (treeId: string, requestId: string, reason: string) => void;
}

/**
 * fork 结果：分支已建，但源侧上下文是否真的继承下来是另一事。
 *
 * 为何不直接返 branch：源侧 forkSession 可能失败（会话过期/锚点不存在/能力不足），
 * 此时新分支从空白开始——用户必须知道，否则会因为 AI “完全不记得前文”而困惑。
 */
export interface ForkOutcome {
  branch: ConversationBranch;
  /** 源侧上下文是否随分支继承（false = 新分支无历史） */
  contextCarried: boolean;
  /** 降级提示（contextCarried=false 且因失败而非本来无会话时提供） */
  notice?: string;
}

export interface SendOpts {
  parentNodeId?: string | null;
  branchId?: string;
  requestId: string;
  model?: string;
  /** 思考深度/上下文窗口（取值由模型 tuning 规格约束，透传源） */
  thinkingLevel?: string;
  contextWindow?: number;
  /** 指定源（仅新第一层线程生效；追问时沿祖先链解析线程源） */
  sourceId?: string;
  /** 结构化输入段（chip 编辑器）；提供时编排层展开，message 作 displayText 兜底 */
  segments?: PromptSegment[];
}

/** 入队参数（传输层解析 queue.enqueue 后透传） */
export interface EnqueueOpts {
  content: string;
  segments?: PromptSegment[];
  /** 锚定的目标 turn（user 节点 ID）：在该 turn 的链路末端追加 */
  anchorTurnId: string;
  /** 投递模式（默认 queue：等当前 turn 结束后按序发送；steer：注入在途流） */
  mode?: 'queue' | 'steer';
  model?: string;
  thinkingLevel?: string;
  contextWindow?: number;
  sourceId?: string;
  /** 入队连接 ID（标记谁排的，供 UI 展示） */
  createdBy?: string;
}

export interface ConversationControllerDeps {
  session: SessionManager;
  /** 仅依赖源注册表抽象（protocol），不绑定具体源包 */
  sources: { registry: ISourceRegistry };
  /** 结构化输入展开依赖（本地命令模板/引用解析；缺省：命令透传 slash 文本、引用保留显示文本） */
  promptDeps?: PromptComposerDeps;
  /** 能力消费层（agent-pipeline）：按源提供策略与 middleware 管线。
   *  宿主侧的能力差异消化（skills 注入 / 图片降级 / 哨兵归一化 / 工具语义回填 / 守卫）全走它 */
  profiles: SourceProfileProvider;
  /** 反向权限问答（源问→宿主答）；缺省时 driver 按源的 permissionModes.default 策略执行 */
  onPermissionRequest?: PermissionRequestHandler;
  /** 事件总线（队列变更 emit `queue:changed`，传输层订阅后广播；缺省时不通知） */
  events?: EventBus;
}
