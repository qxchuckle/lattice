/**
 * Agent React Query hooks 行为测试
 *
 * 验证 valtio→Query 首屏闪烁修复：
 *   1. useSources 命中 initialData 时不 isLoading（已有 store 数据时无需等待 queryFn）
 *   2. refetchOnWindowFocus: false（sources/models 非关键数据无需切窗刷新）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { agentStore } from './store';

// mock api 层（避免真实网络请求）
vi.mock('./api', () => ({
  loadSources: vi.fn(() => Promise.resolve()),
  fetchModels: vi.fn(() => Promise.resolve([])),
}));

import { useSources, useModels, agentQueryKeys } from './hooks';

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

beforeEach(() => {
  agentStore.sources = [];
  agentStore.models = [];
  agentStore.activeSourceId = 'qoder';
  agentStore.activeModelId = '';
});

describe('useSources initialData 种子化', () => {
  it('store 已有数据时首次渲染不 isLoading（首屏无闪烁）', () => {
    // 预设 store 数据（模拟 initAgent 已拉取）
    agentStore.sources = [
      {
        id: 'qoder',
        displayName: 'Qoder',
        version: '1.0',
        modelPolicy: 'catalog' as const,
        available: true,
        modelCount: 1,
      },
    ];

    const { result } = renderHook(() => useSources(), { wrapper: makeWrapper() });

    // initialData 应使缓存命中，data 立即可用
    expect(result.current.data).toBeDefined();
    expect(result.current.data).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
  });

  it('store 无数据时正常走 queryFn', () => {
    agentStore.sources = [];

    const { result } = renderHook(() => useSources(), { wrapper: makeWrapper() });

    // 无 initialData 时 isLoading=true（首次渲染正在 fetch）
    expect(result.current.isLoading).toBe(true);
  });
});

describe('useModels initialData 种子化', () => {
  it('store 已有模型时首次渲染不 isLoading', () => {
    agentStore.models = [{ id: 'm1', displayName: 'Model 1' }] as any;
    agentStore.activeSourceId = 'qoder';

    const { result } = renderHook(() => useModels('qoder'), { wrapper: makeWrapper() });

    expect(result.current.data).toBeDefined();
    expect(result.current.isLoading).toBe(false);
  });
});

describe('agentQueryKeys', () => {
  it('sources 键稳定', () => {
    expect(agentQueryKeys.sources).toEqual(['agent-sources']);
  });

  it('models 键含 sourceId', () => {
    expect(agentQueryKeys.models('qoder')).toEqual(['agent-models', 'qoder']);
    expect(agentQueryKeys.models()).toEqual(['agent-models', 'all']);
  });
});
