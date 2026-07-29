/**
 * SourceProfile — 一次性把「源能力」解析成「宿主行为」
 *
 * 握手产物（ResolvedManifest，会话期冻结）进来，出来的是：
 * - plans：各能力轴的执行计划（查表结果，非 if 链）
 * - middlewares：该源需要的 polyfill 管线（能力缺口补齐，按源装配）
 * - projection：投影上下文（喂 protocol 的 projectNodeCapabilities，UI 与守卫同源）
 *
 * 消费方只认 profile，不再各自读 capabilities 做判断——这是「减少 if/else 硬编码」的落点：
 * 能力判定集中在解析期一次完成，运行期只查表。
 */
import type {
  ResolvedManifest,
  SourceCapabilities,
  SourceMiddleware,
  NodeCapabilityContext,
  ModelInfo,
} from '@qcqx/lattice-agent-protocol';
import { planCompaction, type CompactionPlan } from './strategies/compaction.js';
import { planSlash, type SlashPlan } from './strategies/slash.js';
import { planToolInjection, type ToolInjectionPlan } from './strategies/models.js';
import { forkShape, type ForkShape } from './strategies/fork.js';
import { createNormalizeMiddleware, type PipelineNotice } from './middleware/normalize.js';
import {
  createSlashExpansionMiddleware,
  type SlashExpansionOptions,
} from './middleware/slash-expansion.js';
import {
  createSkillsInjectionMiddleware,
  type SkillDescriptor,
} from './middleware/skills-injection.js';
import { createToolSemanticMiddleware } from './middleware/tool-semantic.js';
import { createCapabilityGuardMiddleware } from './middleware/capability-guard.js';

export interface SourcePlans {
  fork: ForkShape;
  compaction: CompactionPlan;
  slash: SlashPlan;
  toolInjection: ToolInjectionPlan;
  /** skills 清单策略：宿主枚举清单时是否需把源级 skills 也罗列进去
   *  （源已原生注入自己的 skills → false，否则双份清单） */
  skills: { includeSourceSkills: boolean };
}

export interface SourceProfile {
  sourceId: string;
  /** 握手核准后的能力（verified，非 declared） */
  capabilities: SourceCapabilities;
  /** 源当前是否可用（认证/握手结果；不可用时宿主应禁用入口而非试探） */
  available: boolean;
  plans: SourcePlans;
  /** 该源的 polyfill 管线（含通用 normalize/guard，按相位有序） */
  middlewares: SourceMiddleware[];
  /** 节点能力投影上下文（server 计算 + 随 DTO 下发；client 只渲染） */
  projection: NodeCapabilityContext;
  /** 握手期的降准留痕（声明与实探不符），供诊断面板呈现 */
  downgrades: ResolvedManifest['downgrades'];
}

export interface ResolveProfileOptions {
  /** slash 展开模板解析器；缺省 = 不装配展开 middleware（宿主自行在更上层展开） */
  resolveCommandTemplate?: SlashExpansionOptions['resolveTemplate'];
  /** slash 展开标记文案 */
  commandLabel?: string;
  /** 可用 skill 清单；缺省 = 不装配 skills 注入 */
  listSkills?: () => Promise<SkillDescriptor[]>;
  /** skills 清单文案覆写（宿主提示词风格） */
  formatSkills?: (skills: readonly SkillDescriptor[]) => string;
  /** 模型目录（guard 的 catalog 校验用；缺省跳过） */
  catalog?: ModelInfo[];
  /** 降级/丢弃提示回调 */
  onNotice?: (notice: PipelineNotice) => void;
}

/**
 * 解析 profile。装配规则：
 * - normalize / tool-semantic / capability-guard：全源通用
 *   （归一化与明示降级 / 事件语义富化 / 纵深防御）
 * - slash-expansion：仅 slash 计划为 host-expand 且宿主提供了模板解析器
 * - skills-injection：宿主提供了清单就装（nativeInjection 只影响清单内容，不影响是否注入）
 */
export function resolveSourceProfile(
  manifest: ResolvedManifest,
  options: ResolveProfileOptions = {},
): SourceProfile {
  const caps = manifest.capabilities;
  const plans: SourcePlans = {
    fork: forkShape(caps.session.fork),
    compaction: planCompaction(caps.context.compaction),
    slash: planSlash(caps.prompt.slashCommands),
    toolInjection: planToolInjection(caps.tools.injection),
    skills: { includeSourceSkills: !caps.skills.nativeInjection },
  };

  const middlewares: SourceMiddleware[] = [
    createNormalizeMiddleware({ capabilities: caps, onNotice: options.onNotice }),
    createToolSemanticMiddleware(caps),
  ];

  if (plans.slash.kind === 'host-expand' && options.resolveCommandTemplate) {
    middlewares.push(
      createSlashExpansionMiddleware({
        resolveTemplate: options.resolveCommandTemplate,
        label: options.commandLabel,
      }),
    );
  }

  if (options.listSkills) {
    // 总是装配：宿主清单与源自带清单是两件事（见 skills-injection 文件头易错点）
    middlewares.push(
      createSkillsInjectionMiddleware({
        capabilities: caps,
        listSkills: options.listSkills,
        format: options.formatSkills,
        onNotice: options.onNotice,
      }),
    );
  }

  middlewares.push(
    createCapabilityGuardMiddleware({
      capabilities: caps,
      catalog: options.catalog,
      onNotice: options.onNotice,
    }),
  );

  return {
    sourceId: manifest.info.id,
    capabilities: caps,
    available: manifest.available,
    plans,
    middlewares,
    projection: { fork: caps.session.fork },
    downgrades: manifest.downgrades,
  };
}
