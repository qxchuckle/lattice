/**
 * 对话树数据模型（跨层传输的持久化数据结构）
 * 从 agent 包迁入：web client / server / agent 三方消费
 */

export type NodeRole = 'user' | 'assistant' | 'tool' | 'system' | 'merge-summary' | 'aggregation';

export interface NodeContent {
  type: 'text' | 'code' | 'diff' | 'image';
  text?: string;
  language?: string;
  path?: string;
}

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

export interface ConversationNode {
  id: string;
  parentId: string | null;
  branchId: string;
  role: NodeRole;
  content: NodeContent[];
  timestamp: number;
  agentId?: string;
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
  };
}

export interface ConversationBranch {
  id: string;
  name: string;
  forkPointId: string;
  isDefault: boolean;
  createdAt: number;
  description?: string;
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
