/**
 * 策略表统一出口：能力形态 → 执行计划（全部为纯函数，可单测、可在 UI/server 共用）
 */
export {
  forkShape,
  planFork,
  executeForkPlan,
  type ForkShape,
  type ForkRequest,
  type ForkPlan,
  type ForkExecution,
} from './fork.js';

export {
  compactionShape,
  planCompaction,
  needsHostCompactionNotice,
  needsHostSummary,
  type CompactionShape,
  type CompactionPlan,
} from './compaction.js';

export { slashShape, planSlash, type SlashShape, type SlashPlan } from './slash.js';

export {
  planSystemPrompt,
  applySystemPromptRequest,
  injectSystemPromptAddition,
  type SystemPromptRequest,
  type SystemPromptRequestKind,
  type SystemPromptPlan,
  type SystemPromptApplication,
} from './system-prompt.js';

export {
  toolInjectionShape,
  planToolInjection,
  validateModel,
  allowsCustomModelId,
  type ToolInjectionShape,
  type ToolInjectionPlan,
  type ModelSelectionShape,
  type ModelValidation,
} from './models.js';
