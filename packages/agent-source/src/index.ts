/**
 * @qcqx/lattice-agent-source — 统一导出
 *
 * 源抽象层：SourceDriver + defineSource 工厂 + 握手管线。
 * 契约类型一律从 @qcqx/lattice-agent-protocol 获取（本包不重复 re-export，
 * 破坏性重构后消灭双入口——单一真相在 protocol）。
 * 内置源（Pi / Qoder / ACP）已迁移至 @qcqx/lattice-agent-source-builtins。
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

// ── 契约常量（第三方 driver 需要） ──
export { CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';

// ── 握手管线（dot-path / manifest 组装纯函数；builtins 测试需要） ──
export {
  getPath,
  setPath,
  applyProbeOverrides,
  buildResolvedManifest,
  buildFailedManifest,
} from './handshake.js';

// ── 源发现 ──
export { scanSources, discoverAndRegister, readAgentConfig } from './source-discovery/index.js';
