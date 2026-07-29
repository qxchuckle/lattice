/**
 * @qcqx/lattice-agent-source — 统一导出
 *
 * 源抽象层：SourceDriver + defineSource 工厂 + 内置 Pi / Qoder driver。
 * 契约类型一律从 @qcqx/lattice-agent-protocol 获取（本包不重复 re-export，
 * 破坏性重构后消灭双入口——单一真相在 protocol）。
 */

// ── driver 扩展点（第三方接入面） ──
export { defineSource } from './define-source.js';
export type {
  SourceDriver,
  DriverSessionHandle,
  DriverEvent,
  DriverEmit,
  DriverPromptOutcome,
  DriverProbeReport,
} from './driver.js';

// ── 错误类（运行时代码；taxonomy 在 protocol） ──
export { SourceError } from './types/error.js';
export type { SourceErrorCode, SourceErrorContext } from './types/error.js';

// ── 注册表 ──
export { SourceRegistry } from './registry.js';

// ── 工厂 ──
export { createAgentSource } from './factory.js';
export type { AgentSourceInstance } from './factory.js';

// ── 内置源 ──
export { createPiSource, createQoderSource } from './sources/index.js';
export type { PiSourceOptions, QoderSourceOptions } from './sources/index.js';
