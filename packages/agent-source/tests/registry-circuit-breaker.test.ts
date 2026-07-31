/**
 * SourceRegistry 熔断机制测试（v2 语义）
 *
 * registry = 源级可用性唯一登记处：markUnavailable/markAvailable 控制熔断，
 * getSource 过滤已熔断源；恢复路径：markAvailable 或 rehandshake 成功。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ISource,
  SourceManifest,
  ResolvedManifest,
  ModelInfo,
  AuthStatus,
  SourceResourceInfo,
  SourceResourceQuery,
} from '@qcqx/lattice-agent-protocol';
import { EventStream } from '@qcqx/lattice-agent-protocol';
import { SourceRegistry } from '../src/registry.js';

/** 最小化 mock ISource（复用 factory-runtime.test.ts 的模式） */
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
        permissionModes: false,
      },
      session: { resume: false, fork: false, rename: false, maxConcurrentSessions: 1 },
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
    async listResources(_query?: SourceResourceQuery): Promise<SourceResourceInfo[]> {
      return [];
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

describe('SourceRegistry 熔断机制', () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    registry = new SourceRegistry();
  });

  it('markUnavailable(id, reason) 后 getSource(id) 返回 undefined（并 warn 可观测）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = createMockSource({ id: 'src-a' });
    registry.register(source);

    // 熔断前：正常返回
    expect(registry.getSource('src-a')).toBe(source);

    // 熔断
    registry.markUnavailable('src-a', 'connection-lost');

    // 熔断后：getSource 返回 undefined；铁律：排除必可观测
    expect(registry.getSource('src-a')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('markAvailable(id) 后 getSource(id) 恢复正常返回', () => {
    const source = createMockSource({ id: 'src-a' });
    registry.register(source);

    // 先熔断再恢复
    registry.markUnavailable('src-a', 'connection-lost');
    expect(registry.getSource('src-a')).toBeUndefined();

    registry.markAvailable('src-a');
    expect(registry.getSource('src-a')).toBe(source);
  });

  it('rehandshake 成功（available:true）→ 自动解除熔断', async () => {
    const source = createMockSource({ id: 'src-a' });
    registry.register(source);

    registry.markUnavailable('src-a', 'connection-lost');
    expect(registry.getSource('src-a')).toBeUndefined();

    // mock 源的 handshake 恒返回 available:true → rehandshake 成功即 markAvailable
    const manifest = await registry.rehandshake('src-a');
    expect(manifest.available).toBe(true);
    expect(registry.getSource('src-a')).toBe(source);
    expect(registry.getUnavailableReason('src-a')).toBeUndefined();
  });

  it('熔断一个源不影响其他源', () => {
    const sourceA = createMockSource({ id: 'src-a' });
    const sourceB = createMockSource({ id: 'src-b' });
    registry.register(sourceA);
    registry.register(sourceB);

    registry.markUnavailable('src-a', 'timeout');

    // A 被熔断
    expect(registry.getSource('src-a')).toBeUndefined();
    // B 不受影响
    expect(registry.getSource('src-b')).toBe(sourceB);
  });

  it('对不存在的源调用 markUnavailable 不抛错', () => {
    expect(() => {
      registry.markUnavailable('nonexistent', 'some-reason');
    }).not.toThrow();
  });

  it('重复 markUnavailable 同一源不抛错（幂等）', () => {
    const source = createMockSource({ id: 'src-a' });
    registry.register(source);

    registry.markUnavailable('src-a', 'reason-1');
    expect(() => {
      registry.markUnavailable('src-a', 'reason-2');
    }).not.toThrow();

    // 仍然不可用
    expect(registry.getSource('src-a')).toBeUndefined();
  });

  it('getSource 对未注册的 id 返回 undefined（已有行为确认）', () => {
    expect(registry.getSource('never-registered')).toBeUndefined();
  });

  it('listManifests 不受熔断影响（熔断的源仍出现在列表中）', async () => {
    const sourceA = createMockSource({ id: 'src-a' });
    const sourceB = createMockSource({ id: 'src-b' });
    registry.register(sourceA);
    registry.register(sourceB);

    // initAll 产生 manifest
    await registry.initAll();

    // 熔断 A
    registry.markUnavailable('src-a', 'timeout');

    // listManifests 仍返回两个 manifest（熔断是运行时状态，不影响 manifest 列表）
    const manifests = registry.listManifests();
    expect(manifests).toHaveLength(2);
  });

  it('getUnavailableReason(id) 可查询熔断原因', () => {
    const source = createMockSource({ id: 'src-a' });
    registry.register(source);

    registry.markUnavailable('src-a', 'connection-lost');

    const reason = registry.getUnavailableReason('src-a');
    expect(reason).toBeDefined();
    expect(reason).toBe('connection-lost');
  });

  it('未熔断的源 getUnavailableReason 返回 undefined', () => {
    const source = createMockSource({ id: 'src-a' });
    registry.register(source);

    const reason = registry.getUnavailableReason('src-a');
    expect(reason).toBeUndefined();
  });

  it('markAvailable 清除熔断原因', () => {
    const source = createMockSource({ id: 'src-a' });
    registry.register(source);

    registry.markUnavailable('src-a', 'connection-lost');
    registry.markAvailable('src-a');

    const reason = registry.getUnavailableReason('src-a');
    expect(reason).toBeUndefined();
  });
});
