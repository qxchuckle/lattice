/**
 * 契约套件自测：/testing 的一致性检查器 + defineSource 工厂行为
 *
 * 三层能力机制的机器化验收：
 * - 内置 pi/qoder driver 必须零 conformance issue（声明↔实现不漂移）
 * - 工厂行为保证：done 必携 sessionId / error 后 result() reject / 能力守卫抛类型化错误 / ts 打点
 */
import { describe, it, expect } from 'vitest';
import type { SourceEvent } from '@qcqx/lattice-agent-protocol';
import { CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';
import { defineSource } from '../src/define-source.js';
import { SourceError } from '../src/types/error.js';
import { checkDriverConformance, createScriptedDriver } from '../src/testing/index.js';
import { createPiDriver } from '../src/sources/pi/index.js';
import { createQoderDriver } from '../src/sources/qoder/index.js';

async function collect(iter: AsyncIterable<SourceEvent>): Promise<SourceEvent[]> {
  const out: SourceEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('内置 driver conformance（声明↔实现零漂移）', () => {
  it('PiDriver 零 issue', () => {
    expect(checkDriverConformance(createPiDriver() as never)).toEqual([]);
  });

  it('QoderDriver 零 issue', () => {
    expect(checkDriverConformance(createQoderDriver() as never)).toEqual([]);
  });
});

describe('conformance 规则（负例）', () => {
  it('声明 fork 但缺 forkNative → fork-impl error', () => {
    const bad = createScriptedDriver({ capabilities: {} });
    // 手工破坏：声明 fork 但删实现
    const driver = {
      ...bad,
      capabilities: {
        ...bad.capabilities,
        session: { ...bad.capabilities.session, fork: { atMessage: true } },
      },
    };
    delete (driver as Record<string, unknown>).forkNative;
    const issues = checkDriverConformance(driver as never);
    expect(issues.map((i) => i.rule)).toContain('fork-impl');
  });

  it('permissionModes.default 不在 available 内 → permission-default error', () => {
    const bad = createScriptedDriver({
      capabilities: {
        prompt: {
          images: false,
          systemPrompt: { builtin: 'none', override: false, append: false },
          slashCommands: false,
          permissionModes: { available: ['a', 'b'], default: 'c' },
        },
      },
    });
    const issues = checkDriverConformance(bad as never);
    expect(issues.map((i) => i.rule)).toContain('permission-default');
  });

  it('契约版本偏斜 → contract-version error；握手落 available:false + reason 含双方版本', async () => {
    const skewed = { ...createScriptedDriver(), contractVersion: CONTRACT_VERSION + 1 };
    expect(checkDriverConformance(skewed as never).map((i) => i.rule)).toContain(
      'contract-version',
    );
    // 版本偏斜不炸工厂/Registry：握手时表达为 failed manifest（与 auth/probe 失败同一出口）
    const source = defineSource(skewed);
    await source.init();
    const manifest = await source.handshake();
    expect(manifest.available).toBe(false);
    expect(manifest.unavailableReason?.code).toBe('handshake-failed');
    expect(manifest.unavailableReason?.message).toContain(String(CONTRACT_VERSION + 1));
    expect(manifest.unavailableReason?.message).toContain(String(CONTRACT_VERSION));
  });

  it('契约版本一致 → 握手不受影响（available:true）', async () => {
    const source = defineSource(createScriptedDriver());
    await source.init();
    const manifest = await source.handshake();
    expect(manifest.available).toBe(true);
  });
});

describe('defineSource 工厂行为保证', () => {
  it('done 必携 sessionId；result() 返回 PromptResult；事件全部带 ts', async () => {
    const source = defineSource(
      createScriptedDriver({
        script: [{ type: 'text', content: '回答' }],
        outcome: { sourceMessageId: 'msg-1' },
      }),
    );
    await source.init();
    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const events = await collect(stream);

    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
    expect(events.every((e) => typeof e.ts === 'number')).toBe(true);
    const result = await stream.result();
    expect(result.sessionId).toMatch(/^scripted-sess-/);
    expect(result.sourceMessageId).toBe('msg-1');
  });

  it('outcome.sessionId 回填 → done 以回填为准（无状态源语义）', async () => {
    const source = defineSource(createScriptedDriver({ outcome: { sessionId: 'real-id' } }));
    await source.init();
    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    await collect(stream);
    expect((await stream.result()).sessionId).toBe('real-id');
  });

  it('driver 抛错 → error 事件（带 code/source）→ result() reject SourceError', async () => {
    const source = defineSource(createScriptedDriver({ failWith: new Error('boom') }));
    await source.init();
    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const events = await collect(stream);

    expect(events).toHaveLength(1);
    // SourceError 构造器给 message 加 [sourceId] 前缀（既有行为）
    expect(events[0]).toMatchObject({ type: 'error', message: expect.stringContaining('boom') });
    await expect(stream.result()).rejects.toBeInstanceOf(SourceError);
  });

  it('未 init 就 prompt → source_not_initialized', async () => {
    const source = defineSource(createScriptedDriver());
    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const events = await collect(stream);
    expect(events[0]).toMatchObject({ type: 'error', code: 'source_not_initialized' });
  });

  it('能力守卫：fork=false → unsupported_operation；rename=false → unsupported_operation', async () => {
    const source = defineSource(createScriptedDriver());
    await source.init();
    await expect(source.forkSession('s1')).rejects.toMatchObject({
      code: 'unsupported_operation',
    });
    await expect(source.renameSession('s1', 't')).rejects.toMatchObject({
      code: 'unsupported_operation',
    });
  });

  it('能力守卫：fork.atMessage=false + 传锚点 → unsupported_option；不传锚点 → 放行', async () => {
    const source = defineSource(
      createScriptedDriver({
        capabilities: {
          session: {
            resume: false,
            fork: { atMessage: false },
            rename: false,
            maxConcurrentSessions: 'unlimited',
          },
        },
      }),
    );
    await source.init();
    await expect(source.forkSession('s1', 'anchor')).rejects.toMatchObject({
      code: 'unsupported_option',
    });
    await expect(source.forkSession('s1')).resolves.toMatch(/-fork-/);
  });

  it('握手：configured → available:true + manifest 快照；describe 契约版本正确', async () => {
    const source = defineSource(createScriptedDriver({ models: [] }));
    await source.init();
    expect(source.describe().contractVersion).toBe(CONTRACT_VERSION);
    const manifest = await source.handshake();
    expect(manifest.available).toBe(true);
    expect(manifest.authSnapshot.status).toBe('configured');
    expect(manifest.downgrades).toEqual([]);
  });

  it('握手：auth missing → available:false + unavailableReason.auth', async () => {
    const source = defineSource(
      createScriptedDriver({ auth: { status: 'missing', message: '未登录' } }),
    );
    await source.init();
    const manifest = await source.handshake();
    expect(manifest.available).toBe(false);
    expect(manifest.unavailableReason).toMatchObject({ code: 'auth', message: '未登录' });
  });

  it('signal 中止 → handle.abort 被触发（唯一取消真相）', async () => {
    let aborted = false;
    const base = createScriptedDriver({ script: [{ type: 'text', content: 'x' }] });
    const driver = {
      ...base,
      connect: async () => ({
        id: 'sess-a',
        abort: () => {
          aborted = true;
        },
      }),
    };
    const source = defineSource(driver);
    await source.init();
    const ac = new AbortController();
    ac.abort();
    await collect(source.prompt('sess-a', [{ type: 'text', text: 'hi' }], { signal: ac.signal }));
    expect(aborted).toBe(true);
  });
});
