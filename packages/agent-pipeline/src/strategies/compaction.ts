/**
 * context / compaction 策略表：源压缩能力 → 宿主职责
 *
 * 差异实证：Pi `trigger:'both'` 且事件带摘要与 token 数；Qoder 只有 token 数无摘要；
 * ACP 当前无压缩面。宿主要做的事随之不同——本表把「随之不同」变成查表而非 if 链。
 */
import type { CompactionCapability } from '@qcqx/lattice-agent-protocol';

export type CompactionShape = 'auto' | 'manual' | 'both' | 'none';

export function compactionShape(cap: CompactionCapability): CompactionShape {
  return cap === false ? 'none' : cap.trigger;
}

export type CompactionPlan =
  /** 源自动压缩：宿主只呈现 compaction 事件，不参与决策 */
  | { kind: 'observe'; reportsSummary: boolean; reportsTokens: boolean }
  /** 源提供机制但不自动：宿主需在阈值处显式触发（触发通道为源私有，经 prompt 指令或源命令） */
  | { kind: 'host-trigger'; reportsSummary: boolean; reportsTokens: boolean }
  /** 二者皆可：自动兜底 + 宿主可主动触发 */
  | { kind: 'observe-and-trigger'; reportsSummary: boolean; reportsTokens: boolean }
  /** 源不压缩：溢出即报错，宿主自理（截断/摘要/拒绝），且必须自行呈现 */
  | { kind: 'host-polyfill' };

const COMPACTION_PLANNERS: Record<
  CompactionShape,
  (cap: Exclude<CompactionCapability, false> | null) => CompactionPlan
> = {
  auto: (cap) => ({
    kind: 'observe',
    reportsSummary: cap?.reportsSummary ?? false,
    reportsTokens: cap?.reportsTokens ?? false,
  }),
  manual: (cap) => ({
    kind: 'host-trigger',
    reportsSummary: cap?.reportsSummary ?? false,
    reportsTokens: cap?.reportsTokens ?? false,
  }),
  both: (cap) => ({
    kind: 'observe-and-trigger',
    reportsSummary: cap?.reportsSummary ?? false,
    reportsTokens: cap?.reportsTokens ?? false,
  }),
  none: () => ({ kind: 'host-polyfill' }),
};

export function planCompaction(cap: CompactionCapability): CompactionPlan {
  return COMPACTION_PLANNERS[compactionShape(cap)](cap === false ? null : cap);
}

/** 宿主是否需要自行呈现「已压缩」提示（源不发 compaction 事件时） */
export function needsHostCompactionNotice(plan: CompactionPlan): boolean {
  return plan.kind === 'host-polyfill';
}

/** 宿主是否需要自行生成摘要文案（源压缩但不报摘要，如 Qoder） */
export function needsHostSummary(plan: CompactionPlan): boolean {
  return plan.kind !== 'host-polyfill' && !plan.reportsSummary;
}
