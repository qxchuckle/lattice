/**
 * 工厂运行时行为 + EventStream 边界（含 R1 真 bug 回归）
 *
 * 契约套件（contract-suite）测「声明↔实现一致性」，本文件测「运行时状态机」：
 * 句柄生命周期、多轮会话、资源缓存、流的边界语义。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  SourceEvent,
  SourceResourceInfo,
  ISource,
  SourceManifest,
  ResolvedManifest,
  ModelInfo,
  AuthStatus,
  SourceResourceQuery,
  SourceResourceScanResult,
} from '@qcqx/lattice-agent-protocol';
import { EventStream, SourceEventStream } from '@qcqx/lattice-agent-protocol';
import { defineSource } from '../src/define-source.js';
import { createScriptedDriver } from '../src/testing/index.js';
import type { SourceDriver, DriverSessionHandle } from '../src/driver.js';
import { SourceError } from '../src/types/error.js';
import { SourceRegistry } from '../src/registry.js';

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

  it('resources 能力=false → 不调 driver.scanResources，恒返 { resources: [] }', async () => {
    const scan = vi.fn().mockResolvedValue(resources);
    const source = defineSource({ ...createScriptedDriver(), scanResources: scan });
    await source.init();
    expect(await source.listResources()).toEqual({ resources: [] });
    expect(scan).not.toHaveBeenCalled();
  });

  it('TTL 缓存：同 cwd 二次调用不重扫；kinds 过滤在缓存之上', async () => {
    const scan = vi.fn().mockResolvedValue(resources);
    const source = defineSource({
      ...createScriptedDriver({ capabilities: { resources: { kinds: ['command', 'skill'] } } }),
      scanResources: scan,
    });
    await source.init();
    expect((await source.listResources({ cwd: '/tmp/x' })).resources).toHaveLength(2);
    expect(await source.listResources({ cwd: '/tmp/x', kinds: ['skill'] })).toEqual({
      resources: [resources[1]],
    });
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('scanResources 抛错 → resources=[] + warning 结构化上报（发现类 API 不致命、不静默）', async () => {
    const source = defineSource({
      ...createScriptedDriver({ capabilities: { resources: { kinds: ['command'] } } }),
      scanResources: vi.fn().mockRejectedValue(new Error('fs 失败')),
    });
    await source.init();
    expect(await source.listResources()).toEqual({ resources: [], warning: 'fs 失败' });
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
    expect(await source.listResources()).toEqual({ resources: [] });
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

describe('createAgentSource 便捷工厂', () => {
  it('注册 + initAll + dispose 一条龙', async () => {
    const { createAgentSource } = await import('../src/factory.js');
    const { createScriptedDriver } = await import('../src/testing/index.js');
    const { defineSource } = await import('../src/define-source.js');
    const driver = createScriptedDriver({ id: 'mock' });
    const { registry, dispose } = await createAgentSource({
      sources: [defineSource(driver)],
    });
    expect(registry.getSource('mock')).toBeTruthy();
    expect(registry.listManifests()).toHaveLength(1);
    await dispose();
  });

  it('无配置 → 空 registry（不抛错）', async () => {
    const { createAgentSource } = await import('../src/factory.js');
    const { registry, dispose } = await createAgentSource();
    expect(registry.listManifests()).toEqual([]);
    await dispose();
  });
});

describe('连接重试（指数退避）', () => {
  const identity = { sourceId: 'mock', sourceName: 'Mock' };

  /** connect 前 N 次抛指定错，之后成功 */
  function makeFlakyDriver(failCount: number, code: 'network' | 'auth_missing') {
    let attempts = 0;
    const base = createScriptedDriver({ id: 'mock' });
    const driver: SourceDriver = {
      ...base,
      async connect(sessionId: string | null): Promise<DriverSessionHandle> {
        attempts++;
        if (attempts <= failCount) {
          throw new SourceError(code, 'transient', { ...identity, operation: 'prompt' });
        }
        return { id: sessionId ?? 'ok', abort: () => {} };
      },
      async prompt() {
        return { sessionId: 'ok' };
      },
    };
    return { driver, attempts: () => attempts };
  }

  it('可重试错误（network）前两次失败 → 第三次连上，流正常完成', async () => {
    const { driver, attempts } = makeFlakyDriver(2, 'network');
    const source = defineSource(driver);
    await source.init();
    const events = await collect(source.prompt(null, [{ type: 'text', text: 'hi' }]));
    expect(attempts(), '重试至第三次才成功').toBe(3);
    expect(
      events.some((e) => e.type === 'done'),
      '重连后正常结束',
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'error'),
      '成功重连不报错',
    ).toBe(false);
  });

  it('不可重试错误（auth_missing）→ 立即抛出，不重试', async () => {
    const { driver, attempts } = makeFlakyDriver(2, 'auth_missing');
    const source = defineSource(driver);
    await source.init();
    const events = await collect(source.prompt(null, [{ type: 'text', text: 'hi' }]));
    expect(attempts(), '不可重试 → 只试一次').toBe(1);
    expect(
      events.some((e) => e.type === 'error'),
      '直接报错',
    ).toBe(true);
  });

  it('超过重试上限仍失败 → 最终报错', async () => {
    const { driver, attempts } = makeFlakyDriver(99, 'network');
    const source = defineSource(driver);
    await source.init();
    const events = await collect(source.prompt(null, [{ type: 'text', text: 'hi' }]));
    // 1 次首发 + 3 次重试 = 4 次尝试
    expect(attempts(), '首发 + MAX_CONNECT_RETRIES(3)').toBe(4);
    expect(
      events.some((e) => e.type === 'error'),
      '耗尽重试后报错',
    ).toBe(true);
  });
});

