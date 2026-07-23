/**
 * AgentCanvas — React Flow 对话树画布
 * 使用 dagre 自动布局，节点从上到下排列（父→子）
 * 布局采用每个节点的实际宽高，保证节点间最小间距（碰撞不重叠）
 * 节点尺寸变化后重新布局 → 变大挤开其他节点，变小自动收缩间距
 */
import { useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSnapshot } from 'valtio';
import { agentStore, initAgentTree, type TreeNode } from './agentStore';
import { layoutTree } from './agentLayout';
import { ConversationNodeComponent } from './ConversationNodeComponent';

const nodeTypes = { conversation: ConversationNodeComponent };

function AgentCanvasInner() {
  const snap = useSnapshot(agentStore);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // 初始化
  useEffect(() => {
    initAgentTree();
  }, []);

  // 当 store 中的节点变化时，重新布局（依赖 version 计数器强制触发）
  const allNodes = useMemo(() => {
    return [...snap.nodes.values()] as TreeNode[];
  }, [snap.version]);

  useEffect(() => {
    if (allNodes.length === 0) return;

    const { positions } = layoutTree(allNodes);

    const flowNodes: Node[] = allNodes.map((n) => {
      return {
        id: n.id,
        type: 'conversation',
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: { nodeId: n.id },
        // 应用节点实际宽高（NodeResizer 会更新它）
        style: { width: n.width, height: n.height },
        // 关键：显式提供 measured + width/height。
        // 受控模式下每次节点对象变化，adoptUserNodes 会重建 internal node，
        // parseHandles 仅在 userNode.measured 存在时保留 handleBounds（连线端点），
        // 否则重置为 undefined → 依赖 ResizeObserver 异步重测 → 拖拽中连线脱离节点。
        measured: { width: n.width, height: n.height },
        width: n.width,
        height: n.height,
        // 位置由 dagre 布局控制，禁止自由拖动（避免与碰撞布局冲突）
        draggable: false,
      };
    });

    const flowEdges: Edge[] = [];
    for (const n of allNodes) {
      for (const childId of n.childIds) {
        flowEdges.push({
          id: `${n.id}-${childId}`,
          source: n.id,
          target: childId,
          type: 'smoothstep',
          animated: (snap.nodes.get(childId) as TreeNode | undefined)?.status === 'streaming',
          style: { stroke: 'var(--brand-color)', strokeWidth: 1.5 },
        });
      }
    }

    setRfNodes(flowNodes);
    setRfEdges(flowEdges);
  }, [snap.version]);

  const handleInit = useCallback((instance: { fitView: () => void }) => {
    setTimeout(() => instance.fitView(), 100);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--canvas-bg)' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onInit={handleInit}
        fitView
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}>
        <Background color='var(--border)' gap={20} size={1} />
        <Controls
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
          }}
        />
        <MiniMap
          nodeColor='var(--brand-color)'
          maskColor='rgba(0,0,0,0.15)'
          style={{ background: 'var(--bg-secondary)', borderRadius: 6 }}
        />
      </ReactFlow>
    </div>
  );
}

export function AgentCanvas() {
  return (
    <ReactFlowProvider>
      <AgentCanvasInner />
    </ReactFlowProvider>
  );
}
