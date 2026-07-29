/**
 * 类型桶导出（保持 ../types.js 路径兼容）
 * 实际定义拆分在 ./types/ 子目录
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
  SourceToolSemantic,
  SourceCapabilities,
  SystemPromptPolicy,
  SystemPromptConfig,
  PromptOpts,
  ISource,
  SourceInfo,
  SourceToolsMap,
  AuthStatusMap,
  ISourceRegistry,
  AgentSourceConfig,
  SourceResourceKind,
  SourceResourceInfo,
  SourceResourceQuery,
  SourceResourcesMap,
} from './types/index.js';

export { SourceError } from './types/index.js';
