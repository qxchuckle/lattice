/**
 * @qcqx/lattice-agent — 统一导出
 * 平台无关的 Agent 核心：对话树、工具注册、上下文引擎、工作流
 */

// ── 类型 ──
export type {
  NodeRole,
  NodeContent,
  ToolCallRecord,
  FileChange,
  ConversationNode,
  ConversationBranch,
  ConversationTree,
  AgentEvent,
  AgentToolParameter,
  AgentToolDefinition,
  AgentToolResult,
  IToolProvider,
  PermissionLevel,
  PermissionRequest,
  ContextLayer,
  BuiltContext,
  SlashCommand,
  MergeMode,
} from './types.js';

export type { SourceEvent } from '@qcqx/lattice-agent-protocol';

// ── Event Bus ──
export { EventBus } from './events/event-bus.js';
export type { LatticeAgentEvent } from './events/event-bus.js';

// ── Session Manager ──
export { SessionManager } from './session/session-manager.js';
export type { SessionStorage, StreamingState } from './session/session-manager.js';

// ── Session Repository（持久化层） ──
export { SessionRepository } from './session/session-repository.js';

// ── Conversation Controller（会话编排核心） ──
export { ConversationController } from './conversation/conversation-controller.js';
export { createSourceProfileProvider } from './conversation/source-profiles.js';
export type {
  SourceProfileProvider,
  SourceProfileProviderDeps,
} from './conversation/source-profiles.js';
export type {
  SessionContext,
  ConversationHooks,
  SendOpts,
  ConversationControllerDeps,
} from './conversation/conversation-controller.js';

// ── Prompt Composer（结构化输入展开） ──
export { composePrompt } from './prompt/prompt-composer.js';
export type { PromptComposerDeps, ComposedPrompt } from './prompt/prompt-composer.js';

// ── Session Index ──
export { SessionIndexManager } from './session/session-index.js';
export type { SessionIndex, SessionIndexEntry } from './session/session-index.js';

// ── Compaction ──
export { compactConversation, shouldCompact, filterCompactedNodes } from './session/compaction.js';
export type { CompactionOptions, CompactionResult, SummarizeFn } from './session/compaction.js';

// ── Tool Registry ──
export { ToolRegistry } from './tools/tool-registry.js';
export type { ToolFilter } from './tools/tool-registry.js';

// ── Permission Guard ──
export { PermissionGuard } from './permission/permission-guard.js';
export type { PermissionRule, ScopeConfig } from './permission/permission-guard.js';

// ── Agent Source（re-export 供 web 等消费方使用） ──
export {
  createAgentSource,
  createPiSource,
  createQoderSource,
  SourceRegistry,
  defineSource,
} from '@qcqx/lattice-agent-source';
export type {
  AgentSourceInstance,
  PiSourceOptions,
  QoderSourceOptions,
  SourceDriver,
} from '@qcqx/lattice-agent-source';

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
