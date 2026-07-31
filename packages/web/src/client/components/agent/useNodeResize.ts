/**
 * useNodeResize — 节点缩放 + dagre 碰撞重布局 hook
 * 从 ConversationNodeComponent 解耦
 */
import { useCallback } from 'react';
import { useStoreApi, type NodeChange } from '@xyflow/react';
import { agentStore, liveResizeNode, setNodeSize, getChildIds } from './agentStore';
import { isVisibleTurnStatus } from './turnState';
import { layoutTree, type LayoutNode } from './agentLayout';

export function useNodeResize(nodeId: string) {
  const store = useStoreApi();

  const onResize = useCallback(
    (_e: unknown, params: { x: number; y: number; width: number; height: number }) => {
      liveResizeNode(nodeId, params.width, params.height);

      // 与画布布局同口径：排除 hidden（已删除不参与布局），否则重布局位置会偏移
      const layoutNodes: LayoutNode[] = [...agentStore.turns.values()]
        .filter((t) => isVisibleTurnStatus(t.status))
        .map((t) => {
          const u = agentStore.ui.get(t.id);
          return {
            id: t.id,
            parentId: t.parentTurnId,
            width: u?.width ?? 340,
            height: u?.height ?? 260,
            childIds: getChildIds(t.id),
          };
        });
      const { positions } = layoutTree(layoutNodes);
      const dagrePos = positions.get(nodeId);
      if (!dagrePos) return;

      const dx = params.x - dagrePos.x;
      const dy = params.y - dagrePos.y;
      const { nodeLookup, triggerNodeChanges } = store.getState();
      const changes: NodeChange[] = [];
      for (const t of agentStore.turns.values()) {
        if (t.id === nodeId) continue;
        const dp = positions.get(t.id);
        if (!dp) continue;
        const target = { x: dp.x + dx, y: dp.y + dy };
        const cur = nodeLookup.get(t.id);
        if (
          !cur ||
          Math.abs(cur.position.x - target.x) > 0.5 ||
          Math.abs(cur.position.y - target.y) > 0.5
        ) {
          changes.push({ id: t.id, type: 'position', position: target });
        }
      }
      if (changes.length > 0) triggerNodeChanges(changes);
    },
    [nodeId, store],
  );

  const onResizeEnd = useCallback(
    (_e: unknown, params: { width: number; height: number }) => {
      setNodeSize(nodeId, params.width, params.height);
    },
    [nodeId],
  );

  return { onResize, onResizeEnd };
}
