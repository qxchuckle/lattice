/**
 * agentLayout — 对话树布局算法（dagre）
 * 独立模块，供 AgentCanvas（初始/最终布局）与节点组件（实时缩放布局）共享，
 * 避免 AgentCanvas ↔ ConversationNodeComponent 循环依赖
 */
import dagre from '@dagrejs/dagre';

/** 布局所需的最小节点接口 */
export interface LayoutNode {
  id: string;
  parentId: string | null;
  width: number;
  height: number;
  childIds: string[];
}

/** 节点最小间距（同层水平间距 / 父子层间距） */
export const NODE_GAP = 40;
export const RANK_GAP = 60;

/** 计算每个节点的树深度（根 = 0），用于同层顶对齐 */
function computeDepths(nodes: LayoutNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depths = new Map<string, number>();
  const getDepth = (node: LayoutNode): number => {
    const cached = depths.get(node.id);
    if (cached !== undefined) return cached;
    let d = 0;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) d = getDepth(parent) + 1;
    depths.set(node.id, d);
    return d;
  };
  for (const n of nodes) getDepth(n);
  return depths;
}

/** dagre 自动布局：从上到下，使用每个节点的实际宽高 */
export function layoutTree(nodes: LayoutNode[]): {
  positions: Map<string, { x: number; y: number }>;
} {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: NODE_GAP, ranksep: RANK_GAP });

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const node of nodes) {
    for (const childId of node.childIds) {
      g.setEdge(node.id, childId);
    }
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) {
      // dagre 返回中心点坐标，转换为左上角坐标
      positions.set(node.id, { x: pos.x - node.width / 2, y: pos.y - node.height / 2 });
    }
  }

  // 同层节点顶部对齐（dagre 默认垂直居中，矮节点会悬浮在高节点中间）
  // 按树深度分组，每组取最小 top（即最高节点的顶部），统一对齐
  const depths = computeDepths(nodes);
  const minTopByDepth = new Map<number, number>();
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const d = depths.get(node.id) ?? 0;
    const cur = minTopByDepth.get(d);
    if (cur === undefined || pos.y < cur) minTopByDepth.set(d, pos.y);
  }
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const d = depths.get(node.id) ?? 0;
    const top = minTopByDepth.get(d);
    if (top !== undefined) pos.y = top;
  }

  return { positions };
}
