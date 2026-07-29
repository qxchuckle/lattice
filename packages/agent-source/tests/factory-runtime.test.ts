/**
 * 工厂运行时行为 + EventStream 边界（含 R1 真 bug 回归）
 *
 * 契约套件（contract-suite）测「声明↔实现一致性」，本文件测「运行时状态机」：
 * 句柄生命周期、多轮会话、资源缓存、流的边界语义。
 */
import { describe, it, expect, vi } from 'vitest';
import type { SourceEvent, SourceResourceInfo } from '@qcqx/lattice-agent-protocol';
import { EventStream, SourceEventStream } from '@qcqx/lattice-agent-protocol';
import { defineSource } from '../src/define-source.js';
import { createScriptedDriver } from '../src/testing/index.js';
import type { SourceDriver, DriverSessionHandle } from '../src/driver.js';

async function collect(iter: AsyncIterable<SourceEvent>): Promise<SourceEvent[]> {
  const out: SourceEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('工厂句柄生命周期', () => {
  /** connect 计数 + 可控回填 ID 的 driver */
  function makeTrackingDriver(realId?: string) {
    const connects: Array<string | null> = [];
    const promptIds: string[] = [];
    const base = createScriptedDriver();
    const driver: SourceDriver = {
      ...base,
      async connect(sessionId: string | null): Promise<DriverSessionHandle> {
        connects.push(sessionId);
        return { id: sessionId ?? 'placeholder', abort: () => {} };
      },
      async prompt(session) {
        promptIds.push(session.id);
        return realId ? { sessionId: realId } : {};
      },
    };
    return { driver, connects, promptIds };
  }

  it('【R1 回归】outcome 回填后 handle.id 同步重写：次轮 driver 看到真实 ID', async () => {
    const { driver, connects, promptIds } = makeTrackingDriver('real-1');
    const source = defineSource(driver);
    await source.init();

    const s1 = source.prompt(null, [{ type: 'text', text: 'a' }]);
    await collect(s1);
    expect((await s1.result()).sessionId).toBe('real-1');
    expect(promptIds[0]).toBe('placeholder'); // 首轮：占位 ID

    // 次轮用真实 ID 继续：句柄命中缓存（不再 connect），且 driver 看到 real-1
    const s2 = source.prompt('real-1', [{ type: 'text', text: 'b' }]);
    await collect(s2);
    expect(connects).toEqual([null]); // 仅首轮 connect
    expect(promptIds[1]).toBe('real-1'); // 若未同步 handle.id 这里会是 'placeholder'
  });

  it('句柄复用：同一 sessionId 多轮只 connect 一次', async () => {
    const { driver, connects } = makeTrackingDriver();
    const source = defineSource(driver);
    await source.init();
    await collect(source.prompt('s1', [{ type: 'text', text: 'a' }]));
    await collect(source.prompt('s1', [{ type: 'text', text: 'b' }]));
    expect(connects).toEqual(['s1']);
  });

  it('destroySession 释放句柄 → 下次 prompt 重新 connect，并调 driver.destroyNative', async () => {
    const destroyed: string[] = [];
    const { driver, connects } = makeTrackingDriver();
    const source = defineSource({
      ...driver,
      destroyNative: async (id: string) => void destroyed.push(id),
    });
    await source.init();
    await collect(source.prompt('s1', [{ type: 'text', text: 'a' }]));
    await source.destroySession('s1');
    await collect(source.prompt('s1', [{ type: 'text', text: 'b' }]));
    expect(connects).toEqual(['s1', 's1']);
    expect(destroyed).toEqual(['s1']);
  });

  it('dispose 关闭全部句柄（close 被调用）', async () => {
    let closed = 0;
    const base = createScriptedDriver();
    const source = defineSource({
      ...base,
      connect: async (sessionId: string | null) => ({
        id: sessionId ?? 'x',
        abort: () => {},
        close: () => {
          closed++;
        },
      }),
    });
    await source.init();
    await collect(source.prompt('s1', [{ type: 'text', text: 'a' }]));
    await collect(source.prompt('s2', [{ type: 'text', text: 'b' }]));
    await source.dispose();
    expect(closed).toBe(2);
  });
});

describe('工厂资源发现', () => {
  const resources: SourceResourceInfo[] = [
    { kind: 'command', name: 'c1', scope: 'user' },
    { kind: 'skill', name: 's1', scope: 'user' },
  ];

  it('resources 能力=false → 不调 driver.scanResources，恒返 []', async () => {
    const scan = vi.fn().mockResolvedValue(resources);
    const source = defineSource({ ...createScriptedDriver(), scanResources: scan });
    await source.init();
    expect(await source.listResources()).toEqual([]);
    expect(scan).not.toHaveBeenCalled();
  });

  it('TTL 缓存：同 cwd 二次调用不重扫；kinds 过滤在缓存之上', async () => {
    const scan = vi.fn().mockResolvedValue(resources);
    const source = defineSource({
      ...createScriptedDriver({ capabilities: { resources: { kinds: ['command', 'skill'] } } }),
      scanResources: scan,
    });
    await source.init();
    expect(await source.listResources({ cwd: '/tmp/x' })).toHaveLength(2);
    expect(await source.listResources({ cwd: '/tmp/x', kinds: ['skill'] })).toEqual([resources[1]]);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('scanResources 抛错 → 返 []（发现类 API 不致命）', async () => {
    const source = defineSource({
      ...createScriptedDriver({ capabilities: { resources: { kinds: ['command'] } } }),
      scanResources: vi.fn().mockRejectedValue(new Error('fs 失败')),
    });
    await source.init();
    expect(await source.listResources()).toEqual([]);
  });

  it('握手降准 resources=false 后，listResources 立即停止扫描（verified 优先）', async () => {
    const scan = vi.fn().mockResolvedValue(resources);
    const source = defineSource({
      ...createScriptedDriver({ capabilities: { resources: { kinds: ['command'] } } }),
      scanResources: scan,
      probe: async () => ({
        overrides: [{ path: 'resources', actual: false, reason: '实探：目录不存在' }],
      }),
    });
    await source.init();
    const manifest = await source.handshake();
    expect(manifest.capabilities.resources).toBe(false);
    expect(manifest.downgrades).toHaveLength(1);
    expect(await source.listResources()).toEqual([]);
    expect(scan).not.toHaveBeenCalled();
  });
});

describe('EventStream 边界语义', () => {
  it('done 后 push 被忽略（流已终止）', async () => {
    const s = new SourceEventStream();
    s.push({ type: 'text', content: 'a' });
    s.push({ type: 'done', sessionId: 'x' });
    s.push({ type: 'text', content: 'late' });
    expect((await collect(s)).map((e) => e.type)).toEqual(['text', 'done']);
  });

  it('result() 可多次调用，返回同一结果', async () => {
    const s = new SourceEventStream();
    s.push({ type: 'done', sessionId: 'x', sourceMessageId: 'm' });
    await collect(s);
    expect(await s.result()).toEqual(await s.result());
  });

  it('fail() 前已入队事件仍可被消费（排空后结束）', async () => {
    const s = new SourceEventStream();
    s.push({ type: 'text', content: 'partial' });
    s.fail(new Error('boom'));
    expect((await collect(s)).map((e) => e.type)).toEqual(['text']);
    await expect(s.result()).rejects.toThrow('boom');
  });

  it('消费者先等待、生产者后推入（无竞态丢事件）', async () => {
    const s = new SourceEventStream();
    const collected = collect(s);
    await Promise.resolve();
    s.push({ type: 'text', content: 'a' });
    s.push({ type: 'done', sessionId: 'x' });
    expect((await collected).map((e) => e.type)).toEqual(['text', 'done']);
  });

  it('泛型 EventStream：自定义终止判定与结果提取', async () => {
    const s = new EventStream<{ n: number }, number>(
      (e) => e.n < 0,
      (e) => -e.n,
    );
    s.push({ n: 1 });
    s.push({ n: -5 });
    expect(await collect(s as unknown as AsyncIterable<never>)).toHaveLength(2);
    expect(await s.result()).toBe(5);
  });
});
