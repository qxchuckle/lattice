/**
 * inject 相位：skills 清单注入
 *
 * 注入的是「有哪些 skill 可用」的清单，不是正文——模型按需再读，避免撑爆上下文。
 * 落法交给 systemPrompt 策略表（append / override / 内联兜底），本 middleware 不自行决策通道。
 *
 * 与 `capabilities.skills.nativeInjection` 的关系（易错点）：
 * 该声明只说明「源已把**自己的** skills 列进了 system prompt」，不意味着宿主清单无需注入。
 * 故本 middleware 总是装配；是否把源级 skills 也罗列进去由宿主的 listSkills 决定
 * （profile.plans.skills.includeSourceSkills 给出建议）——防的就是「源原生注入 → 宿主本地 skill 丢了」这类回归。
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
  /** 文案格式化覆写（宿主有自己的提示词风格时）；缺省用内置清单形态 */
  format?: (skills: readonly SkillDescriptor[]) => string;
  onNotice?: (notice: PipelineNotice) => void;
}

/**
 * 清单文案：引导语 + `<available_skills>` 包裹的结构化条目。
 * 引导语是必需的——只给清单不告知「怎么用」时，模型往往不去读 skill 正文。
 */
export function formatSkillsAppendix(skills: readonly SkillDescriptor[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- name: ${s.name}\n  description: ${s.description ?? ''}`);
  return [
    'The following skills provide specialized instructions for specific tasks.',
    'Use the read tool to load a skill file when the task matches its description.',
    '',
    '<available_skills>',
    ...lines,
    '</available_skills>',
  ].join('\n');
}

/** 合并两段 append 文本（已有 systemPrompt.append 请求时不覆盖宿主意图） */
function mergeAppend(existing: SystemPromptConfig | undefined, addition: string): string {
  if (existing?.mode === 'append') return `${existing.additional}\n\n${addition}`;
  return addition;
}

export function createSkillsInjectionMiddleware(options: SkillsInjectionOptions): SourceMiddleware {
  const { capabilities: caps } = options;

  return {
    name: 'skills-injection',
    phase: 'inject',
    async transformPrompt(payload: PromptPayload): Promise<PromptPayload> {
      const skills = await options.listSkills();
      const appendix = (options.format ?? formatSkillsAppendix)(skills);
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
