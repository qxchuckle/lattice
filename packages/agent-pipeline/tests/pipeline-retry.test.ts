/**
 * pipeline middleware 重试/熔断测试
 *
 * 验证 transformEvent 抛 PipelineError 时按 err.code 决定重试或熔断：
 * - middleware_failure（可重试）→ maxRetries=2，指数退避，两次失败后第三次成功
 * - validation_error（不可重试）→ 不重试直接抛
 * - 连续可重试失败超 maxRetries → 抛最后一次错误
 *
 * 不改单消费者语义、不改流透明性（逐事件变换、无跨事件缓冲）。
 */
import { describe, it, expect } from 'vitest';
import type { SourceMiddleware, SourceEvent, PromptPayload } from '@qcqx/lattice-agent-protocol';
import { lastValueFrom } from 'rxjs';
import { runPrompt, PipelineError, isRetryableCode } from '../src/index.js';
import { createFakeSource, collect } from './fixtures.js';

const basePayload: PromptPayload = {
  sessionId: null,
  message: [{ type: 'text', text: 'start' }],
  opts: {},
};

const FAST_RETRY = { maxRetries: 2, baseDelayMs: 0 };

describe('pipeline middleware 重试/熔断', () => {
  it('middleware_failure 两次后成功 → 重试 2 次后成功，事件正常输出', async () => {
    let calls = 0;
    const flaky: SourceMiddleware = {
      name: 'flaky',
      phase: 'normalize',
      transformEvent: (e: SourceEvent) => {
        if (e.type === 'done') return [e];
        calls++;
        if (calls < 3) throw new Error('transient');
        return [e];
      },
    };
    const { source } = createFakeSource('fake', { events: [{ type: 'text', content: 'a' }] });
    const events = await collect(
      runPrompt({
        source,
        payload: basePayload,
        middlewares: [flaky],
        retryOptions: FAST_RETRY,
      }),
    );

    expect(calls).toBe(3); // 初始 + 2 次重试 = 3 次调用，第三次成功
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });

  it('validation_error → 不重试直接抛（熔断）', async () => {
    let calls = 0;
    const validator: SourceMiddleware = {
      name: 'validator',
      phase: 'normalize',
      transformEvent: (e: SourceEvent) => {
        if (e.type === 'done') return [e];
        calls++;
        throw new PipelineError('validation_error', 'event 不合法', {
          middlewareName: 'validator',
          phase: 'transform',
        });
      },
    };
    const { source } = createFakeSource('fake', { events: [{ type: 'text', content: 'a' }] });
    const err = await lastValueFrom(
      runPrompt({
        source,
        payload: basePayload,
        middlewares: [validator],
        retryOptions: FAST_RETRY,
      }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PipelineError);
    expect((err as PipelineError).code).toBe('validation_error');
    expect(calls).toBe(1); // 无重试
  });

  it('连续 middleware_failure 超 maxRetries → 抛最后一次错误', async () => {
    let calls = 0;
    const alwaysFail: SourceMiddleware = {
      name: 'always-fail',
      phase: 'normalize',
      transformEvent: (e: SourceEvent) => {
        if (e.type === 'done') return [e];
        calls++;
        throw new Error('persistent');
      },
    };
    const { source } = createFakeSource('fake', { events: [{ type: 'text', content: 'a' }] });
    const err = await lastValueFrom(
      runPrompt({
        source,
        payload: basePayload,
        middlewares: [alwaysFail],
        retryOptions: FAST_RETRY,
      }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PipelineError);
    expect((err as PipelineError).code).toBe('middleware_failure');
    expect((err as PipelineError).context.middleware).toBe('always-fail');
    expect(calls).toBe(3); // 初始 + 2 次重试 = 3 次调用
  });

  it('isRetryableCode: middleware_failure 可重试，其余不可重试', () => {
    expect(isRetryableCode('middleware_failure')).toBe(true);
    expect(isRetryableCode('validation_error')).toBe(false);
    expect(isRetryableCode('invalid_state')).toBe(false);
    expect(isRetryableCode('unsupported_operation')).toBe(false);
    expect(isRetryableCode('unsupported_option')).toBe(false);
  });

  it('默认重试配置：middleware_failure 触发重试（不传 retryOptions 也有默认行为）', async () => {
    let calls = 0;
    const flaky: SourceMiddleware = {
      name: 'flaky-default',
      phase: 'normalize',
      transformEvent: (e: SourceEvent) => {
        if (e.type === 'done') return [e];
        calls++;
        if (calls < 2) throw new Error('transient');
        return [e];
      },
    };
    const { source } = createFakeSource('fake', { events: [{ type: 'text', content: 'a' }] });
    const events = await collect(runPrompt({ source, payload: basePayload, middlewares: [flaky] }));

    expect(calls).toBe(2); // 第一次失败 + 重试一次成功
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });
});
