/**
 * @qcqx/lattice-agent-pipeline — 能力消费层
 *
 * 定位：把「源声明了什么能力」翻译成「宿主该怎么做」。lattice 无关——
 * `protocol + source + pipeline` 三包 + 一层 session 管理 = 完整 agent host。
 *
 * 三块内容：
 * - 策略表（strategies/）：能力形态 → 执行计划，`Record<Shape, Planner>` 编译期穷尽
 * - 管线（pipeline.ts）：middleware 四相位编排 + 事件流透明包装
 * - 通用 middleware（middleware/）：normalize / slash 展开 / skills 注入 / 能力守卫
 * 另有反向通道的权限闸门（permission-gate.ts）：问答不在事件流上，middleware 拦不到。
 *
 * 依赖方向：只依赖 protocol（不依赖 agent-source —— 消费 ISource 接口而非源实现）。
 */

// 策略表
export * from './strategies/index.js';

// profile 解析（能力 → 计划 + 管线装配 + 投影）
export {
  resolveSourceProfile,
  type SourceProfile,
  type SourcePlans,
  type ResolveProfileOptions,
} from './profile.js';

// 管线 runner
export {
  runPrompt,
  applyPromptMiddlewares,
  transformEvents,
  sortMiddlewares,
  type RunPromptArgs,
} from './pipeline.js';

// 通用 middleware
export {
  createNormalizeMiddleware,
  type NormalizeOptions,
  type PipelineNotice,
} from './middleware/normalize.js';
export {
  createSlashExpansionMiddleware,
  parseSlashCommand,
  formatExpansion,
  type SlashExpansionOptions,
} from './middleware/slash-expansion.js';
export {
  createSkillsInjectionMiddleware,
  formatSkillsAppendix,
  type SkillDescriptor,
  type SkillsInjectionOptions,
} from './middleware/skills-injection.js';
export {
  createCapabilityGuardMiddleware,
  type CapabilityGuardOptions,
} from './middleware/capability-guard.js';
export { createToolSemanticMiddleware } from './middleware/tool-semantic.js';

// 反向通道：权限闸门（声明式策略 → onPermissionRequest 回调）
export {
  createPermissionGate,
  type PermissionRule,
  type PermissionGateOptions,
} from './permission-gate.js';

// 错误
export { PipelineError, type PipelineErrorCode, type PipelineErrorContext } from './errors.js';
