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
  /** 客户端生成的请求 ID，用于并行流事件路由 */
  requestId?: string;
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
