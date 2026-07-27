/**
 * @qcqx/lattice-agent-source — 统一导出
 *
 * 源抽象层：标准化 AI 源交互接口，内置 Pi / Qoder 兼容。
 */

// ── 类型 ──
export type {
  // 事件
  SourceEvent,
  TokenUsage,
  SourceErrorCode,
  SourceErrorContext,
  // 内容
  ContentBlock,
  StandardMessage,
  // 模型
  ModelInfo,
  // 认证
  AuthRequirement,
  AuthStatus,
  // 能力
  SourceCapabilities,
  // SystemPrompt
  SystemPromptPolicy,
  SystemPromptConfig,
  // 工具
  ToolDefinition,
  ToolResult,
  ToolInfo,
  InjectToolsConfig,
  // Session
  PromptOpts,
  // 源接口
  ISource,
  SourceInfo,
  SourceToolsMap,
  AuthStatusMap,
  // 注册表
  ISourceRegistry,
  // 工厂
  AgentSourceConfig,
} from './types.js';

// ── 错误类 ──
export { SourceError } from './types.js';

// ── 注册表 ──
export { SourceRegistry } from './registry.js';

// ── 工厂 ──
export { createAgentSource } from './factory.js';
export type { AgentSourceInstance } from './factory.js';

// ── 内置源 ──
export { PiSource, QoderSource } from './sources/index.js';
export type { QoderSourceConfig } from './sources/index.js';
