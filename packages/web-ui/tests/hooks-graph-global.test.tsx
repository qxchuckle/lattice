import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGlobalGraph } from '../src/hooks/graph';
import { setAdapter } from '../src/adapters';
import { canvasStore } from '../src/store';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function project(id: string, name: string, ids: string[] = [id]) {
  return { id, ids, name, localPaths: [] } as never;
}

function spec(fileName: string, id: string, title: string, filePath: string, projectId?: string) {
  return { fileName, filePath, frontmatter: { id, title }, projectId } as never;
}

function task(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, title, status: 'planning', ...extra } as never;
}

const domainHash = 'abc12345deadbeef';

beforeEach(() => {
  canvasStore.userFilter = [];
  canvasStore.domainFilter = [];
  canvasStore.domainUserFilter = [];
});

afterEach(() => cleanup());

describe('useGlobalGraph 单用户', () => {
  it('项目/Spec/任务/关系/覆盖链/scope/父任务/引用边', async () => {
    const adapter = {
      getProjects: vi.fn(async () => [project('p1', '项目一'), project('p2', '项目二')]),
      getTasks: vi.fn(async () => [
        task('t0', '父任务'),
        task('t1', '中心任务', {
          projects: ['p1'],
          scopePaths: [{ projectId: 'p2', path: '/p2' }],
          parentTaskId: 't0',
          referencedSpecs: [{ id: 'g-spec' }],
        }),
      ]),
      getRelations: vi.fn(async () => [
        { id: 'r1', type: 'depends-on', projectA: 'p1', projectB: 'p2' },
      ]),
      getSpecs: vi.fn(async () => ({
        global: [spec('common.md', 'g-spec', '全局规范', '/g/common.md')],
        user: [spec('common.md', 'u-spec', '用户规范', '/u/spec/common.md')],
        project: [spec('common.md', 'p-spec', '项目规范', '/u/projects/p1/spec/common.md', 'p1')],
      })),
      getDomainsData: vi.fn(),
    };
    setAdapter(adapter as never);
    canvasStore.userFilter = ['alice'];

    const { result } = renderHook(() => useGlobalGraph(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const ids = result.current.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      ['g-spec', 'p-spec', 'p1', 'p2', 't0', 't1', 'u-spec']
        .map((id) =>
          id.startsWith('g-') || id.startsWith('u-') || id.startsWith('p-spec') ? `spec-${id}` : id,
        )
        .sort(),
    );
    expect(adapter.getProjects).toHaveBeenCalledWith('alice');
    expect(adapter.getTasks).toHaveBeenCalledWith({ username: 'alice' });
    expect(adapter.getRelations).toHaveBeenCalledWith('alice');
    expect(adapter.getSpecs).toHaveBeenCalledWith(undefined, undefined, 'alice');

    const labels = result.current.edges.map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'spec',
        'task',
        'scope',
        'parent',
        'ref-spec',
        'overrides',
        'depends-on',
      ]),
    );
    expect(labels.filter((l) => l === 'overrides')).toHaveLength(2);
    expect(result.current.edges.find((e) => e.id === 'r1')?.animated).toBe(true);
    const p1 = result.current.nodes.find((n) => n.id === 'p1')!;
    expect(p1.data).toMatchObject({ entityType: 'project', name: '项目一' });
    const projectSpec = result.current.nodes.find((n) => n.id === 'spec-p-spec')!;
    expect(projectSpec.data).toMatchObject({ scope: 'project', projectId: 'p1' });
  });

  it('空数据/加载中状态', async () => {
    const adapter = {
      getProjects: vi.fn(() => new Promise(() => {})),
      getTasks: vi.fn(async () => []),
      getRelations: vi.fn(async () => []),
      getSpecs: vi.fn(async () => ({ global: [], user: [], project: [] })),
      getDomainsData: vi.fn(),
    };
    setAdapter(adapter as never);
    const { result } = renderHook(() => useGlobalGraph(), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
  });
});

