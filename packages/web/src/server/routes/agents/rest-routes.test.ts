// @vitest-environment node
/**
 * rest-routes.ts DTO 测试
 *
 * 覆盖两条数据链路的字段贯通（源永不静默降级）：
 *   - GET /api/agent/sources：manifest 的 available/unavailableReason 透传（前端源下拉禁用/提示的数据来源）
 *   - GET /api/agent/resources：registry 聚合的 warnings 透出（资源菜单警示行的数据来源）
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { LatticeAgent } from '@qcqx/lattice-agent';
import { registerAgentRestRoutes } from './rest-routes';

/** 最小 manifest（只含被测端点消费的字段） */
function manifestOf(id: string, extra?: { unavailableReason?: { code: string; message: string } }) {
  return {
    info: { id, displayName: `Source ${id}`, version: '1.0.0' },
    capabilities: { models: { policy: 'catalog' } },
    available: !extra?.unavailableReason,
    unavailableReason: extra?.unavailableReason,
    downgrades: [],
    modelsSnapshot: [],
  };
}

function makeApp(registryOverrides: Record<string, unknown>) {
  const latticeAgent = {
    sources: {
      registry: {
        listManifests: vi.fn(() => []),
        listResources: vi.fn(async () => ({ bySource: {}, warnings: [] })),
        getSource: vi.fn(),
        getManifest: vi.fn(),
        ...registryOverrides,
      },
    },
    workflow: {
      loadLocalCommands: vi.fn(),
      listLocalResources: vi.fn(() => []),
    },
  } as unknown as LatticeAgent;
  const app = Fastify();
  registerAgentRestRoutes(app, async () => latticeAgent, vi.fn());
  return { app, latticeAgent };
}

describe('GET /api/agent/sources — 可用性字段透传', () => {
  it('available:false 源携带 unavailableReason（probe-failed）到 DTO', async () => {
    const { app } = makeApp({
      listManifests: () => [
        manifestOf('qoder'),
        manifestOf('pi', {
          unavailableReason: { code: 'probe-failed', message: '需要 Node ≥ 22' },
        }),
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/api/agent/sources' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe('ok');
    const sources = body.data.sources as Array<Record<string, unknown>>;
    expect(sources).toHaveLength(2);
    const qoder = sources.find((s) => s.id === 'qoder')!;
    expect(qoder.available).toBe(true);
    expect(qoder.unavailableReason).toBeUndefined();
    const pi = sources.find((s) => s.id === 'pi')!;
    expect(pi.available).toBe(false);
    expect(pi.unavailableReason).toEqual({ code: 'probe-failed', message: '需要 Node ≥ 22' });
  });
});

describe('GET /api/agent/resources — warnings 透出', () => {
  it('聚合 bySource 展平为 resources，warnings 原样进入 envelope', async () => {
    const { app } = makeApp({
      listResources: async () => ({
        bySource: {
          qoder: [{ kind: 'command', name: 'compact', scope: 'builtin' }],
          pi: [],
        },
        warnings: [{ sourceId: 'pi', message: 'scan 失败：目录不可读' }],
      }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/agent/resources?kinds=command' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe('ok');
    expect(body.data.resources).toEqual([
      { kind: 'command', name: 'compact', scope: 'builtin', origin: 'source', sourceId: 'qoder' },
    ]);
    expect(body.data.warnings).toEqual([{ sourceId: 'pi', message: 'scan 失败：目录不可读' }]);
  });

  it('无失败时 warnings 为空数组（字段恒在，前端免判空形状）', async () => {
    const { app } = makeApp({});
    const res = await app.inject({ method: 'GET', url: '/api/agent/resources' });
    const body = res.json();
    expect(body.data.warnings).toEqual([]);
  });
});
