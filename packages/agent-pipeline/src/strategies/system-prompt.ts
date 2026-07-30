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
import type {
  ContentBlock,
  PromptPayload,
  SystemPromptCapability,
  SystemPromptConfig,
} from '@qcqx/lattice-agent-protocol';

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

// ── 计划执行（唯一落点：所有需要“把指令送进去”的调用方均经此，避免各自写 switch） ──

export interface SystemPromptApplication {
  /** 应用后的 payload（未变时为入参原对象） */
  payload: PromptPayload;
  /** 降级为消息正文时的提示（宿主必须呈现）；精确落法时缺省 */
  notice?: string;
  /** 源能力不支持且无法内联 → 未应用（调用方决定报错还是跳过） */
  rejection?: { capabilityPath: string; reason: string };
}

/**
 * 执行一个 systemPrompt 请求：查表得计划 → 落到 opts 或内联进消息正文。
 * 不抛错——拒绝以 `rejection` 返回，由调用方按语义决定（guard 抛错 / 增强类跳过）。
 */
export function applySystemPromptRequest(
  payload: PromptPayload,
  cap: SystemPromptCapability,
  req: SystemPromptRequest,
): SystemPromptApplication {
  const plan = planSystemPrompt(cap, req);
  switch (plan.kind) {
    case 'pass-through':
      return { payload: { ...payload, opts: { ...payload.opts, systemPrompt: plan.config } } };
    case 'inline-fallback': {
      const { systemPrompt: _dropped, ...opts } = payload.opts;
      const message: ContentBlock[] = plan.text
        ? [{ type: 'text', text: plan.text }, ...payload.message]
        : payload.message;
      return { payload: { ...payload, message, opts }, notice: plan.notice };
    }
    case 'reject':
      return {
        payload,
        rejection: { capabilityPath: plan.capabilityPath, reason: plan.reason },
      };
  }
}

/**
 * 追加一段指令（skills 清单 / 任务上下文等“叠加类”注入）。
 * 与已有 append 段合并而非覆盖，保证多个注入 middleware 不互相踩。
 */
export function injectSystemPromptAddition(
  payload: PromptPayload,
  cap: SystemPromptCapability,
  addition: string,
): SystemPromptApplication {
  const existing = payload.opts.systemPrompt;
  const merged = existing?.mode === 'append' ? `${existing.additional}\n\n${addition}` : addition;
  return applySystemPromptRequest(payload, cap, { kind: 'append', additional: merged });
}
