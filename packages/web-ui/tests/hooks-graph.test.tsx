import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSpecGraph, useTaskGraph } from '../src/hooks/graph';
import { setAdapter } from '../src/adapters';
import type { ParsedSpec, ProjectMeta, TaskMeta } from '@qcqx/lattice-core';

/**
 * hooks/graph.ts 的 useTaskGraph / useSpecGraph：
 * 以假 adapter（React Query）驱动图构建，断言节点/边集合与加载态。
 */

interface FakeAdapter {
  getTask: ReturnType<typeof vi.fn>;
  getSpecs: ReturnType<typeof vi.fn>;
  getTaskContext: ReturnType<typeof vi.fn>;
  getTasks: ReturnType<typeof vi.fn>;
  getProjects: ReturnType<typeof vi.fn>;
  getRelations: ReturnType<typeof vi.fn>;
}

function makeAdapter(overrides: Partial<FakeAdapter> = {}): FakeAdapter {
  return {
    getTask: vi.fn(async () => null),
    getSpecs: vi.fn(async () => ({ global: [], user: [], project: [] })),
    getTaskContext: vi.fn(async () => ({ semanticSpecs: [] })),
    getTasks: vi.fn(async () => []),
    getProjects: vi.fn(async () => []),
    getRelations: vi.fn(async () => []),
    ...overrides,
  };
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function spec(
  fileName: string,
  id: string,
  title: string,
  filePath: string,
  projectId?: string,
): ParsedSpec {
  return { fileName, filePath, frontmatter: { id, title }, projectId } as unknown as ParsedSpec;
}

function task(id: string, title: string, extra: Partial<TaskMeta> = {}): TaskMeta {
  return { id, title, status: 'planning', ...extra } as unknown as TaskMeta;
}

function project(id: string, name: string): ProjectMeta {
  return { id, ids: [id], name, localPaths: [] } as unknown as ProjectMeta;
}

function ids(hookResult: { nodes: Array<{ id: string }> }): string[] {
  return hookResult.nodes.map((n) => n.id).sort();
}

afterEach(() => {
  cleanup();
});

describe('useTaskGraph', () => {
  it('无锚点：展示全部任务 + 父子边', async () => {
    const adapter = makeAdapter({
      getTasks: vi.fn(async () => [
        task('t1', '父任务'),
        task('t2', '子任务', { parentTaskId: 't1' }),
      ]),
    });
    setAdapter(adapter as never);

    const { result } = renderHook(() => useTaskGraph(null), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(ids(result.current).sort()).toEqual(['t1', 't2']);
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.edges[0].label).toBe('parent');
    // 无锚点时不应发起详情查询
    expect(adapter.getTask).not.toHaveBeenCalled();
  });

  it('锚点任务：项目/scope/父任务/引用 spec/语义 spec/子任务全部入图', async () => {
    const referenced = spec(
      'x.md',
      'spec-aaaaaaaa',
      '引用规范',
      '/u/projects/p1/spec/x.md',
      'legacy:p1',
    );
    const semantic = spec('y.md', 'spec-bbbbbbbb', '语义规范', '/u/spec/y.md');
    const adapter = makeAdapter({
      getTask: vi.fn(async () =>
        task('t1', '中心任务', {
          projects: ['legacy:p1'],
          scopePaths: [{ projectId: 'legacy:p2' } as never],
          referencedSpecs: [{ id: 'spec-aaaaaaaa' } as never],
          parentTaskId: 't0',
        }),
      ),
      getProjects: vi.fn(async () => [
        project('legacy:p1', '项目一'),
        project('legacy:p2', '项目二'),
      ]),
      getSpecs: vi.fn(async () => ({ global: [], user: [], project: [referenced] })),
      getTaskContext: vi.fn(async () => ({ semanticSpecs: [semantic] })),
      getTasks: vi.fn(async () => [
        task('t0', '父任务'),
        task('t3', '子任务', { parentTaskId: 't1' }),
      ]),
    });
    setAdapter(adapter as never);

    const { result } = renderHook(() => useTaskGraph('t1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(ids(result.current)).toEqual(
      [
        't0',
        't1',
        'legacy:p1',
        'legacy:p2',
        'spec-spec-aaaaaaaa',
        'spec-spec-bbbbbbbb',
        't3',
      ].sort(),
    );
    const labels = result.current.edges.map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining(['belongs-to', 'scope', 'parent', 'ref-spec', 'semantic']),
    );
    // 项目名解析：p1 用 adapter 返回的名称，p2 仅 scope 边（无 projects 关联）
    const p1 = result.current.nodes.find((n) => n.id === 'legacy:p1')!;
    expect(p1.data.name).toBe('项目一');
    const specNode = result.current.nodes.find((n) => n.id === 'spec-spec-aaaaaaaa')!;
    expect(specNode.data).toMatchObject({
      entityType: 'spec',
      scope: 'project',
      title: '引用规范',
    });
  });

  it('查询未完成时 isLoading 为 true 且图为空', async () => {
    const adapter = makeAdapter({
      getTask: vi.fn(() => new Promise(() => {})),
      getTasks: vi.fn(() => new Promise(() => {})),
    });
    setAdapter(adapter as never);

    const { result } = renderHook(() => useTaskGraph('t1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
  });
});

describe('useSpecGraph', () => {
  it('spec 全景：项目节点、覆盖链、任务引用、父子与关系边', async () => {
    const g = spec('shared.md', 'spec-global01', '全局规范', '/u/spec/shared.md');
    const u = spec('shared.md', 'spec-user0002', '用户规范', '/u/user/spec/shared.md');
    const p = spec(
      'shared.md',
      'spec-proj003',
      '项目规范',
      '/u/projects/p1/spec/shared.md',
      'legacy:p1',
    );
    const referenced = task('t1', '引用任务', {
      projects: ['legacy:p1'],
      referencedSpecs: [{ id: 'spec-user0002' } as never],
    });
    const child = task('t2', '子任务', {
      parentTaskId: 't1',
      referencedSpecs: [{ id: 'spec-global01' } as never],
    });

    const adapter = makeAdapter({
      getProjects: vi.fn(async () => [
        project('legacy:p1', '项目一'),
        project('legacy:p2', '项目二'),
      ]),
      getSpecs: vi.fn(async () => ({ global: [g], user: [u], project: [p] })),
      getTasks: vi.fn(async () => [referenced, child]),
      getRelations: vi.fn(async () => [
        {
          id: 'rel-1',
          type: 'depends-on',
          projectA: 'legacy:p1',
          projectB: 'legacy:p2',
        },
      ]),
    });
    setAdapter(adapter as never);

    const { result } = renderHook(() => useSpecGraph('spec-user0002'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const nodeIds = ids(result.current);
    expect(nodeIds).toEqual(
      [
        'legacy:p1',
        'legacy:p2',
        'spec-spec-global01',
        'spec-spec-user0002',
        'spec-spec-proj003',
        't1',
        't2',
      ].sort(),
    );

    const labels = result.current.edges.map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining(['spec', 'overrides', 'ref-spec', 'task', 'parent', 'depends-on']),
    );
    // 覆盖链：global → user → project 两条 overrides 边
    expect(labels.filter((l) => l === 'overrides')).toHaveLength(2);
    // 关系边带 animated（depends-on）
    const relationEdge = result.current.edges.find((e) => e.id === 'rel-1')!;
    expect(relationEdge.animated).toBe(true);
  });

  it('spec 查询未返回时仅项目节点，isLoading 为 true', async () => {
    const adapter = makeAdapter({
      getSpecs: vi.fn(() => new Promise(() => {})),
      getProjects: vi.fn(async () => [project('legacy:p1', '项目一')]),
      getTasks: vi.fn(async () => []),
    });
    setAdapter(adapter as never);

    const { result } = renderHook(() => useSpecGraph(null), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
    // 项目查询已解析、spec 查询仍在途：仅项目节点入图
    await waitFor(() => expect(ids(result.current)).toEqual(['legacy:p1']));
    expect(result.current.isLoading).toBe(true);
  });
});
