import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTreeData } from '../src/components/sidebar/treeData';
import { setAdapter } from '../src/adapters';
import { canvasStore } from '../src/store';
import type { DomainDataPack } from '../src/hooks/data';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function spec(fileName: string, id: string, title: string, filePath: string, projectId?: string) {
  return { fileName, filePath, frontmatter: { id, title }, projectId } as never;
}

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    getProjects: vi.fn(async () => []),
    getTasks: vi.fn(async () => []),
    getSpecs: vi.fn(async () => ({ global: [], user: [], project: [] })),
    getDomainsData: vi.fn(
      async (): Promise<DomainDataPack> => ({
        domains: [],
        degraded: [],
        specs: [],
        tasks: [],
        projects: [],
      }),
    ),
    ...overrides,
  };
}

beforeEach(() => {
  canvasStore.domainFilter = [];
  canvasStore.domainUserFilter = [];
  canvasStore.localDataFilter = true;
});

afterEach(() => {
  cleanup();
  canvasStore.domainFilter = [];
  canvasStore.domainUserFilter = [];
  canvasStore.localDataFilter = true;
});

describe('useTreeData', () => {
  it('加载中返回空树；数据到达后构建 Spec/项目/任务三棵树', async () => {
    const projects = [
      { id: 'legacy:p1', ids: ['legacy:p1', 'git:aaa'], name: '项目一', description: '简介' },
      { id: 'legacy:p2', ids: ['legacy:p2'], name: '项目二', description: undefined },
    ];
    const tasks = [
      {
        id: 't1',
        title: '根任务',
        status: 'in_progress',
        projects: ['git:aaa'],
        referencedSpecs: [
          { id: 'spec-user0001', scope: 'user' },
          { id: 'spec-missing', scope: 'project' },
        ],
      },
      { id: 't2', title: '子任务', status: 'completed', parentTaskId: 't1' },
    ];
    const adapter = makeAdapter({
      getProjects: vi.fn(async () => projects),
      getTasks: vi.fn(async () => tasks),
      getSpecs: vi.fn(async () => ({
        global: [spec('g.md', 'spec-glob0001', '全局规范', '/u/spec/g.md')],
        user: [spec('u.md', 'spec-user0001', '用户规范', '/u/user/spec/u.md')],
        project: [
          spec('p.md', 'spec-proj0001', '项目规范', '/u/p/spec/p.md', 'git:aaa'),
          spec('other.md', 'spec-other001', '孤儿规范', '/u/o/spec/other.md', 'other'),
        ],
      })),
    });
    setAdapter(adapter as never);

    const { result } = renderHook(() => useTreeData(), { wrapper: wrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.tree).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.specs).toHaveLength(4);

    const roots = result.current.tree;
    expect(roots.map((n) => n.type)).toEqual(['spec-root', 'project-root', 'task-root']);
    const specRoot = roots[0];
    expect(specRoot.children?.map((c) => c.key)).toEqual([
      'spec-global',
      'spec-user',
      'spec-p-legacy:p1',
      'spec-p-other',
    ]);
    const userChild = specRoot.children?.find((c) => c.key === 'spec-user');
    expect(userChild?.children?.[0].key).toBe('spec-u-spec-user0001');

    const projectRoot = roots[1];
    const p1 = projectRoot.children?.find((c) => c.key === 'proj-legacy:p1');
    expect(p1?.children?.map((c) => c.key)).toEqual([
      'proj-tasks-legacy:p1',
      'proj-specs-legacy:p1',
    ]);
    const p2 = projectRoot.children?.find((c) => c.key === 'proj-legacy:p2');
    expect(p2?.children).toBeUndefined();

    const taskRoot = roots[2];
    const t1 = taskRoot.children?.find((c) => c.key === 'task-t1');
    expect(t1?.children?.map((c) => c.key)).toEqual([
      'task-projects-t1',
      'task-specs-t1',
      'task-subtasks-t1',
    ]);
    const scope = t1?.children?.[1];
    expect(scope?.children?.[0].meta?.scope).toBe('用户级');
    expect(t1?.children?.[2].children?.[0].key).toBe('task-t1-t2');

    // spec-item 的关联任务子节点
    const userSpecChild = specRoot.children?.[1].children?.[0];
    expect(userSpecChild?.children?.[0].key).toBe('spec-task-spec-user0001-t1');
  });

  it('域筛选：整域勾选与按用户勾选、无数据域跳过、localDataFilter=false', async () => {
    const pack: DomainDataPack = {
      domains: [
        { hash: 'hash1111aaaa', label: '经验包一', use: 'reference', users: ['alice'] },
        { hash: 'hash2222bbbb', label: '', use: 'reference', users: ['bob'] },
        { hash: 'hash3333cccc', label: '空域', use: 'off', users: ['carol'] },
      ],
      degraded: [],
      specs: [
        {
          source: 'hash1111aaaa',
          scope: 'user',
          username: 'alice',
          contractId: null,
          filePath: '/d/spec/a.md',
          fileName: 'a.md',
          relativePath: 'a.md',
          title: '域规范 A',
          tags: [],
          content: '',
        },
        {
          source: 'hash2222bbbb',
          scope: 'global',
          username: 'bob',
          contractId: null,
          filePath: '/d/spec/b.md',
          fileName: 'b.md',
          relativePath: 'b.md',
          title: '域规范 B',
          tags: [],
          content: '',
        },
      ],
      tasks: [
        {
          id: 'dt1',
          title: '域任务',
          status: 'planning',
          source: 'hash1111aaaa',
          username: 'alice',
        } as never,
      ],
      projects: [
        {
          id: 'dp1',
          ids: ['dp1'],
          name: '域项目',
          localPaths: [],
          source: 'hash1111aaaa',
          username: 'alice',
          contractId: 'contract-dp1',
        } as never,
      ],
    };
    const adapter = makeAdapter({ getDomainsData: vi.fn(async () => pack) });
    setAdapter(adapter as never);

    canvasStore.domainFilter = ['hash1111aaaa'];
    canvasStore.localDataFilter = false;
    const { result } = renderHook(() => useTreeData(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.tree).toHaveLength(1));

    const domainRoot = result.current.tree[0];
    expect(domainRoot.key).toBe('root-domain');
    expect(domainRoot.children).toHaveLength(1);
    const domain = domainRoot.children?.[0];
    expect(domain?.title).toBe('经验包一');
    expect(domain?.children?.map((c) => c.key)).toEqual([
      'domain-hash1111aaaa-projects',
      'domain-hash1111aaaa-specs',
      'domain-hash1111aaaa-tasks',
    ]);
    expect(domain?.children?.[0].children?.[0].entityId).toBe(
      'domain:hash1111:project:contract-dp1',
    );

    // 按用户勾选：仅 bob 的域数据
    canvasStore.domainFilter = [];
    canvasStore.domainUserFilter = ['hash2222bbbb:bob'];
    const userFiltered = renderHook(() => useTreeData(), { wrapper: wrapper() });
    await waitFor(() => expect(userFiltered.result.current.tree).toHaveLength(1));
    expect(userFiltered.result.current.tree[0]?.children?.[0].title).toMatch(/2222/);

    // 勾选但无数据：树为空
    canvasStore.domainUserFilter = ['hash3333cccc:carol'];
    const empty = renderHook(() => useTreeData(), { wrapper: wrapper() });
    await waitFor(() => expect(adapter.getDomainsData).toHaveBeenCalled());
    await waitFor(() => expect(empty.result.current.tree).toEqual([]));
  });
});
