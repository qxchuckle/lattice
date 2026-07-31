/**
 * 错误分类体系测试（v2 语义）
 *
 * v2 核心模型：SourceError 透传 + 按边界包装——
 * - driver 可选主动抛 SourceError（工厂透传，不二次包装）；
 * - 其他异常按「哪个边界失败」赋语义：源设施边界（init/probe/握手/connect）
 *   → source_unavailable（state，retryable=false）；运行时边界 → unknown。
 * - 禁止按错误内容/文本/code 分类（classifyError 已删除）。
 */
import { describe, it, expect } from 'vitest';
import { errorCategory } from '@qcqx/lattice-agent-protocol';
import type { SourceEvent } from '@qcqx/lattice-agent-protocol';
import { SourceError } from '../src/types/error.js';
import { defineSource } from '../src/define-source.js';
import { createScriptedDriver } from '../src/testing/index.js';

const ctx = { sourceId: 'test', sourceName: 'Test', operation: 'handshake' as const };

async function collect(iter: AsyncIterable<SourceEvent>): Promise<SourceEvent[]> {
  const out: SourceEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

// ── taxonomy：source_unavailable（源级不可用，熔断依据） ──

describe('source_unavailable 错误码分类', () => {
  it('source_unavailable 属于 state 大类', () => {
    expect(errorCategory('source_unavailable')).toBe('state');
  });

  it('source_unavailable 的 retryable = false', () => {
    const err = new SourceError('source_unavailable', 'source down', ctx);
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('source_unavailable');
  });
});

// ── 工厂按边界包装（经 defineSource 公开接口可观测） ──

describe('工厂按边界包装', () => {
  it('init 失败（源设施边界）→ source_unavailable', async () => {
    const driver = {
      ...createScriptedDriver({ id: 'init-fail' }),
      init: async () => {
        throw new Error('config missing');
      },
    };
    const source = defineSource(driver);
    await expect(source.init()).rejects.toMatchObject({
      name: 'SourceError',
      code: 'source_unavailable',
      retryable: false,
    });
  });

  it('connect 最终失败（源设施边界，不可重试原生错误）→ error 事件 code=source_unavailable', async () => {
    const driver = {
      ...createScriptedDriver({ id: 'conn-fail' }),
      connect: async () => {
        throw new Error('binary not found');
      },
    };
    const source = defineSource(driver);
    await source.init();
    const events = await collect(source.prompt(null, [{ type: 'text', text: 'hi' }]));
    const err = events.find((e) => e.type === 'error')!;
    expect(err).toMatchObject({ code: 'source_unavailable', retryable: false });
  });

  it('prompt 运行时失败 → unknown（即使异常带 ERR_MODULE_NOT_FOUND 等 code 也不按内容特判）', async () => {
    const nodeError = new Error("Cannot find package 'x'");
    (nodeError as NodeJS.ErrnoException).code = 'ERR_MODULE_NOT_FOUND';
    const source = defineSource(createScriptedDriver({ id: 'prompt-fail', failWith: nodeError }));
    await source.init();
    const events = await collect(source.prompt(null, [{ type: 'text', text: 'hi' }]));
    const err = events.find((e) => e.type === 'error')!;
    expect(err).toMatchObject({ code: 'unknown', retryable: false });
  });

  it('SourceError 透传：driver 主动抛精确语义，不二次包装', async () => {
    const se = new SourceError('rate_limited', 'slow down', { ...ctx, operation: 'prompt' });
    const source = defineSource(createScriptedDriver({ id: 'passthrough', failWith: se }));
    await source.init();
    const events = await collect(source.prompt(null, [{ type: 'text', text: 'hi' }]));
    const err = events.find((e) => e.type === 'error')!;
    // 未被降格为 unknown，也未被升格为 source_unavailable
    expect(err).toMatchObject({ code: 'rate_limited', retryable: true });
  });
});

// ── RETRYABLE_CODES 集合 ──

describe('RETRYABLE_CODES 集合', () => {
  it('RETRYABLE_CODES 不包含 unknown', () => {
    const err = new SourceError('unknown', 'test', ctx);
    expect(err.retryable).toBe(false);
  });

  it('RETRYABLE_CODES 不包含 source_unavailable', () => {
    const err = new SourceError('source_unavailable', 'test', ctx);
    expect(err.retryable).toBe(false);
  });

  it('RETRYABLE_CODES 包含 network/timeout/rate_limited（既有正确行为确认）', () => {
    expect(new SourceError('network', 't', ctx).retryable).toBe(true);
    expect(new SourceError('timeout', 't', ctx).retryable).toBe(true);
    expect(new SourceError('rate_limited', 't', ctx).retryable).toBe(true);
  });
});
