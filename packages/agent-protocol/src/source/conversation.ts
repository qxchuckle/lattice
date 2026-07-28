/**
 * 对话树数据模型（跨层传输的持久化数据结构）
 * 从 agent 包迁入：web client / server / agent 三方消费
 */

export type NodeRole = 'user' | 'assistant' | 'tool' | 'system' | 'merge-summary' | 'aggregation';

/**
 * 对话节点内容块（判别联合）
 * 完整保存原始对话记录：文本/代码/思考/工具/终端/错误等
 */
export type NodeContent =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string; language?: string }
  | { type: 'diff'; text: string; path: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_call';
      toolId: string;
      name: string;
      args: Record<string, unknown>;
      status?: 'pending' | 'success' | 'error';
    }
  | { type: 'tool_result'; toolId: string; name: string; result?: unknown; isError?: boolean }
  | { type: 'terminal'; command: string; output?: string }
  | { type: 'error'; message: string; suggestion?: string };

export interface ToolCallRecord {
  toolId: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'success' | 'error';
  startedAt: number;
  endedAt?: number;
}

export interface FileChange {
  path: string;
  diff: string;
  status: 'pending' | 'accepted' | 'rejected';
}

/** 节点状态（树形对话操作体系） */
export type NodeStatus = 'active' | 'streaming' | 'interrupted' | 'undone' | 'hidden';

export interface ConversationNode {
  id: string;
  parentId: string | null;
  branchId: string;
  role: NodeRole;
  content: NodeContent[];
  timestamp: number;
  agentId?: string;
  /** 节点状态（默认 active） */
  status?: NodeStatus;
  metadata?: {
    toolCalls?: ToolCallRecord[];
    fileChanges?: FileChange[];
    tokensUsed?: number;
    model?: string;
    thinkingLevel?: string;
    /** 已被 compaction 压缩（加载时可跳过，用 aggregation 摘要替代） */
    compacted?: boolean;
    /** compaction 摘要来源节点 ID 列表 */
    compactedFrom?: string[];
    /** 源消息 ID（该节点对应源 session 中的消息 uuid，fork 截断点用） */
    sourceMessageId?: string;
  };
}

export interface ConversationBranch {
  id: string;
  name: string;
  forkPointId: string;
  isDefault: boolean;
  createdAt: number;
  description?: string;
  /** 该分支的源 session ID（源自己生成，每个分支独立一个 session） */
  sourceSessionId?: string;
  agentId?: string;
  mergedAt?: number;
}

export interface ConversationTree {
  id: string;
  taskId?: string;
  title?: string;
  branches: ConversationBranch[];
  headNodeId: string | null;
  defaultBranchId: string;
  createdAt: number;
  updatedAt: number;
}

/** 分支合并模式 */
export type MergeMode = 'squash' | 'cherry-pick' | 'reference';

// ── 权限（WS 传输） ──

export type PermissionLevel = 'allow' | 'ask' | 'deny';

export interface PermissionRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  level: PermissionLevel;
  timestamp: number;
}

// ── 会话配置（UI 层构建） ──

export interface AgentSessionOpts {
  agentId: string;
  cwd: string;
  taskId?: string;
  model?: string;
  thinkingLevel?: 'low' | 'medium' | 'high';
}
