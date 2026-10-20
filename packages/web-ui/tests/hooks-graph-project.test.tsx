import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProjectGraph } from '../src/hooks/graph';
import { setAdapter } from '../src/adapters';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function project(id: string, name: string, ids: string[] = [id]) {
  return { id, ids, name, gitRemotes: [{ name: 'origin' }], localPaths: [] } as never;
}
function spec(fileName: string, id: string, title: string, filePath: string) {
  return { fileName, filePath, frontmatter: { id, title } } as never;
}
function task(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, title, status: 'planning', ...extra } as never;
}

const p1 = project('p1', '项目一');
const p2 = project('p2', '项目二');

function fullAdapter() {
  return {
    getProject: vi.fn(async () => p1),
    getProjectSpecs: vi.fn(async () => [
      spec('shared.md', 'p-spec', '项目规范', '/u/projects/p1/spec/shared.md'),
    ]),
    getProjectTasks: vi.fn(async () => [
      task('t1', '中心任务', {
        projects: ['p1'],
        referencedSpecs: [{ id: 'u-spec' }, { id: 'g-spec' }, { id: 'p-spec' }],
        parentTaskId: 't0',
      }),
    ]),
    getProjectRelations: vi.fn(async () => [
      { id: 'r1', type: 'depends-on', projectA: 'p1', projectB: 'p2' },
    ]),
    getTasks: vi.fn(async () => [
      task('t0', '父任务'),
      task('t-extra', '范围任务', {
        scopePaths: [{ projectId: 'p1' }],
        referencedSpecs: [{ id: 'g-spec' }],
        parentTaskId: 't0x',
      }),
      task('t2', '关系项目任务', {
        projects: ['p2'],
        referencedSpecs: [{ id: 'p2-spec' }],
        parentTaskId: 't0',
      }),
      task('t3', '关系项目范围任务', {
        scopePaths: [{ projectId: 'p2' }],
        referencedSpecs: [{ id: 'p2-spec' }],
        parentTaskId: 't0',
      }),
    ]),
    getSpecs: vi.fn(async () => ({
      global: [spec('shared.md', 'g-spec', '全局规范', '/g/shared.md')],
      user: [spec('shared.md', 'u-spec', '用户规范', '/u/spec/shared.md')],
      project: [
        spec('shared.md', 'p-spec', '项目规范', '/u/projects/p1/spec/shared.md'),
        spec('other.md', 'p2-spec', '关系项目规范', '/u/projects/p2/spec/other.md'),
      ],
    })),
    getProjects: vi.fn(async () => [p1, p2]),
    getRelations: vi.fn(async () => [
      { id: 'r1', type: 'depends-on', projectA: 'p1', projectB: 'p2' },
    ]),
  };
}

afterEach(() => cleanup());

describe('useProjectGraph', () => {
  it('无锚点：全部项目 + 关系边', async () => {
    const adapter = fullAdapter();
    setAdapter(adapter as never);
    const { result } = renderHook(() => useProjectGraph(null), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(['p1', 'p2']);
    const edge = result.current.edges.find((e) => e.id === 'r1')!;
    expect(edge).toMatchObject({ source: 'p1', target: 'p2', label: 'depends-on', animated: true });
  });

  it('项目锚点：Spec 覆盖链/引用、任务父子、scope、关系项目递归', { timeout: 15000 }, async () => {
    const adapter = fullAdapter();
    setAdapter(adapter as never);
    const { result } = renderHook(() => useProjectGraph('p1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const ids = result.current.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'p1',
        'spec-p1-shared.md',
        'spec-user-u-spec',
        'spec-global-g-spec',
        't1',
        't-extra',
        'p2',
        'spec-p2-other.md',
        't2',
        't3',
      ]),
    );
    const labels = result.current.edges.map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'spec',
        'overrides',
        'ref-spec',
        'parent',
        'task',
        'scope',
        'depends-on',
      ]),
    );
    expect(labels.filter((l) => l === 'overrides')).toHaveLength(2);
    // 关系项目递归：正式任务用 task，scopePaths 命中用 scope
    const p2Task = result.current.edges.find((e) => e.id === 'edge-p2-t2')!;
    expect(p2Task.label).toBe('task');
    const p2Scope = result.current.edges.find((e) => e.id === 'edge-p2-t3')!;
    expect(p2Scope.label).toBe('scope');
    // 项目自身 scopePaths 补充任务
    expect(result.current.edges.some((e) => e.id === 'edge-scope-p1-t-extra')).toBe(true);
    // 引用 spec 边：项目 spec / 用户 spec / 全局 spec
    expect(
      result.current.edges.filter((e) => e.label === 'ref-spec').length,
    ).toBeGreaterThanOrEqual(5);
    // 中心项目节点带 hasGit
    const center = result.current.nodes.find((n) => n.id === 'p1')!;
    expect(center.data).toMatchObject({ entityType: 'project', hasGit: true });
  });

  it('项目不存在/错误时不产出节点；加载中 isLoading', async () => {
    const adapter = fullAdapter();
    adapter.getProject.mockResolvedValueOnce({ error: 'not_found' } as never);
    setAdapter(adapter as never);
    const missing = renderHook(() => useProjectGraph('missing'), { wrapper: makeWrapper() });
    await waitFor(() => expect(missing.result.current.isLoading).toBe(false));
    expect(missing.result.current.nodes).toEqual([]);

    cleanup();
    adapter.getProject.mockImplementation(() => new Promise(() => {}));
    const loading = renderHook(() => useProjectGraph('p1'), { wrapper: makeWrapper() });
    expect(loading.result.current.isLoading).toBe(true);
    expect(loading.result.current.nodes).toEqual([]);
  });
});
