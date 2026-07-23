// ── 对话树数据模型 ──

export type NodeRole = 'user' | 'assistant' | 'tool' | 'system' | 'merge-summary' | 'aggregation';

export interface MessageContent {
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
  content: MessageContent[];
  timestamp: number;
  agentId?: string;
  metadata?: {
    toolCalls?: ToolCallRecord[];
    fileChanges?: FileChange[];
    tokensUsed?: number;
    model?: string;
    thinkingLevel?: string;
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

// ── Agent 事件 ──

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown; isError?: boolean }
  | { type: 'file_edit'; path: string; diff: string }
  | { type: 'terminal'; command: string; output?: string }
  | { type: 'done'; summary?: string }
  | { type: 'error'; message: string };

// ── Tool 定义 ──

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: ToolParameter[];
  /** 权限级别 */
  permission: 'allow' | 'ask' | 'deny';
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ── Tool Provider ──

export interface IToolProvider {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  init(config?: Record<string, unknown>): Promise<boolean>;
  getTools(): ToolDefinition[];
  execute(toolId: string, args: Record<string, unknown>): Promise<ToolResult>;
  dispose(): Promise<void>;
}

// ── 权限 ──

export type PermissionLevel = 'allow' | 'ask' | 'deny';

export interface PermissionRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  level: PermissionLevel;
  timestamp: number;
}

// ── 上下文 ──

export interface ContextLayer {
  layer: 'tools' | 'specs' | 'task' | 'history';
  content: string;
  tokens: number;
}

export interface BuiltContext {
  systemPrompt: string;
  layers: ContextLayer[];
  totalTokens: number;
  maxTokens: number;
}

// ── 工作流 ──

export interface SlashCommand {
  name: string;
  description: string;
  category: 'lattice' | 'agent' | 'branch' | 'system';
  execute: 'prompt' | 'tool' | 'workflow';
  template?: string;
  toolName?: string;
}

// ── Session 选项 ──

export interface SessionOpts {
  agentId: string;
  cwd: string;
  taskId?: string;
  model?: string;
  thinkingLevel?: 'low' | 'medium' | 'high';
}

// ── Merge 模式 ──

export type MergeMode = 'squash' | 'cherry-pick' | 'reference';