describe('useGlobalGraph 多用户', () => {
  it('用户前缀节点、跨用户合并、全局 Spec 去重、关系/覆盖链/父子/引用', async () => {
    const aliceProjects = [project('ap', 'Alice项目', ['ap', 'shared'])];
    const bobProjects = [project('bp', 'Bob项目', ['bp', 'shared'])];
    const adapter = {
      getProjects: vi.fn(async (username?: string) =>
        username === 'bob' ? bobProjects : aliceProjects,
      ),
      getTasks: vi.fn(async ({ username }: { username?: string }) =>
        username === 'bob'
          ? [task('bt', 'Bob任务', { projects: ['bp'] })]
          : [
              task('atp', 'Alice父任务'),
              task('at', 'Alice任务', {
                projects: ['ap'],
                scopePaths: [{ projectId: 'ap2' }],
                parentTaskId: 'atp',
                referencedSpecs: [{ id: 'u-spec' }],
              }),
            ],
      ),
      getRelations: vi.fn(async (username?: string) =>
        username === 'bob' ? [] : [{ id: 'ar', type: 'related', projectA: 'ap', projectB: 'ap2' }],
      ),
      getSpecs: vi.fn(async (_scope?: string, _x?: string, username?: string) =>
        username === 'bob'
          ? {
              global: [spec('common.md', 'g-spec', '全局', '/g/common.md')],
              user: [spec('common.md', 'bu-spec', 'Bob用户', '/u/bob/spec/common.md')],
              project: [],
            }
          : {
              global: [spec('common.md', 'g-spec', '全局', '/g/common.md')],
              user: [spec('common.md', 'u-spec', 'Alice用户', '/u/alice/spec/common.md')],
              project: [
                spec(
                  'common.md',
                  'ap-spec',
                  'Alice项目规范',
                  '/u/projects/ap/spec/common.md',
                  'ap',
                ),
              ],
            },
      ),
      getDomainsData: vi.fn(),
    };
    setAdapter(adapter as never);
    canvasStore.userFilter = ['alice', 'bob'];

    const { result } = renderHook(() => useGlobalGraph(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });
    const nodeIds = result.current.nodes.map((n) => n.id);
    expect(nodeIds).toEqual(
      expect.arrayContaining([
        'spec-g-spec',
        'alice:ap',
        'bob:bp',
        'alice:spec-u-spec',
        'alice:spec-ap-spec',
        'bob:spec-bu-spec',
        'alice:at',
        'bob:bt',
      ]),
    );
    expect(nodeIds.filter((id) => id === 'spec-g-spec')).toHaveLength(1);
    const labels = result.current.edges.map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'cross-user',
        'spec',
        'task',
        'scope',
        'parent',
        'ref-spec',
        'overrides',
        'related',
      ]),
    );
    const cross = result.current.edges.find((e) => e.label === 'cross-user')!;
    expect(cross.source).toBe('alice:ap');
    expect(cross.target).toBe('bob:bp');
    const aliceProject = result.current.nodes.find((n) => n.id === 'alice:ap')!;
    expect(aliceProject.data).toMatchObject({ username: 'alice', ids: ['ap', 'shared'] });
  });

  it('多用户查询未全部就绪时图为空且 loading', async () => {
    const adapter = {
      getProjects: vi.fn(async () => []),
      getTasks: vi.fn(() => new Promise(() => {})),
      getRelations: vi.fn(async () => []),
      getSpecs: vi.fn(async () => ({ global: [], user: [], project: [] })),
      getDomainsData: vi.fn(),
    };
    setAdapter(adapter as never);
    canvasStore.userFilter = ['alice', 'bob'];
    const { result } = renderHook(() => useGlobalGraph(), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.nodes).toEqual([]);
  });
});

describe('useGlobalGraph 域数据', () => {
  function domainPack() {
    return {
      domains: [{ hash: domainHash, label: '域A', use: 'trusted', users: ['u1', 'u2'] }],
      degraded: [],
      projects: [
        {
          id: 'dp',
          ids: ['p-local'],
          name: '域项目',
          source: domainHash,
          username: 'u1',
          contractId: 'c1',
          localPaths: [],
        },
      ],
      specs: [
        {
          source: domainHash,
          scope: 'project',
          username: 'u1',
          contractId: 'c1',
          filePath: '/d/spec.md',
          fileName: 'spec.md',
          relativePath: 'spec.md',
          title: '域规范',
          tags: [],
          content: '',
        },
        {
          source: domainHash,
          scope: 'user',
          username: 'u1',
          contractId: null,
          filePath: '/d/user.md',
          fileName: 'user.md',
          relativePath: 'user.md',
          title: '域用户规范',
          tags: [],
          content: '',
        },
      ],
      tasks: [
        {
          id: 'dt',
          title: '域任务',
          status: 'planning',
          source: domainHash,
          username: 'u1',
          projects: ['c1'],
        },
      ],
    };
  }

  it('整域勾选：项目/spec/task 节点与 same-project/spec/task 边', async () => {
    const adapter = {
      getProjects: vi.fn(async () => [project('local', '本地项目', ['p-local'])]),
      getTasks: vi.fn(async () => []),
      getRelations: vi.fn(async () => []),
      getSpecs: vi.fn(async () => ({ global: [], user: [], project: [] })),
      getDomainsData: vi.fn(async () => domainPack()),
    };
    setAdapter(adapter as never);
    canvasStore.domainFilter = [domainHash];

    const { result } = renderHook(() => useGlobalGraph(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(result.current.nodes.some((n) => n.id === `domain:abc12345:project:c1`)).toBe(true),
    );
    const ids = result.current.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'p-local',
        'domain:abc12345:project:c1',
        'domain:abc12345:spec:/d/spec.md',
        'domain:abc12345:spec:/d/user.md',
        'domain:abc12345:task:dt',
      ]),
    );
    const labels = result.current.edges.map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['same-project', 'spec', 'task']));
    const domainProject = result.current.nodes.find((n) => n.id === 'domain:abc12345:project:c1')!;
    expect(domainProject.data).toMatchObject({ domainLabel: '域A', username: 'u1' });
  });

  it('按域用户勾选；不匹配用户不产生域节点', async () => {
    const adapter = {
      getProjects: vi.fn(async () => []),
      getTasks: vi.fn(async () => []),
      getRelations: vi.fn(async () => []),
      getSpecs: vi.fn(async () => ({ global: [], user: [], project: [] })),
      getDomainsData: vi.fn(async () => domainPack()),
    };
    setAdapter(adapter as never);
    canvasStore.domainUserFilter = [`${domainHash}:u1`];
    const { result } = renderHook(() => useGlobalGraph(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(result.current.nodes.some((n) => n.id === `domain:abc12345:task:dt`)).toBe(true),
    );

    act(() => {
      canvasStore.domainUserFilter = [`${domainHash}:other`];
    });
    await waitFor(() =>
      expect(result.current.nodes.some((n) => n.id.startsWith('domain:'))).toBe(false),
    );
  });
});