/** 最小化 mock ISource，仅 registry 依赖的方法有实现 */
function createMockSource(overrides: Partial<ISource> & { id: string }): ISource {
  const baseManifest: SourceManifest = {
    contractVersion: 1,
    info: { id: overrides.id, displayName: `Mock ${overrides.id}`, version: '0.0.0' },
    capabilities: {
      execution: { mode: 'local', contextOwnership: 'source' },
      prompt: {
        images: false,
        systemPrompt: { builtin: 'none', override: false, append: false },
        slashCommands: false,
        permissionModes: { available: ['full_auto'], default: 'full_auto' },
      },
      session: {
        resume: false,
        fork: false,
        rename: false,
        maxConcurrentSessions: 1,
      },
      resources: false,
      tools: { builtin: [], injection: false },
      context: { compaction: false },
      models: { policy: 'catalog', tuning: false },
      skills: { nativeInjection: false },
    },
    authRequirements: [],
  };

  const resolvedManifest: ResolvedManifest = {
    ...baseManifest,
    available: true,
    authSnapshot: { status: 'configured' },
    downgrades: [],
    resolvedAt: Date.now(),
  };

  return {
    async init() {},
    async dispose() {},
    describe: () => baseManifest,
    async handshake(): Promise<ResolvedManifest> {
      return { ...resolvedManifest };
    },
    async listModels(): Promise<ModelInfo[]> {
      return [];
    },
    async checkAuth(): Promise<AuthStatus> {
      return { status: 'configured' };
    },
    async listResources(_query?: SourceResourceQuery): Promise<SourceResourceScanResult> {
      return { resources: [] };
    },
    prompt() {
      return new EventStream<any, any>(
        (e) => e?.type === 'done',
        (e) => ({ sessionId: 's', sourceMessageId: 'm' }),
      );
    },
    async forkSession() {
      throw new Error('unsupported');
    },
    async renameSession() {
      throw new Error('unsupported');
    },
    async destroySession() {
      throw new Error('unsupported');
    },
    ...overrides,
  };
}

describe('initAll 失败处理', () => {
  let registry: SourceRegistry;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    registry = new SourceRegistry();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('单源 init 失败 → console.warn + available:false manifest', async () => {
    const sourceA = createMockSource({ id: 'source-a' });
    const sourceB = createMockSource({
      id: 'source-b',
      async init() {
        throw new Error('B init boom');
      },
    });

    registry.register(sourceA);
    registry.register(sourceB);
    await registry.initAll();

    // console.warn 被调用，消息包含 source-b
    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls[0][0] as string;
    expect(warnMsg).toContain('source-b');

    // B manifest: available=false, code=handshake-failed
    const manifestB = registry.getManifest('source-b')!;
    expect(manifestB).toBeDefined();
    expect(manifestB.available).toBe(false);
    expect(manifestB.unavailableReason).toBeDefined();
    expect(manifestB.unavailableReason!.code).toBe('handshake-failed');
    expect(manifestB.unavailableReason!.message).toContain('B init boom');

    // A manifest 正常（available !== false）
    const manifestA = registry.getManifest('source-a')!;
    expect(manifestA).toBeDefined();
    expect(manifestA.available).not.toBe(false);
  });

  it('全部失败 → 不抛异常，两个 manifest 都标记 available:false', async () => {
    const sourceA = createMockSource({
      id: 'source-a',
      async init() {
        throw new Error('A init boom');
      },
    });
    const sourceB = createMockSource({
      id: 'source-b',
      async init() {
        throw new Error('B init boom');
      },
    });

    registry.register(sourceA);
    registry.register(sourceB);

    // Promise resolve，不 reject
    await expect(registry.initAll()).resolves.toBeUndefined();

    // 两个 manifest 都标记 available:false
    const manifestA = registry.getManifest('source-a')!;
    const manifestB = registry.getManifest('source-b')!;
    expect(manifestA.available).toBe(false);
    expect(manifestB.available).toBe(false);
    expect(manifestA.unavailableReason!.code).toBe('handshake-failed');
    expect(manifestB.unavailableReason!.code).toBe('handshake-failed');
  });
});

