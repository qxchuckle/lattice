/**
 * slash 命令策略表：源是否原生解释 `/cmd args`
 *
 * 发现（有哪些命令）归 resources.kinds 含 'command'；本轴只管解释。
 * host-expand 形态 → 装配 slash 展开 middleware（polyfill 类，按源装配）。
 */
import type { SlashCommandsCapability } from '@qcqx/lattice-agent-protocol';

export type SlashShape = 'native' | 'host-expand';

export function slashShape(cap: SlashCommandsCapability): SlashShape {
  if (cap === false) return 'host-expand';
  return cap.interpret ? 'native' : 'host-expand';
}

export type SlashPlan =
  /** 源自行解释：宿主原样透传 slash 文本（Pi） */
  | { kind: 'native' }
  /** 宿主负责展开为模板全文（Qoder / ACP）；展开不到的命令按普通文本透传 */
  | { kind: 'host-expand'; capabilityPath: 'prompt.slashCommands' };

const SLASH_PLANNERS: Record<SlashShape, () => SlashPlan> = {
  native: () => ({ kind: 'native' }),
  'host-expand': () => ({ kind: 'host-expand', capabilityPath: 'prompt.slashCommands' }),
};

export function planSlash(cap: SlashCommandsCapability): SlashPlan {
  return SLASH_PLANNERS[slashShape(cap)]();
}
