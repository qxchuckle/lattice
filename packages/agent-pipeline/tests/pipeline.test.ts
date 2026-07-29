/**
 * 管线 runner 测试：相位序、错误包装、事件流透明性
 *
 * 关键不变式：
 * - 入向按相位正序、出向逆序（洋葱）
 * - 无 transformEvent 时零包装（返回原流对象本身）
 * - done 被吞/复制 → middleware_failure（否则 result() 永挂）
 * - 源流 fail → 下游 result() 同样 reject（不吞异常）
 */
import { describe, it, expect } from 'vitest';
import type { SourceMiddleware, PromptPayload, SourceEvent } from '@qcqx/lattice-agent-protocol';
import { SourceEventStream } from '@qcqx/lattice-agent-protocol';
import {
  runPrompt,
  sortMiddlewares,
  applyPromptMiddlewares,
  wrapEventStream,
  PipelineError,
} from '../src/index.js';
import { createFakeSource, collect } from './fixtures.js';

/** 在 payload 文本末尾打标记的 middleware（用于观察执行顺序） */
function marker(name: string, phase: SourceMiddleware['phase']): SourceMiddleware {
  return {
    name,
    phase,
    async transformPrompt(payload) {
      return {
        ...payload,
        message: [{ type: 'text', text: `${textOf(payload)}|${name}` }],
      };
    },
  };
}

function textOf(payload: PromptPayload): string {
  const first = payload.message[0];
  return first && first.type === 'text' ? first.text : '';
}

const basePayload: PromptPayload = {
  sessionId: null,
  message: [{ type: 'text', text: 'start' }],
  opts: {},
};

describe('相位排序', () => {
  it('按 normalize → expand → inject → guard 排序，同相位保持注册序', () => {
    const sorted = sortMiddlewares([
      marker('g1', 'guard'),
      marker('n1', 'normalize'),
      marker('i1', 'inject'),
      marker('n2', 'normalize'),
      marker('e1', 'expand'),
    ]);
    expect(sorted.map((m) => m.name)).toEqual(['n1', 'n2', 'e1', 'i1', 'g1']);
  });

  it('入向变换按相位序累积（注册序打乱不影响结果）', async () => {
    const out = await applyPromptMiddlewares(
      [marker('guard', 'guard'), marker('expand', 'expand'), marker('norm', 'normalize')],
      basePayload,
      { sourceId: 'fake' },
    );
    expect(textOf(out)).toBe('start|norm|expand|guard');
  });
});

