/**
 * AgentCanvas — React Flow 对话树画布
 * 两种节点：root-input（始终存在的输入框）+ conversation（一轮对话）
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
import {
  agentStore,
  initAgent,
  getChildIds,
  ROOT_INPUT_ID,
  type NodeUiState,
  type TurnNode,
} from './agentStore';
import { layoutTree, type LayoutNode } from './agentLayout';
import { ConversationNodeComponent } from './ConversationNodeComponent';
import { RootInputNode } from './RootInputNode';

const nodeTypes = { conversation: ConversationNodeComponent, 'root-input': RootInputNode };

const ROOT_WIDTH = 340;
const ROOT_HEIGHT = 80;

function AgentCanvasInner() {
  const snap = useSnapshot(agentStore);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    initAgent();
  }, []);

  const allTurns = useMemo(() => [...snap.turns.values()], [snap.version]);

  useEffect(() => {
    // 构建 LayoutNode[]（root + turns）
    const layoutNodes: LayoutNode[] = [];

    // root input 节点
    const rootChildren = allTurns.filter((t) => t.parentTurnId === null).map((t) => t.id);
    layoutNodes.push({
      id: ROOT_INPUT_ID,
      parentId: null,
      width: ROOT_WIDTH,
      height: ROOT_HEIGHT,
      childIds: rootChildren,
    });

    // turn 节点
    for (const t of allTurns) {
      const ui = agentStore.ui.get(t.id) as NodeUiState | undefined;
      layoutNodes.push({
        id: t.id,
        parentId: t.parentTurnId ?? ROOT_INPUT_ID,
        width: ui?.width ?? 340,
        height: ui?.height ?? 260,
        childIds: getChildIds(t.id),
      });
    }

    const { positions } = layoutTree(layoutNodes);

    // React Flow nodes
    const flowNodes: Node[] = [];

    // root input
    flowNodes.push({
      id: ROOT_INPUT_ID,
      type: 'root-input',
      position: positions.get(ROOT_INPUT_ID) ?? { x: 0, y: 0 },
      data: {},
      style: { width: ROOT_WIDTH, height: ROOT_HEIGHT },
      measured: { width: ROOT_WIDTH, height: ROOT_HEIGHT },
      draggable: false,
    });

    // turns
    for (const t of allTurns) {
      const ui = agentStore.ui.get(t.id) as NodeUiState | undefined;
      const w = ui?.width ?? 340;
      const h = ui?.height ?? 260;
      flowNodes.push({
        id: t.id,
        type: 'conversation',
        position: positions.get(t.id) ?? { x: 0, y: 0 },
        data: { turnId: t.id },
        style: { width: w, height: h },
        measured: { width: w, height: h },
        width: w,
        height: h,
        draggable: false,
      });
    }

    // Edges
    const flowEdges: Edge[] = [];
    // root → 顶级 turns
    for (const t of allTurns.filter((t) => t.parentTurnId === null)) {
      flowEdges.push({
        id: `root-${t.id}`,
        source: ROOT_INPUT_ID,
        target: t.id,
        type: 'smoothstep',
        style: { stroke: 'var(--brand-color)', strokeWidth: 1.5 },
      });
    }
    // turn → children
    for (const t of allTurns) {
      for (const childId of getChildIds(t.id)) {
        const childTurn = agentStore.turns.get(childId) as TurnNode | undefined;
        flowEdges.push({
          id: `${t.id}-${childId}`,
          source: t.id,
          target: childId,
          type: 'smoothstep',
          animated: childTurn?.status === 'streaming',
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
