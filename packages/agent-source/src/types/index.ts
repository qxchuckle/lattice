/**
 * 类型桶导出 — 契约类型统一从 @qcqx/lattice-agent-protocol re-export
 * SourceError 类保留在本包（运行时代码，非纯类型）
 */
export type {
  SourceEvent,
  TokenUsage,
  SourceErrorCode,
  SourceErrorContext,
  ContentBlock,
  StandardMessage,
  ModelInfo,
  AuthRequirement,
  AuthStatus,
  ToolDefinition,
  ToolResult,
  ToolInfo,
  InjectToolsConfig,
  SourceCapabilities,
  SystemPromptPolicy,
  SystemPromptConfig,
  SessionCreateOpts,
  ISource,
  SourceInfo,
  SourceToolsMap,
  AuthStatusMap,
  ISourceRegistry,
  AgentSourceConfig,
} from '@qcqx/lattice-agent-protocol';

export { SourceError } from './error.js';
