/**
 * inject 相位：skills 清单注入（polyfill 类 —— 仅在源未原生注入时装配）
 *
 * 注入的是「有哪些 skill 可用」的清单，不是正文——模型按需再读，避免撑爆上下文。
 * 落法交给 systemPrompt 策略表（append / override / 内联兜底），本 middleware 不自行决策通道。
 */
import type {
  SourceCapabilities,
  SourceMiddleware,
  PromptPayload,
  SystemPromptConfig,
} from '@qcqx/lattice-agent-protocol';
import { planSystemPrompt } from '../strategies/system-prompt.js';
import type { PipelineNotice } from './normalize.js';

export interface SkillDescriptor {
  name: string;
  description?: string;
}

export interface SkillsInjectionOptions {
  capabilities: SourceCapabilities;
  /** 可用 skill 清单（宿主聚合本地 + 源级；异步以便懒加载/缓存） */
  listSkills: () => Promise<SkillDescriptor[]>;
  onNotice?: (notice: PipelineNotice) => void;
}

/** 清单文案：`<available_skills>` 包裹，与主流 agent 的 skill 提示形态一致 */
export function formatSkillsAppendix(skills: readonly SkillDescriptor[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- ${s.name}${s.description ? `：${s.description}` : ''}`);
  return `<available_skills>\n${lines.join('\n')}\n</available_skills>`;
}

/** 合并两段 append 文本（已有 systemPrompt.append 请求时不覆盖宿主意图） */
function mergeAppend(existing: SystemPromptConfig | undefined, addition: string): string {
  if (existing?.mode === 'append') return `${existing.additional}\n\n${addition}`;
  return addition;
}

export function createSkillsInjectionMiddleware(
  options: SkillsInjectionOptions,
): SourceMiddleware | null {
  const { capabilities: caps } = options;
  // 源已自行注入（如 Pi buildSystemPrompt 的 <available_skills>）→ 不装配，避免双份清单
  if (caps.skills.nativeInjection) return null;

  return {
    name: 'skills-injection',
    phase: 'inject',
    async transformPrompt(payload: PromptPayload): Promise<PromptPayload> {
      const skills = await options.listSkills();
      const appendix = formatSkillsAppendix(skills);
      if (!appendix) return payload;

      const merged = mergeAppend(payload.opts.systemPrompt, appendix);
      const plan = planSystemPrompt(caps.prompt.systemPrompt, {
        kind: 'append',
        additional: merged,
      });
      switch (plan.kind) {
        case 'pass-through':
          return { ...payload, opts: { ...payload.opts, systemPrompt: plan.config } };
        case 'inline-fallback': {
          options.onNotice?.({ code: 'system_prompt_inlined', message: plan.notice });
          return {
            ...payload,
            message: [{ type: 'text', text: plan.text }, ...payload.message],
          };
        }
        case 'reject':
          // skills 清单是增强而非必需：拒绝即跳过（不阻断本轮对话）
          return payload;
      }
    },
  };
}
