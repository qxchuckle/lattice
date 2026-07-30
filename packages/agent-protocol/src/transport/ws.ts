/**
 * WebSocket 双向消息协议
 * 从 web/src/server/routes/agents.ts 提取 + 规范化
 */
import type { SourceEvent } from '../source/events.js';
import type {
  MergeMode,
  ConversationNode,
  ConversationBranch,
  NodeContent,
} from '../source/conversation.js';
import type { PromptSegment } from '../source/prompt-input.js';
import type { NodeCapabilities } from '../source/node-state.js';

// ═══════════════════════════════════════════
// 多端同步：共享类型
// ═══════════════════════════════════════════

/** 单条持久化变更（tree.event 载荷）；均为 upsert/幂等语义，快照兼容 */
export type TreeOp =
  | { kind: 'node'; node: ConversationNode }
  | { kind: 'nodes'; nodes: ConversationNode[] }
  | { kind: 'branch'; branch: ConversationBranch }
  | { kind: 'head'; headNodeId: string | null };

/** 客户端在场状态（ephemeral，不持久化，不占 rev） */
export interface PresenceState {
  connectionId: string;
  clientKind: string; // 'web' | 'app' | 'vscode' | ...
  userId?: string;
  displayName?: string;
  focusNodeId?: string | null;
  typing?: boolean;
  /** 该连接发起的在途请求 ID（供其他端显示"谁在生成"） */
  streamingRequestIds?: string[];
}

// ═══════════════════════════════════════════
// Client → Server
// ═══════════════════════════════════════════

export interface SessionCreateMessage {
  type: 'session.create';
  agentId?: string;
  cwd?: string;
  taskId?: string;
  treeId?: string;
}

export interface SessionSendMessage {
  type: 'session.send';
  sessionId: string;
  message: string;
  /** 结构化输入段（chip 编辑器）；提供时编排层展开生成最终 prompt，message 作为 displayText 兜底 */
  segments?: PromptSegment[];
  /** 父节点 ID（从哪个节点发起对话，null = 根节点） */
  parentNodeId?: string | null;
  /** 意图分支 ID（显式 fork 后在该分支继续时传入，跳过自动 fork） */
  branchId?: string;
  /** 客户端生成的请求 ID，用于并行流事件路由 */
  requestId?: string;
  /** 指定模型（不传则用源默认） */
  model?: string;
  /** 思考深度（取值由模型 tuning 规格约束；不传 = 源默认） */
  thinkingLevel?: string;
  /** 上下文窗口 tokens（取值由模型 tuning 规格约束；不传 = 源默认） */
  contextWindow?: number;
  /** 指定源（仅新第一层线程生效；追问时 server 沿祖先链解析线程源） */
  sourceId?: string;
}

/** 继续：对 interrupted 的 assistant 节点续写（不新增可见节点） */
export interface SessionContinueMessage {
  type: 'session.continue';
  sessionId: string;
  /** 要续写的 assistant 节点 ID */
  nodeId: string;
  requestId?: string;
}

/** 重试：对 user 节点丢弃所有后代并重新生成 */
export interface SessionRetryMessage {
  type: 'session.retry';
  sessionId: string;
  /** 要重试的 user 节点 ID */
  nodeId: string;
  requestId?: string;
}

/** 撤销：目标节点及后代标记为 undone（只读灰色） */
export interface SessionUndoMessage {
  type: 'session.undo';
  sessionId: string;
  /** 要撤销的节点 ID */
  nodeId: string;
}

/** 删除：撤销 + 隐藏（不渲染） */
export interface SessionDeleteMessage {
  type: 'session.delete';
  sessionId: string;
  /** 要删除的节点 ID */
  nodeId: string;
}

export interface SessionAbortMessage {
  type: 'session.abort';
  sessionId: string;
  /** 精确中止某个请求，不传则中止整个 session */
  requestId?: string;
}

export interface SessionDestroyMessage {
  type: 'session.destroy';
  sessionId: string;
}

export interface TreeForkMessage {
  type: 'tree.fork';
  treeId: string;
  nodeId: string;
  branchName?: string;
}

export interface TreeDeleteMessage {
  type: 'tree.delete';
  treeId: string;
  nodeIds: string[];
}

export interface TreeMergeMessage {
  type: 'tree.merge';
  treeId: string;
  branchId: string;
  targetNodeId: string;
  mode?: MergeMode;
}

export interface TreeSwitchHeadMessage {
  type: 'tree.switchHead';
  treeId: string;
  nodeId: string;
}

export interface TreeSetDefaultMessage {
  type: 'tree.setDefault';
  treeId: string;
  branchId: string;
}

export interface PermissionRespondMessage {
  type: 'permission.respond';
  requestId: string;
  allowed: boolean;
}

// ── 多端同步（per-tree 订阅） ──

/** 订阅一棵树；带 sinceRev 时 server 比对决定发快照或跳过 */
export interface TreeSubscribeMessage {
  type: 'tree.subscribe';
  treeId: string;
  sinceRev?: number;
  clientKind?: string;
}

/** 退订（离开对话；仅退订阅，不拆树资源） */
export interface TreeUnsubscribeMessage {
  type: 'tree.unsubscribe';
  treeId: string;
}

