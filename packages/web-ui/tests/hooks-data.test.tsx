import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  useDomainsData,
  useEntityDetail,
  useHomeTilde,
  useProjectGitStatus,
  useProjectTaskSearch,
  useStats,
  useUsers,
} from '../src/hooks/data';
import { setAdapter } from '../src/adapters';
import { makeQueryClient } from './helpers/component';

const task = { id: 't1', title: '任务一' };
const project = { id: 'p1', name: '项目一' };
const adapter = {
  getTask: vi.fn(async () => task),
  getTaskProgress: vi.fn(async () => ({ total: 2, completed: 1 })),
  getProject: vi.fn(async () => project),
  getProjectGitStatus: vi.fn(async () => ({ branch: 'main' })),
  getProjectSpecs: vi.fn(async () => []),
  getProjectTasks: vi.fn(async () => []),
  getProjectRelations: vi.fn(async () => []),
  getStats: vi.fn(async () => ({ projects: 1 })),
  getGlobalStatus: vi.fn(async () => ({ home: '/home/u', pathSep: '/' })),
  getUsers: vi.fn(async () => ({ users: ['alice'], currentUser: 'alice' })),
  getDomainsData: vi.fn(async () => ({
    domains: [],
    degraded: [],
    specs: [],
    tasks: [],
    projects: [],
  })),
  search: vi.fn(async () => []),
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  setAdapter(adapter as never);
  for (const fn of Object.values(adapter)) fn.mockClear();
});

afterEach(() => cleanup());

describe('hooks/data', () => {
  it('useEntityDetail：task 域前缀剥离、project 容错、not_found 与禁用', async () => {
    const taskHook = renderHook(() => useEntityDetail('domain:abcd1234:task:t1', 'task'), {
      wrapper,
    });
    await waitFor(() => expect(taskHook.result.current.data?.type).toBe('task'));
    expect(adapter.getTask).toHaveBeenCalledWith('t1');
    expect(adapter.getTaskProgress).toHaveBeenCalledWith('t1');

    adapter.getProjectGitStatus.mockRejectedValueOnce(new Error('no git'));
    const projectHook = renderHook(() => useEntityDetail('p1', 'project'), { wrapper });
    await waitFor(() => expect(projectHook.result.current.data?.type).toBe('project'));
    expect(projectHook.result.current.data).toMatchObject({ gitStatus: null, specs: [] });

    adapter.getProject.mockResolvedValueOnce({ error: 'not_found' } as never);
    const missing = renderHook(() => useEntityDetail('p2', 'project'), { wrapper });
    await waitFor(() => expect(missing.result.current.isSuccess).toBe(true));
    expect(missing.result.current.data).toBeNull();

    const disabled = renderHook(() => useEntityDetail(null, null), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe('idle');

    const unknown = renderHook(() => useEntityDetail('x', 'unknown'), { wrapper });
    await waitFor(() => expect(unknown.result.current.isSuccess).toBe(true));
    expect(unknown.result.current.data).toBeNull();
  });

  it('git/status/home/users/domains/项目任务搜索', async () => {
    const git = renderHook(() => useProjectGitStatus('p1'), { wrapper });
    await waitFor(() => expect(git.result.current.data).toEqual({ branch: 'main' }));
    const stats = renderHook(() => useStats(), { wrapper });
    await waitFor(() => expect(stats.result.current.data).toEqual({ projects: 1 }));
    const users = renderHook(() => useUsers(), { wrapper });
    await waitFor(() => expect(users.result.current.data?.users).toEqual(['alice']));
    const domains = renderHook(() => useDomainsData(), { wrapper });
    await waitFor(() => expect(domains.result.current.data?.domains).toEqual([]));

    const home = renderHook(() => useHomeTilde(), { wrapper });
    expect(home.result.current('/home/u/a')).toBe('/home/u/a');
    await waitFor(() => expect(home.result.current('/home/u/a')).toBe('~/a'));
    expect(home.result.current(null)).toBe('');

    const search = renderHook(() => useProjectTaskSearch('p1', '任务'), { wrapper });
    await waitFor(() => expect(adapter.search).toHaveBeenCalled(), { timeout: 2000 });
    expect(adapter.search).toHaveBeenCalledWith(
      '任务',
      expect.objectContaining({ type: 'task', projectId: 'p1', limit: 50 }),
    );
  });
});
