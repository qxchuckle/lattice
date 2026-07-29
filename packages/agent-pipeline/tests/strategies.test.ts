/**
 * 策略表测试：能力形态 → 计划（穷尽性 + 边界语义）
 *
 * 重点锁定「永不静默降级」：能力不足时计划里必须带 notice 或明确 unsupported，
 * 不允许出现「悄悄换了语义还返回成功」的形态。
 */
import { describe, it, expect } from 'vitest';
import type { ForkCapability, CompactionCapability, ModelInfo } from '@qcqx/lattice-agent-protocol';
import {
  forkShape,
  planFork,
  executeForkPlan,
  compactionShape,
  planCompaction,
  needsHostSummary,
  needsHostCompactionNotice,
  slashShape,
  planSlash,
  planSystemPrompt,
  planToolInjection,
  validateModel,
  allowsCustomModelId,
  PipelineError,
} from '../src/index.js';
import { createFakeSource, PI_LIKE, QODER_LIKE, ACP_LIKE } from './fixtures.js';

describe('fork 策略表', () => {
  it('三种形态判别覆盖 ForkCapability 全域', () => {
    const cases: Array<[ForkCapability, string]> = [
      [{ atMessage: true }, 'at-message'],
      [{ atMessage: false }, 'session-only'],
      [false, 'none'],
    ];
    for (const [cap, shape] of cases) expect(forkShape(cap)).toBe(shape);
  });

  it('支持锚点 → 精确计划，锚点原样带上', () => {
    const plan = planFork({ atMessage: true }, { sessionId: 's1', atMessage: 'm7' });
    expect(plan).toEqual({ kind: 'precise', sessionId: 's1', atMessage: 'm7' });
  });

  it('不支持锚点但请求带锚点 → 近似计划，必须携带 notice 与被丢弃的锚点', () => {
    const plan = planFork({ atMessage: false }, { sessionId: 's1', atMessage: 'm7' });
    expect(plan.kind).toBe('whole-session');
    if (plan.kind !== 'whole-session') throw new Error('unreachable');
    expect(plan.droppedAnchor).toBe('m7');
    expect(plan.notice).toContain('锚点');
  });

  it('不支持锚点且请求无锚点 → 语义等价，判为精确（不误报降级）', () => {
    expect(planFork({ atMessage: false }, { sessionId: 's1' })).toEqual({
      kind: 'precise',
      sessionId: 's1',
    });
  });

  it('无 fork 能力 → unsupported，指向 session.fork 声明路径', () => {
    const plan = planFork(false, { sessionId: 's1' });
    expect(plan).toMatchObject({ kind: 'unsupported', capabilityPath: 'session.fork' });
  });

  it('执行精确计划：锚点传给源；近似计划：不传锚点并回传 notice', async () => {
    const { source, calls } = createFakeSource();
    const precise = await executeForkPlan(
      source,
      planFork({ atMessage: true }, { sessionId: 's1', atMessage: 'm7' }),
    );
    expect(calls.forks[0]).toEqual({ sessionId: 's1', atMessage: 'm7' });
    expect(precise.notices).toEqual([]);

    const approx = await executeForkPlan(
      source,
      planFork({ atMessage: false }, { sessionId: 's1', atMessage: 'm7' }),
    );
    expect(calls.forks[1]).toEqual({ sessionId: 's1', atMessage: undefined });
    expect(approx.notices).toHaveLength(1);
  });

  it('执行 unsupported 计划 → PipelineError（绕过门控时的纵深防御）', async () => {
    const { source } = createFakeSource();
    await expect(executeForkPlan(source, planFork(false, { sessionId: 's1' }))).rejects.toThrow(
      PipelineError,
    );
  });
});

describe('compaction 策略表', () => {
  it('四形态判别 + 计划映射', () => {
    const cases: Array<[CompactionCapability, string, string]> = [
      [{ trigger: 'auto', reportsSummary: true, reportsTokens: true }, 'auto', 'observe'],
      [{ trigger: 'manual', reportsSummary: true, reportsTokens: true }, 'manual', 'host-trigger'],
      [
        { trigger: 'both', reportsSummary: true, reportsTokens: true },
        'both',
        'observe-and-trigger',
      ],
      [false, 'none', 'host-polyfill'],
    ];
    for (const [cap, shape, kind] of cases) {
      expect(compactionShape(cap)).toBe(shape);
      expect(planCompaction(cap).kind).toBe(kind);
    }
  });

  it('Qoder 画像（压缩无摘要）→ 宿主需自行生成摘要文案', () => {
    const plan = planCompaction(QODER_LIKE.context.compaction);
    expect(needsHostSummary(plan)).toBe(true);
    expect(needsHostCompactionNotice(plan)).toBe(false);
  });

  it('Pi 画像（带摘要）→ 宿主无需补摘要；ACP 画像（无压缩）→ 宿主全包', () => {
    expect(needsHostSummary(planCompaction(PI_LIKE.context.compaction))).toBe(false);
    expect(needsHostCompactionNotice(planCompaction(ACP_LIKE.context.compaction))).toBe(true);
  });
});

