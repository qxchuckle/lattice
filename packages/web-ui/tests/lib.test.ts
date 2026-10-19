import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiGet,
  apiPost,
  buildIdMap,
  deduplicateProjects,
  formatDate,
  getAuthHeaders,
  getEntityColor,
  getProjectId,
  getRelationStyle,
  getTaskStatusColor,
  hasIdIntersection,
  layoutGraph,
  queryKeys,
  resolvePrimaryId,
  truncate,
} from '../src/lib';
import { authStore, clearToken } from '../src/store';
import type { LatticeEdge, LatticeNode } from '../src/types/graph';
import type { ProjectMeta } from '@qcqx/lattice-core';

// ── fetch 桩 ──

function stubFetch(response: { status: number; body?: unknown; jsonError?: boolean }) {
  const fn = vi.fn(async () => {
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: async () => {
        if (response.jsonError) throw new Error('bad json');
        return response.body;
      },
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function node(id: string): LatticeNode {
  return { id, position: { x: 0, y: 0 }, data: {} } as unknown as LatticeNode;
}

beforeEach(() => {
  clearToken();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe('请求层（auth + 错误语义）', () => {
  it('getAuthHeaders：无 token 为空对象，有 token 带 Bearer', () => {
    expect(getAuthHeaders()).toEqual({});
    authStore.token = 'tok-1';
    expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer tok-1' });
  });

  it('apiGet：200 返回 JSON，且自动携带 Authorization', async () => {
    authStore.token = 'tok-1';
    const fetchMock = stubFetch({ status: 200, body: { ok: true } });
    await expect(apiGet<{ ok: boolean }>('/api/x')).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('apiGet：401 清除 token 并抛 unauthorized', async () => {
    authStore.token = 'tok-1';
    stubFetch({ status: 401 });
    await expect(apiGet('/api/x')).rejects.toThrow('unauthorized');
    expect(authStore.token).toBeNull();
  });

  it('apiGet：非 2xx 抛 API <status>: <url>', async () => {
    stubFetch({ status: 500 });
    await expect(apiGet('/api/x')).rejects.toThrow('API 500: /api/x');
  });

  it('apiPost：携带 JSON body 与 Content-Type', async () => {
    const fetchMock = stubFetch({ status: 200, body: { success: true } });
    await expect(apiPost('/api/y', { a: 1 })).resolves.toEqual({ success: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('apiPost：错误响应优先取 body.message', async () => {
    stubFetch({ status: 400, body: { message: '分组名重复' } });
    await expect(apiPost('/api/y', {})).rejects.toThrow('分组名重复');
  });

  it('apiPost：错误响应无 message 时回落 HTTP <status>', async () => {
    stubFetch({ status: 400, jsonError: true });
    await expect(apiPost('/api/y', {})).rejects.toThrow('HTTP 400');
  });

  it('apiPost：401 清除 token 并抛 unauthorized', async () => {
    authStore.token = 'tok-1';
    stubFetch({ status: 401 });
    await expect(apiPost('/api/y', {})).rejects.toThrow('unauthorized');
    expect(authStore.token).toBeNull();
  });
});

describe('配色与连线样式', () => {
  it('实体 / 任务状态色：已知取值 + 未知回落灰', () => {
    expect(getEntityColor('task')).toBe('#1677FF');
    expect(getEntityColor('project')).toBe('#FA8C16');
    expect(getEntityColor('spec')).toBe('#13C2C2');
    expect(getEntityColor('unknown')).toBe('#8C8C8C');
    expect(getTaskStatusColor('completed')).toBe('#52C41A');
    expect(getTaskStatusColor('unknown')).toBe('#8C8C8C');
  });

  it('关系样式：dashed/dotted 生成 dasharray，solid 无', () => {
    expect(getRelationStyle('depends-on')).toEqual({ stroke: '#FA8C16', strokeDasharray: '8 4' });
    expect(getRelationStyle('shares-component')).toEqual({
      stroke: '#13C2C2',
      strokeDasharray: '2 4',
    });
    expect(getRelationStyle('forked-from')).toEqual({ stroke: '#1677FF' });
    expect(getRelationStyle('unknown')).toEqual({ stroke: '#8C8C8C' });
  });
});

describe('layoutGraph 自动布局', () => {
  it('无边：网格布局（列数 = min(ceil(sqrt(n)), 6)）', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const out = layoutGraph(nodes, []);
    // 2 列 × 2 行；间距 220+50 / 80+40
    expect(out.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 270, y: 0 },
      { x: 0, y: 120 },
      { x: 270, y: 120 },
    ]);
  });

  it('有边：dagre 排布，LR 方向 source 在 target 左侧且坐标有限', () => {
    const edges: LatticeEdge[] = [{ id: 'e1', source: 'a', target: 'b' } as LatticeEdge];
    const out = layoutGraph([node('a'), node('b')], edges, 'LR');
    const a = out.find((n) => n.id === 'a')!;
    const b = out.find((n) => n.id === 'b')!;
    expect(Number.isFinite(a.position.x)).toBe(true);
    expect(Number.isFinite(a.position.y)).toBe(true);
    expect(a.position.x).toBeLessThan(b.position.x);
  });
});

describe('格式化与 query keys', () => {
  it('formatDate：空值 → "-"，本地时间格式化不漂移', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
    expect(formatDate('2026-01-02T03:04:05')).toBe('2026-01-02 03:04:05');
  });

  it('truncate：不再截断（原样返回）', () => {
    expect(truncate('abcdef', 3)).toBe('abcdef');
  });

  it('queryKeys：层级结构稳定', () => {
    expect(queryKeys.projects).toEqual(['projects']);
    expect(queryKeys.task('t1')).toEqual(['tasks', 't1']);
    expect(queryKeys.taskProgress('t1')).toEqual(['tasks', 't1', 'progress']);
    expect(queryKeys.search('q', 'task')).toEqual(['search', 'q', 'task', undefined]);
  });
});

describe('多 ID 机制', () => {
  const p1 = {
    ids: ['legacy:abc', 'git:xyz'],
    name: 'P1',
    localPaths: ['/p1'],
    gitRemotes: ['git@x'],
  } as unknown as ProjectMeta;
  const p2 = { ids: ['legacy:def'], name: 'P2' } as unknown as ProjectMeta;

  it('buildIdMap：全 ID 与无前缀版本都映射到同一 primary', () => {
    const map = buildIdMap([p1, p2]);
    const primary = map.get('legacy:abc');
    expect(primary).toBeTruthy();
    expect(map.get('git:xyz')).toBe(primary);
    expect(map.get('abc')).toBe(primary);
    expect(map.get('xyz')).toBe(primary);
    expect(map.get('legacy:def')).toBe('legacy:def');
  });

  it('resolvePrimaryId：未命中时原样返回', () => {
    const map = buildIdMap([p1]);
    expect(resolvePrimaryId(map, 'unknown-id')).toBe('unknown-id');
  });

  it('getProjectId：ids 优先（legacy > git 优先级），缺 ids 回落 id，空对象返回空串', () => {
    expect(getProjectId(p1)).toBe('legacy:abc');
    expect(getProjectId(p2)).toBe('legacy:def');
    expect(getProjectId({ id: 'only-id' } as unknown as ProjectMeta)).toBe('only-id');
    expect(getProjectId({} as unknown as ProjectMeta)).toBe('');
  });

  it('hasIdIntersection：交集检测', () => {
    expect(hasIdIntersection(['a', 'b'], ['b'])).toBe(true);
    expect(hasIdIntersection(['a'], ['b'])).toBe(false);
    expect(hasIdIntersection([], ['a'])).toBe(false);
  });

  it('deduplicateProjects：IDs 有交集的项目合并（ids/localPaths/gitRemotes 并集）', () => {
    const p1b = {
      ids: ['legacy:abc', 'git:shared'],
      name: 'P1b',
      localPaths: ['/p1b'],
      gitRemotes: ['git@y'],
    } as unknown as ProjectMeta;
    const merged = deduplicateProjects([p1, p2]);
    expect(merged.length).toBe(2);

    const union = deduplicateProjects([p1, p1b, p2]);
    expect(union.length).toBe(2);
    const rep = union.find((p) => p.ids.includes('git:shared'))!;
    expect(rep.ids).toContain('legacy:abc');
    expect(rep.ids).toContain('git:xyz');
    expect(new Set(rep.localPaths)).toEqual(new Set(['/p1', '/p1b']));
    expect(new Set(rep.gitRemotes)).toEqual(new Set(['git@x', 'git@y']));
  });
});
