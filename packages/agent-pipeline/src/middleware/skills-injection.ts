/**
 * inject 相位：skills 清单注入
 *
 * 注入的是「有哪些 skill 可用」的清单，不是正文——模型按需再读，避免撑爆上下文。
 * 落法交给策略层 `injectSystemPromptAddition`（append / override / 内联兜底的唯一落点）。
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
} from '@qcqx/lattice-agent-protocol';
import { injectSystemPromptAddition } from '../strategies/system-prompt.js';
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

export function createSkillsInjectionMiddleware(options: SkillsInjectionOptions): SourceMiddleware {
  const { capabilities: caps } = options;

  return {
    name: 'skills-injection',
    phase: 'inject',
    async transformPrompt(payload: PromptPayload): Promise<PromptPayload> {
      const skills = await options.listSkills();
      const appendix = (options.format ?? formatSkillsAppendix)(skills);
      if (!appendix) return payload;

      const applied = injectSystemPromptAddition(payload, caps.prompt.systemPrompt, appendix);
      if (applied.notice)
        options.onNotice?.({ code: 'system_prompt_inlined', message: applied.notice });
      // skills 清单是增强而非必需：源拒绝时跳过，不阻断本轮对话
      return applied.payload;
    },
  };
}
