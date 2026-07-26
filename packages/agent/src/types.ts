// ── 对话树数据模型（从 protocol re-export） ──

export type {
  NodeRole,
  NodeContent,
  ToolCallRecord,
  FileChange,
  ConversationNode,
  ConversationBranch,
  ConversationTree,
  MergeMode,
  PermissionLevel,
  PermissionRequest,
  AgentSessionOpts,
} from '@qcqx/lattice-agent-protocol';

// ── Agent 事件（统一使用 protocol 的 SourceEvent） ──

export type { SourceEvent, SourceEvent as AgentEvent } from '@qcqx/lattice-agent-protocol';

// ── Agent 内部工具定义（区别于 protocol 的 ToolDefinition） ──

export interface AgentToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
}

/** Agent 内部工具定义（带 id/权限，区别于 protocol 的源级 ToolDefinition） */
export interface AgentToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: AgentToolParameter[];
  /** 权限级别 */
  permission: 'allow' | 'ask' | 'deny';
}

export interface AgentToolResult {
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
  getTools(): AgentToolDefinition[];
  execute(toolId: string, args: Record<string, unknown>): Promise<AgentToolResult>;
  dispose(): Promise<void>;
}

// ── 权限（从 protocol re-export） ──

// PermissionLevel / PermissionRequest 已在上方对话树段 re-export

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

// ── Session 选项（从 protocol re-export） ──

// SessionOpts 已在上方对话树段 re-export

// ── Merge 模式（从 protocol re-export） ──

// MergeMode 已在上方对话树段 re-export