describe('middleware 错误处理', () => {
  it('普通异常 → 包装为 middleware_failure（带 middleware 名与 cause）', async () => {
    const boom: SourceMiddleware = {
      name: 'boom',
      phase: 'expand',
      transformPrompt: async () => {
        throw new Error('kaboom');
      },
    };
    const err = await applyPromptMiddlewares([boom], basePayload, { sourceId: 'fake' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PipelineError);
    const pe = err as PipelineError;
    expect(pe.code).toBe('middleware_failure');
    expect(pe.context.middleware).toBe('boom');
    expect((pe.context.cause as Error).message).toBe('kaboom');
  });

  it('guard 相位抛出的 PipelineError 原样上抛（合法拒绝不被改写为 middleware_failure）', async () => {
    const guard: SourceMiddleware = {
      name: 'guard',
      phase: 'guard',
      transformPrompt: async () => {
        throw PipelineError.unsupportedOption('prompt.images', 'no images');
      },
    };
    const err = (await applyPromptMiddlewares([guard], basePayload, { sourceId: 'fake' }).catch(
      (e: unknown) => e,
    )) as PipelineError;
    expect(err.code).toBe('unsupported_option');
    expect(err.context.capabilityPath).toBe('prompt.images');
  });

  it('入向失败时不调用源（prompt 一次都没发出）', async () => {
    const { source, calls } = createFakeSource();
    const boom: SourceMiddleware = {
      name: 'boom',
      phase: 'normalize',
      transformPrompt: async () => {
        throw new Error('x');
      },
    };
    await expect(
      runPrompt({ source, payload: basePayload, middlewares: [boom] }),
    ).rejects.toBeInstanceOf(PipelineError);
    expect(calls.prompts).toHaveLength(0);
  });
});

describe('事件流包装', () => {
  const passthroughPrompt: SourceMiddleware = {
    name: 'noop-prompt',
    phase: 'normalize',
    transformPrompt: async (p) => p,
  };

  it('无 transformEvent middleware → 返回原流对象（零包装开销）', () => {
    const raw = new SourceEventStream();
    expect(wrapEventStream(raw, [passthroughPrompt], { sourceId: 'fake' })).toBe(raw);
  });

  it('逐事件变换：一变多、滤除、原样放行混合生效', async () => {
    const { source } = createFakeSource('fake', {
      events: [
        { type: 'text', content: 'a' },
        { type: 'thinking', content: 'secret' },
      ],
    });
    const mw: SourceMiddleware = {
      name: 'split-and-filter',
      phase: 'normalize',
      transformEvent: (e) => {
        if (e.type === 'thinking') return []; // 滤除
        if (e.type === 'text')
          return [e, { type: 'notice', level: 'info', message: `after:${e.content}` }];
        return [e];
      },
    };
    const stream = await runPrompt({ source, payload: basePayload, middlewares: [mw] });
    const events = await collect(stream);
    expect(events.map((e) => e.type)).toEqual(['text', 'notice', 'done']);
  });

  it('出向按相位逆序包装（洋葱语义）', async () => {
    const trace: string[] = [];
    const tap = (name: string, phase: SourceMiddleware['phase']): SourceMiddleware => ({
      name,
      phase,
      transformEvent: (e) => {
        if (e.type === 'text') trace.push(name);
        return [e];
      },
    });
    const { source } = createFakeSource('fake', { events: [{ type: 'text', content: 'a' }] });
    const stream = await runPrompt({
      source,
      payload: basePayload,
      middlewares: [tap('normalize', 'normalize'), tap('guard', 'guard')],
    });
    await collect(stream);
    expect(trace).toEqual(['guard', 'normalize']);
  });

  it('done 被吞 → middleware_failure（result() 不会永挂）', async () => {
    const { source } = createFakeSource();
    const swallow: SourceMiddleware = {
      name: 'swallow-done',
      phase: 'guard',
      transformEvent: (e) => (e.type === 'done' ? [] : [e]),
    };
    const stream = await runPrompt({ source, payload: basePayload, middlewares: [swallow] });
    const err = (await stream.result().catch((e: unknown) => e)) as PipelineError;
    expect(err).toBeInstanceOf(PipelineError);
    expect(err.code).toBe('middleware_failure');
  });

  it('done 被复制 → 同样判失败（终止事件不可增删）', async () => {
    const { source } = createFakeSource();
    const dup: SourceMiddleware = {
      name: 'dup-done',
      phase: 'guard',
      transformEvent: (e) => (e.type === 'done' ? [e, e] : [e]),
    };
    const stream = await runPrompt({ source, payload: basePayload, middlewares: [dup] });
    await expect(stream.result()).rejects.toBeInstanceOf(PipelineError);
  });

  it('transformEvent 抛错 → 流以 middleware_failure 终止', async () => {
    const { source } = createFakeSource('fake', { events: [{ type: 'text', content: 'a' }] });
    const boom: SourceMiddleware = {
      name: 'boom',
      phase: 'normalize',
      transformEvent: () => {
        throw new Error('bad');
      },
    };
    const stream = await runPrompt({ source, payload: basePayload, middlewares: [boom] });
    const err = (await stream.result().catch((e: unknown) => e)) as PipelineError;
    expect(err.code).toBe('middleware_failure');
    expect(err.context.middleware).toBe('boom');
  });

  it('源流 fail → 包装流的 result() 同样 reject（异常不被吞）', async () => {
    const cause = new Error('source died');
    const { source } = createFakeSource('fake', { events: [], failWith: cause });
    const tap: SourceMiddleware = {
      name: 'tap',
      phase: 'normalize',
      transformEvent: (e: SourceEvent) => [e],
    };
    const stream = await runPrompt({ source, payload: basePayload, middlewares: [tap] });
    await expect(stream.result()).rejects.toBe(cause);
  });

  it('入向变换后的 payload 才是源看到的内容（sessionId/opts 一并透传）', async () => {
    const { source, calls } = createFakeSource();
    await runPrompt({
      source,
      payload: { sessionId: 's1', message: [{ type: 'text', text: 'hi' }], opts: { model: 'm1' } },
      middlewares: [marker('norm', 'normalize')],
    });
    expect(calls.prompts[0].sessionId).toBe('s1');
    expect(calls.prompts[0].opts.model).toBe('m1');
    expect(calls.prompts[0].message).toEqual([{ type: 'text', text: 'hi|norm' }]);
  });
});
