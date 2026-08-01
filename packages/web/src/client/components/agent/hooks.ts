/**
 * Agent React Query hooks — 服务器数据（sources/models）走 Query 单一真相
 *
 * 批次四重构：sources/models 从 valtio 迁移到 React Query。
 * agentStore 只保留 activeSourceId/activeModelId 引用 ID。
 * actions 仍可通过 queryClient.getQueryData 同步读取（非 hook 上下文）。
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadSources, fetchModels } from './api';
import { agentStore } from './store';

/** Agent 查询键 */
export const agentQueryKeys = {
  sources: ['agent-sources'] as const,
  models: (sourceId?: string) => ['agent-models', sourceId ?? 'all'] as const,
  config: ['agent-config'] as const,
};

/**
 * 源列表 hook（服务器数据 → React Query 单一真相）
 * initialData 从 agentStore.sources 种子化缓存，避免首屏闪烁。
 * store 回写改由 useEffect 订阅，避免后台 refetch 副作用污染 store。
 */
export function useSources() {
  const query = useQuery({
    queryKey: agentQueryKeys.sources,
    queryFn: async () => {
      await loadSources();
      return agentStore.sources;
    },
    staleTime: 30_000,
    initialData: () => (agentStore.sources.length > 0 ? agentStore.sources : undefined),
    refetchOnWindowFocus: false,
  });
  // queryFn 成功后同步回 store（仅前台主动查询，后台 refetch 不写 store）
  useEffect(() => {
    if (query.data && query.data !== agentStore.sources) {
      agentStore.sources = query.data;
    }
  }, [query.data]);
  return query;
}

/**
 * 模型列表 hook（按源 ID 查询）
 * initialData 从 agentStore.models 种子化缓存，避免首屏闪烁。
 * store 回写改由 useEffect 订阅，避免后台 refetch 副作用污染 store。
 */
export function useModels(sourceId?: string) {
  const query = useQuery({
    queryKey: agentQueryKeys.models(sourceId),
    queryFn: async () => fetchModels(sourceId),
    staleTime: 30_000,
    initialData: () =>
      agentStore.models.length > 0 && (sourceId === agentStore.activeSourceId || !sourceId)
        ? agentStore.models
        : undefined,
    refetchOnWindowFocus: false,
  });
  // queryFn 成功后同步回 store（仅前台主动查询，后台 refetch 不写 store）
  useEffect(() => {
    if (query.data && (sourceId === agentStore.activeSourceId || !sourceId)) {
      agentStore.models = query.data;
      if (query.data.length > 0 && !agentStore.activeModelId) {
        agentStore.activeModelId = query.data[0].id;
      }
    }
  }, [query.data, sourceId]);
  return query;
}

/**
 * 同步获取源列表（非 hook 上下文用，如 actions）
 * 从 React Query 缓存读取，回退到 agentStore.sources（兼容测试直接注入）。
 */
export function getSourcesSync(): typeof agentStore.sources {
  // actions 在非 hook 上下文运行，优先从 agentStore 读（测试和 queryFn 保持同步）
  return agentStore.sources;
}