describe('slash 策略表', () => {
  it('interpret=true → native；interpret=false 与 false → 宿主展开', () => {
    expect(slashShape({ interpret: true })).toBe('native');
    expect(slashShape({ interpret: false })).toBe('host-expand');
    expect(slashShape(false)).toBe('host-expand');
    expect(planSlash(false)).toMatchObject({ capabilityPath: 'prompt.slashCommands' });
  });
});

describe('systemPrompt 策略表', () => {
  const appendable = { builtin: 'opaque' as const, override: true, append: true };
  const overrideOnlyNoBuiltin = { builtin: 'none' as const, override: true, append: false };
  const overrideOnlyOpaque = { builtin: 'opaque' as const, override: true, append: false };
  const locked = { builtin: 'opaque' as const, override: false, append: false };

  it('支持 append → 直传', () => {
    expect(planSystemPrompt(appendable, { kind: 'append', additional: 'X' })).toEqual({
      kind: 'pass-through',
      config: { mode: 'append', additional: 'X' },
    });
  });

  it('无 append 但可覆盖且无内置 → 改走 override（等价无损）', () => {
    expect(planSystemPrompt(overrideOnlyNoBuiltin, { kind: 'append', additional: 'X' })).toEqual({
      kind: 'pass-through',
      config: { mode: 'override', prompt: 'X' },
    });
  });

  it('无 append 且内置不可读 → 内联兜底（不能覆盖，会丢内置提示词）', () => {
    const plan = planSystemPrompt(overrideOnlyOpaque, { kind: 'append', additional: 'X' });
    expect(plan).toMatchObject({ kind: 'inline-fallback', text: 'X' });
  });

  it('override 请求碰上不可覆盖的源 → reject（不假装成功）', () => {
    expect(planSystemPrompt(locked, { kind: 'override', prompt: 'X' })).toMatchObject({
      kind: 'reject',
      capabilityPath: 'prompt.systemPrompt.override',
    });
  });
});

describe('tools / models 策略表', () => {
  it('注入通道三形态', () => {
    expect(planToolInjection('in-process')).toEqual({ kind: 'direct', transport: 'in-process' });
    expect(planToolInjection('mcp-bridge')).toEqual({ kind: 'direct', transport: 'mcp-bridge' });
    expect(planToolInjection(false)).toMatchObject({ kind: 'drop' });
  });

  const catalog: ModelInfo[] = [
    {
      id: 'm1',
      displayName: 'M1',
      capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
  ];

  it('catalog 策略：目录内通过、目录外拒绝、目录为空放行（未就绪不误判）', () => {
    expect(validateModel({ policy: 'catalog', tuning: true }, 'm1', catalog).ok).toBe(true);
    expect(validateModel({ policy: 'catalog', tuning: true }, 'zzz', catalog)).toMatchObject({
      ok: false,
      capabilityPath: 'models.policy',
    });
    expect(validateModel({ policy: 'catalog', tuning: true }, 'zzz', []).ok).toBe(true);
  });

  it('open/hybrid 策略：任意 ID 放行，命中目录时回带模型信息', () => {
    expect(validateModel({ policy: 'open', tuning: true }, 'zzz', catalog)).toEqual({
      ok: true,
      resolved: null,
    });
    expect(validateModel({ policy: 'hybrid', tuning: true }, 'm1', catalog)).toEqual({
      ok: true,
      resolved: catalog[0],
    });
  });

  it('自定义模型输入仅在非 catalog 策略下允许（UI 与接口同一判定）', () => {
    expect(allowsCustomModelId({ policy: 'catalog', tuning: false })).toBe(false);
    expect(allowsCustomModelId({ policy: 'open', tuning: false })).toBe(true);
  });
});