/** 上报本端 presence（节流发送） */
export interface PresenceUpdateMessage {
  type: 'presence.update';
  treeId: string;
  focusNodeId?: string | null;
  typing?: boolean;
}

/** 心跳 ping（server 回 pong；证明连接存活） */
export interface PingMessage {
  type: 'ping';
}

export type ClientMessage =
  | SessionCreateMessage
  | SessionSendMessage
  | SessionContinueMessage
  | SessionRetryMessage
  | SessionUndoMessage
  | SessionDeleteMessage
  | SessionAbortMessage
  | SessionDestroyMessage
  | TreeForkMessage
  | TreeDeleteMessage
  | TreeMergeMessage
  | TreeSwitchHeadMessage
  | TreeSetDefaultMessage
  | PermissionRespondMessage
  | TreeSubscribeMessage
  | TreeUnsubscribeMessage
  | PresenceUpdateMessage
  | PingMessage;

// ═══════════════════════════════════════════
// Server → Client
// ═══════════════════════════════════════════

export interface SessionCreatedMessage {
  type: 'session.created';
  sessionId: string;
  treeId: string;
  agentId: string;
}

export interface AgentEventMessage {
  type: 'event';
  sessionId: string;
  event: SourceEvent;
  /** 对应 client 的 requestId，用于并行流事件路由 */
  requestId?: string;
}

export interface SessionErrorMessage {
  type: 'session.error';
  sessionId: string;
  message: string;
  /** 关联的请求 ID（用于路由到对应 turn） */
  requestId?: string;
}

export interface SessionClosedMessage {
  type: 'session.closed';
  sessionId: string;
}

export interface TreeUpdatedMessage {
  type: 'tree.updated';
  treeId: string;
  headNodeId?: string | null;
  /** 本次持久化的 user 节点 ID（client 用于重试定位） */
  userNodeId?: string;
  /** 对应的 client requestId */
  requestId?: string;
}

export interface TreeErrorMessage {
  type: 'tree.error';
  treeId: string;
  message: string;
}

export interface PermissionRequestMessage {
  type: 'permission.request';
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  level: 'allow' | 'ask' | 'deny';
}

// ── 多端同步（per-tree 广播） ──

/** 全量快照（订阅时或 rev 缺口兜底） */
export interface TreeSnapshotMessage {
  type: 'tree.snapshot';
  treeId: string;
  rev: number;
  nodes: ConversationNode[];
  branches: ConversationBranch[];
  headNodeId: string | null;
  /**
   * turn 能力投影：turnId（user 节点 ID）→ 可执行操作。
   * server 计算并下发（派生数据不落盘），client 直接渲染不重算；
   * 与 server 命令入口守卫同源，故置灰的结构操作绕过 UI 也同样被拒。
   */
  turnCapabilities?: Record<string, NodeCapabilities>;
  /** 在途流式中间态（迟到加入者补齐）：requestId → 已生成内容 */
  streaming?: { requestId: string; parentId: string; content: NodeContent[] }[];
  /** 该树的会话列表元数据（捎带，免客户端每次变更再走 REST 拉列表） */
  conversation?: { treeId: string; title?: string; nodeCount: number; updatedAt: number };
  /** 快照构建起始时的服务端 Date.now()（新鲜度指示，供客户端调试/判旧；可选保持向后兼容） */
  snapshotTakenAt?: number;
  /** 构建时 rev + 1：客户端可据此检测 rev gap / 过时快照（可选保持向后兼容） */
  expectedNextRev?: number;
}

/** 单条 live 持久化变更（带 rev） */
export interface TreeEventMessage {
  type: 'tree.event';
  treeId: string;
  rev: number;
  op: TreeOp;
}

/** 命令被拒绝（只读守卫/并发冲突等）：发起端据此回滚乐观态或重拉 */
export interface TreeRejectMessage {
  type: 'tree.reject';
  treeId?: string;
  requestId: string;
  reason: string;
  /** 拒绝时服务端的 rev（供客户端判断是否基于过期状态，可选） */
  rev?: number;
}

/** 流式 delta（ephemeral，不占 rev，按 requestId 路由，广播给全部订阅者） */
export interface StreamEventMessage {
  type: 'stream.event';
  treeId: string;
  requestId: string;
  event: SourceEvent;
}

/** 流被中止（撤销/删除/显式停止/宽限到期） */
export interface StreamAbortedMessage {
  type: 'stream.aborted';
  treeId: string;
  requestId: string;
  reason: string;
}

/** 全量 presence 列表（精简：每次发完整列表，人数少无需增量） */
export interface PresenceStateMessage {
  type: 'presence.state';
  treeId: string;
  peers: PresenceState[];
}

/** 心跳 pong */
export interface PongMessage {
  type: 'pong';
}

export type ServerMessage =
  | SessionCreatedMessage
  | AgentEventMessage
  | SessionErrorMessage
  | SessionClosedMessage
  | TreeUpdatedMessage
  | TreeErrorMessage
  | PermissionRequestMessage
  | TreeSnapshotMessage
  | TreeEventMessage
  | TreeRejectMessage
  | StreamEventMessage
  | StreamAbortedMessage
  | PresenceStateMessage
  | PongMessage;
