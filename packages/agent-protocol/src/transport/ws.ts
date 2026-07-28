/**
 * WebSocket 双向消息协议
 * 从 web/src/server/routes/agents.ts 提取 + 规范化
 */
import type { SourceEvent } from '../source/events.js';
import type { MergeMode } from '../source/conversation.js';

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
  /** 父节点 ID（从哪个节点发起对话，null = 根节点） */
  parentNodeId?: string | null;
  /** 意图分支 ID（显式 fork 后在该分支继续时传入，跳过自动 fork） */
  branchId?: string;
  /** 客户端生成的请求 ID，用于并行流事件路由 */
  requestId?: string;
  /** 指定模型（不传则用源默认） */
  model?: string;
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
  | PermissionRespondMessage;

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
  branch?: unknown;
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

export type ServerMessage =
  | SessionCreatedMessage
  | AgentEventMessage
  | SessionErrorMessage
  | SessionClosedMessage
  | TreeUpdatedMessage
  | TreeErrorMessage
  | PermissionRequestMessage;
