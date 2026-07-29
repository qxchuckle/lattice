/**
 * ConversationTreeCanvas — React Flow 对话树画布
 */
import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSnapshot } from 'valtio';
import type { ConversationNode } from '@qcqx/lattice-agent';
import { ConversationNodeCard } from './ConversationNodeCard';
import { workbenchStore, selectNode, setMultiSelect } from './store';

const nodeTypes = { conversation: ConversationNodeCard };

/** 将对话树节点转换为 React Flow 布局（简单水平分层） */
function layoutNodes(
  nodes: ConversationNode[],
  headId: string | null,
  selectedId: string | null,
  streamingText: string,
  agentStatus: string,
): Node[] {
  // 按 parentId 分组
  const childrenMap = new Map<string | null, ConversationNode[]>();
  for (const n of nodes) {
    const key = n.parentId;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(n);
  }

  // BFS 分层布局
  const positions = new Map<string, { x: number; y: number }>();
  const roots = childrenMap.get(null) ?? [];

  const assignPositions = (nodeList: ConversationNode[], depth: number, baseY: number): number => {
    let currentY = baseY;
    for (const node of nodeList) {
      positions.set(node.id, { x: depth * 260, y: currentY });
      const children = childrenMap.get(node.id) ?? [];
      if (children.length > 0) {
        const childHeight = assignPositions(children, depth + 1, currentY);
        currentY = childHeight + 60;
      } else {
        currentY += 100;
      }
    }
    return currentY;
  };

  assignPositions(roots, 0, 0);

  return nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const isStreaming = agentStatus === 'running' && n.id === headId;
    return {
      id: n.id,
      type: 'conversation',
      position: pos,
      data: {
        node: n,
        isHead: n.id === headId,
        isSelected: n.id === selectedId,
        isStreaming,
        streamingText: isStreaming ? streamingText : undefined,
      },
    };
  });
}

function buildEdges(nodes: ConversationNode[]): Edge[] {
  return nodes
    .filter((n) => n.parentId !== null)
    .map((n) => ({
      id: `${n.parentId}-${n.id}`,
      source: n.parentId!,
      target: n.id,
      style: { stroke: '#BFBFBF', strokeWidth: 1.5 },
      animated: false,
    }));
}

interface Props {
  onNodeClick?: (nodeId: string) => void;
  onNodeContextMenu?: (nodeId: string, e: React.MouseEvent) => void;
}

export function ConversationTreeCanvas({ onNodeClick, onNodeContextMenu }: Props) {
  const snap = useSnapshot(workbenchStore);

  const flowNodes = useMemo(
    () =>
      layoutNodes(
        snap.nodes as ConversationNode[],
        snap.headNodeId,
        snap.selectedNodeId,
        snap.streamingText,
        snap.agentStatus,
      ),
    [snap.nodes, snap.headNodeId, snap.selectedNodeId, snap.streamingText, snap.agentStatus],
  );

  const flowEdges = useMemo(() => buildEdges(snap.nodes as ConversationNode[]), [snap.nodes]);

  const [rfNodes, , onNodesChange] = useNodesState(flowNodes);
  const [rfEdges, , onEdgesChange] = useEdgesState(flowEdges);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      onNodeContextMenu?.(node.id, e);
    },
    [onNodeContextMenu],
  );

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    if (params.nodes.length > 1) {
      setMultiSelect(params.nodes.map((n) => n.id));
    }
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={rfNodes.length > 0 ? rfNodes : flowNodes}
        edges={rfEdges.length > 0 ? rfEdges : flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onSelectionChange={handleSelectionChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={2}
        selectionOnDrag
        panOnDrag={[1, 2]}>
        <Background gap={20} size={1} />
        <Controls position='bottom-left' />
        <MiniMap
          position='bottom-right'
          nodeStrokeWidth={3}
          nodeColor={(n) => {
            const data = n.data as { isHead?: boolean };
            return data?.isHead ? '#1677FF' : '#D9D9D9';
          }}
        />
      </ReactFlow>
    </div>
  );
}
