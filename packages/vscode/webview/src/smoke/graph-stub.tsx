/**
 * 冒烟画布：完整运行 useGlobalGraph 数据管线（图谱崩溃的现场），但不实例化 cytoscape。
 * 每轮渲染把 nodes/edges 暴露到 window.__smokeGraph 供 Node 侧断言。
 */
import { useEffect } from 'react';
import { useGlobalGraph } from '@lattice-web-ui';

export interface SmokeGraphNode {
  id: string;
  data?: Record<string, unknown>;
}

export interface SmokeGraphData {
  nodes: SmokeGraphNode[];
  edges: unknown[];
  isLoading: boolean;
}

declare global {
  interface Window {
    __smokeGraph?: SmokeGraphData;
  }
}

export function SmokeGraph() {
  const graphData = useGlobalGraph();
  const nodes = graphData.nodes as unknown as SmokeGraphNode[];

  useEffect(() => {
    window.__smokeGraph = {
      nodes,
      edges: graphData.edges as unknown as unknown[],
      isLoading: graphData.isLoading,
    };
  }, [nodes, graphData.edges, graphData.isLoading]);

  return (
    <div
      id='smoke-graph'
      data-loading={String(graphData.isLoading)}
      data-nodes={nodes.length}
      data-edges={graphData.edges.length}
    />
  );
}
