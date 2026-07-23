/**
 * @qcqx/lattice-agent — 统一导出
 * 平台无关的 Agent 核心：对话树、工具注册、上下文引擎、工作流
 */

// ── 类型 ──
export type {
  NodeRole,
  MessageContent,
  ToolCallRecord,
  FileChange,
  ConversationNode,
  ConversationBranch,
  ConversationTree,
  AgentEvent,
  ToolParameter,
  ToolDefinition,
  ToolResult,
  IToolProvider,
  PermissionLevel,
  PermissionRequest,
  ContextLayer,
  BuiltContext,
  SlashCommand,
  SessionOpts,
  MergeMode,
} from './types.js';

// ── Event Bus ──
export { EventBus } from './events/event-bus.js';
export type { LatticeAgentEvent } from './events/event-bus.js';

// ── Session Manager ──
export { SessionManager } from './session/session-manager.js';
export type { SessionStorage } from './session/session-manager.js';

// ── Tool Registry ──
export { ToolRegistry } from './tools/tool-registry.js';
export type { ToolFilter } from './tools/tool-registry.js';

// ── Permission Guard ──
export { PermissionGuard } from './permission/permission-guard.js';
export type { PermissionRule, ScopeConfig } from './permission/permission-guard.js';

// ── Agent Core ──
export { AgentCore } from './core/agent-core.js';
export type { AgentCoreConfig, ActiveSession } from './core/agent-core.js';

// ── Context Engine ──
export { ContextEngine } from './context/context-engine.js';
export type { ContextEngineConfig, ContextSource } from './context/context-engine.js';

// ── Workflow Engine ──
export { WorkflowEngine } from './workflow/workflow-engine.js';
export type { WorkflowConfig, TriggerResult, SkillDefinition } from './workflow/workflow-engine.js';

// ── 工厂函数 ──
export { createLatticeAgent } from './factory.js';
export type { LatticeAgent, LatticeAgentDeps } from './factory.js';

// ── Lattice Workflow Tool Provider ──
export { LatticeWorkflowProvider } from './tools/lattice-provider.js';
export type { LatticeToolDeps } from './tools/lattice-provider.js';

// ── 外部 Agent 适配器 ──
export { ClaudeCodeAdapter, GenericPtyAdapter, AgentRegistry } from './core/external-agents.js';
export type { IExternalAgentAdapter, ExternalAgentConfig, ExternalAgentSession } from './core/external-agents.js';

// ── Qoder 适配器 ──
export { QoderAdapter } from './core/qoder-adapter.js';
export type { QoderAdapterConfig } from './core/qoder-adapter.js';