describe('listResources 并发安全', () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    registry = new SourceRegistry();
  });

  it('异步期间 unregister 不影响遍历（entries 快照在 await 前展开）', async () => {
    const sourceA = createMockSource({
      id: 'source-a',
      async listResources(): Promise<SourceResourceScanResult> {
        return new Promise((resolve) =>
          setTimeout(
            () => resolve({ resources: [{ kind: 'command', name: 'cmd-a', scope: 'user' }] }),
            50,
          ),
        );
      },
    });
    const sourceB = createMockSource({
      id: 'source-b',
      async listResources(): Promise<SourceResourceScanResult> {
        return { resources: [{ kind: 'skill', name: 'skill-b', scope: 'user' }] };
      },
    });

    registry.register(sourceA);
    registry.register(sourceB);

    // 启动 listResources（entries 快照在此同步展开）
    const listPromise = registry.listResources();

    // 在 A 的慢 Promise 等待期间 unregister B
    registry.unregister('source-b');

    // 最终返回的 bySource 仍含 B 的结果（快照已展开，不受后续 unregister 影响）
    const { bySource, warnings } = await listPromise;
    expect(bySource).toHaveProperty('source-a');
    expect(bySource).toHaveProperty('source-b');
    expect(bySource['source-a']).toEqual([{ kind: 'command', name: 'cmd-a', scope: 'user' }]);
    expect(bySource['source-b']).toEqual([{ kind: 'skill', name: 'skill-b', scope: 'user' }]);
    expect(warnings).toEqual([]);
  });

  it('单源失败入 warnings 清单，其余源正常返回（聚合层不静默吞错）', async () => {
    const good = createMockSource({
      id: 'source-good',
      async listResources(): Promise<SourceResourceScanResult> {
        return { resources: [{ kind: 'command', name: 'ok', scope: 'user' }] };
      },
    });
    // 源层已把 scanResources 失败降为 warning（工厂层行为）
    const degraded = createMockSource({
      id: 'source-degraded',
      async listResources(): Promise<SourceResourceScanResult> {
        return { resources: [], warning: '扫描失败：目录不可读' };
      },
    });
    // 违约抛错的第三方 ISource 实现：聚合层防御降为 warning
    const throwing = createMockSource({
      id: 'source-throwing',
      async listResources(): Promise<SourceResourceScanResult> {
        throw new Error('违约抛错');
      },
    });

    registry.register(good);
    registry.register(degraded);
    registry.register(throwing);

    const { bySource, warnings } = await registry.listResources();
    expect(bySource['source-good']).toEqual([{ kind: 'command', name: 'ok', scope: 'user' }]);
    expect(bySource['source-degraded']).toEqual([]);
    expect(bySource['source-throwing']).toEqual([]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        { sourceId: 'source-degraded', message: '扫描失败：目录不可读' },
        { sourceId: 'source-throwing', message: '违约抛错' },
      ]),
    );
    expect(warnings).toHaveLength(2);
  });

  it('指定 sourceId 只查该源；未知 sourceId 返空 bySource', async () => {
    const sourceA = createMockSource({
      id: 'source-a',
      async listResources(): Promise<SourceResourceScanResult> {
        return { resources: [{ kind: 'command', name: 'cmd-a', scope: 'user' }] };
      },
    });
    registry.register(sourceA);
    registry.register(createMockSource({ id: 'source-b' }));

    const only = await registry.listResources('source-a');
    expect(Object.keys(only.bySource)).toEqual(['source-a']);

    const unknown = await registry.listResources('nope');
    expect(unknown).toEqual({ bySource: {}, warnings: [] });
  });
});
