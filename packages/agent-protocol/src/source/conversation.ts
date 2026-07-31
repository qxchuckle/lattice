/**
 * 对话树数据模型（跨层传输的持久化数据结构）
 * 从 agent 包迁入：web client / server / agent 三方消费
 */
import type { TokenUsage } from './events.js';
import type { PromptSegment } from './prompt-input.js';
import type { SourceToolSemantic } from './tools.js';

export type NodeRole = 'user' | 'assistant' | 'tool' | 'system' | 'merge-summary' | 'aggregation';

/**
 * 对话节点内容块（判别联合）
 * 完整保存原始对话记录：文本/代码/思考/工具/终端/错误等
 */
export type NodeContent =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string; language?: string }
  | {
      type: 'diff';
      /** diff 正文（源不一定返回，缺失时仅凭 path 呈现改动事实） */
      text?: string;
      path: string;
      kind?: 'create' | 'edit' | 'delete';
    }
  | { type: 'image'; data: string; mimeType: string }
  | {
      type: 'thinking';
      text: string;
      /** 首 delta 时间（来自事件 ts，非 UI 计时——reload 后不丢） */
      startedAt?: number;
      /** 末 delta 时间（有值 = 思考完成） */
      endedAt?: number;
    }
  | {
      type: 'tool_call';
      toolId: string;
      name: string;
      args: Record<string, unknown>;
      status?: 'pending' | 'success' | 'error';
      /** 工具语义（壳层按此渲染图标/卡片形态，不认识工具名） */
      semantic?: SourceToolSemantic;
      startedAt?: number;
      /** tool_result 到达时回填 */
      endedAt?: number;
    }
  | { type: 'tool_result'; toolId: string; name: string; result?: unknown; isError?: boolean }
  | { type: 'terminal'; command: string; output?: string }
  | { type: 'error'; message: string; suggestion?: string }
  /** 源内部上下文压缩标记（随流落盘，live/reload 呈现一致） */
  | { type: 'compaction'; trigger: 'auto' | 'manual'; preTokens?: number; summary?: string }
  /** 非致命提示（不影响节点状态投影，区别于 error 块） */
  | { type: 'notice'; level: 'info' | 'warning'; text: string };

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

/** 节点状态（树形对话操作体系）；error = 源报错落盘态（用户中止仍为 interrupted） */
export type NodeStatus = 'active' | 'streaming' | 'interrupted' | 'error' | 'undone' | 'hidden';

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
    /** 本轮 token 用量（done 事件落盘；input ≈ 当前上下文占用，reload 后展示用） */
    usage?: TokenUsage;
    model?: string;
    thinkingLevel?: string;
    /** 本轮选择的上下文窗口档位（tokens，tuning 规格约束） */
    contextWindow?: number;
    /** 已被 compaction 压缩（加载时可跳过，用 aggregation 摘要替代） */
    compacted?: boolean;
    /** compaction 摘要来源节点 ID 列表 */
    compactedFrom?: string[];
    /** 源消息 ID（该节点对应源 session 中的消息 uuid，fork 截断点用） */
    sourceMessageId?: string;
    /** 展开前的结构化输入（user 节点；UI 回显 chip 用，content 存展开后内容） */
    promptSegments?: PromptSegment[];
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
  /** 单调修订号：每次持久化结构/内容变更自增，多端同步用于对账/新鲜度判定（缺省视为 0） */
  rev?: number;
}

/** 分支合并模式 */
export type MergeMode = 'squash' | 'cherry-pick' | 'reference';

/**
 * 在途流式快照（崩溃恢复用）：流式期逐 delta 落盘，正常结束后清除。
 * 跳层流转（磁盘 → agent → REST → client 恢复中断 turn），故归 protocol 单一真相。
 */
export interface StreamingState {
  requestId: string;
  /** 流式回复所挂的父节点（user 节点）ID */
  parentId: string;
  role: 'assistant';
  startedAt: number;
  content: NodeContent[];
}

// ── 权限（WS 传输） ──

export type PermissionLevel = 'allow' | 'ask' | 'deny';

export interface PermissionRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  level: PermissionLevel;
  timestamp: number;
}
