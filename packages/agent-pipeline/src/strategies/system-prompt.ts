/**
 * systemPrompt 策略表：宿主想追加/替换指令 → 走哪条通道
 *
 * 三种落法：
 * - pass-through：源支持所需模式，直接进 PromptOpts.systemPrompt
 * - inline-fallback：源不支持该模式（如 append=false）→ 把文本并入首条用户消息
 *   （降级但不静默：计划带 notice，宿主呈现）
 * - reject：override 请求碰上不可覆盖的源 → 拒绝，不假装成功
 *
 * 穷尽轴是「请求模式」（Record<RequestKind, Planner>）；能力侧是 boolean，类型已穷尽。
 */
import type { SystemPromptCapability, SystemPromptConfig } from '@qcqx/lattice-agent-protocol';

export type SystemPromptRequest =
  | { kind: 'source-default' }
  | { kind: 'append'; additional: string }
  | { kind: 'override'; prompt: string };

export type SystemPromptRequestKind = SystemPromptRequest['kind'];

export type SystemPromptPlan =
  | { kind: 'pass-through'; config: SystemPromptConfig }
  | { kind: 'inline-fallback'; text: string; notice: string }
  | { kind: 'reject'; capabilityPath: string; reason: string };

const SYSTEM_PROMPT_PLANNERS: Record<
  SystemPromptRequestKind,
  (req: SystemPromptRequest, cap: SystemPromptCapability) => SystemPromptPlan
> = {
  'source-default': () => ({ kind: 'pass-through', config: { mode: 'source-default' } }),

  append: (req, cap) => {
    const additional = req.kind === 'append' ? req.additional : '';
    if (cap.append) return { kind: 'pass-through', config: { mode: 'append', additional } };
    // 源不支持 append：override 也不能用——覆盖会丢掉不可读的内置提示词（builtin != 'none'）
    if (cap.override && cap.builtin === 'none') {
      return { kind: 'pass-through', config: { mode: 'override', prompt: additional } };
    }
    return {
      kind: 'inline-fallback',
      text: additional,
      notice: '该源不支持追加 system prompt，附加指令已并入本轮消息正文',
    };
  },

  override: (req, cap) => {
    const prompt = req.kind === 'override' ? req.prompt : '';
    if (cap.override) return { kind: 'pass-through', config: { mode: 'override', prompt } };
    return {
      kind: 'reject',
      capabilityPath: 'prompt.systemPrompt.override',
      reason: '该源不支持替换 system prompt',
    };
  },
};

export function planSystemPrompt(
  cap: SystemPromptCapability,
  req: SystemPromptRequest,
): SystemPromptPlan {
  return SYSTEM_PROMPT_PLANNERS[req.kind](req, cap);
}
