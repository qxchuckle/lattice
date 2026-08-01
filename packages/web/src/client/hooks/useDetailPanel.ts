/**
 * useDetailPanel — 详情面板状态管理 hook
 *
 * 从 DetailPanel.tsx 拆分：封装 detailStore 状态读取 +
 * useEntityDetail 查询逻辑，供 DetailPanel 组件消费。
 */
import { useSnapshot } from 'valtio';
import { detailStore } from '../store';
import { useEntityDetail } from './data';
import type { LatticeNodeData } from '../types/graph';

export interface DetailPanelState {
  entityId: string | null;
  entityType: 'task' | 'project' | 'spec' | null;
  entityData: LatticeNodeData | null;
  isApiType: boolean;
  isLoading: boolean;
  isError: boolean;
  data: Awaited<ReturnType<ReturnType<typeof useEntityDetail>['refetch']>> | null;
}

/**
 * 读取详情面板状态 + API 查询
 * - task/project 走 API（useEntityDetail）
 * - spec 直接从节点 data 渲染（不走 API）
 */
export function useDetailPanel() {
  const { entityId, entityType, entityData } = useSnapshot(detailStore);
  const isApiType = entityType === 'task' || entityType === 'project';
  const detailQuery = useEntityDetail(isApiType ? entityId : null, isApiType ? entityType : null);

  return {
    entityId,
    entityType,
    entityData,
    isApiType,
    isLoading: detailQuery.isLoading,
    isError: !!detailQuery.error,
    data: detailQuery.data ?? null,
    refetch: detailQuery.refetch,
  };
}
