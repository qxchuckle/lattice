import dagre from '@dagrejs/dagre';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { tokens } from './theme';
import type { LatticeNode, LatticeEdge } from './types/graph';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

// ── 实体配色 ──

export function getEntityColor(entityType: string): string {
  return (tokens.entity as Record<string, string>)[entityType] || '#8C8C8C';
}

export function getTaskStatusColor(status: string): string {
  return (tokens.taskStatus as Record<string, string>)[status] || '#8C8C8C';
}

export function getCheckpointTypeColor(type: string): string {
  return (tokens.checkpointType as Record<string, string>)[type] || '#8C8C8C';
}

export function getRelationStyle(type: string): { stroke: string; strokeDasharray?: string } {
  const r = (tokens.relationType as Record<string, { color: string; style: string }>)[type];
  if (!r) return { stroke: '#8C8C8C' };
  const dasharray = r.style === 'dashed' ? '8 4' : r.style === 'dotted' ? '2 4' : undefined;
  return { stroke: r.color, strokeDasharray: dasharray };
}

// ── dagre 自动布局 ──

export function layoutGraph(
  nodes: LatticeNode[],
  edges: LatticeEdge[],
  direction: 'TB' | 'LR' = 'LR',
): LatticeNode[] {
  const nodeWidth = 220;
  const nodeHeight = 80;

  // 无边时用网格布局，均匀利用画布空间
  if (edges.length === 0) {
    const cols = Math.min(Math.ceil(Math.sqrt(nodes.length)), 6);
    const gapX = 50;
    const gapY = 40;
    return nodes.map((node, i) => ({
      ...node,
      position: {
        x: (i % cols) * (nodeWidth + gapX),
        y: Math.floor(i / cols) * (nodeHeight + gapY),
      },
    }));
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // 根据图的规模动态调整间距
  const big = nodes.length > 30;
  const huge = nodes.length > 80;
  g.setGraph({
    rankdir: direction,
    nodesep: huge ? 100 : big ? 80 : 60,
    ranksep: huge ? 160 : big ? 130 : 100,
    marginx: 40,
    marginy: 40,
    ranker: 'network-simplex',
    edgesep: huge ? 40 : 20,
  });

  nodes.forEach((node) => g.setNode(node.id, { width: nodeWidth, height: nodeHeight }));
  edges.forEach((edge) => g.setEdge(edge.source, edge.target));

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return { ...node, position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 } };
  });
}

// ── 格式化 ──

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return dayjs(iso).format('YYYY-MM-DD HH:mm');
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '-';
  return dayjs(iso).fromNow();
}

/** 不再截断文本，由 CSS 控制溢出 */
export function truncate(str: string, _max?: number): string {
  return str;
}

// ── TanStack Query keys ──

export const queryKeys = {
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  projectGitStatus: (id: string) => ['projects', id, 'git-status'] as const,
  tasks: (opts?: Record<string, unknown>) => ['tasks', opts] as const,
  task: (id: string) => ['tasks', id] as const,
  taskProgress: (id: string) => ['tasks', id, 'progress'] as const,
  taskContext: (id: string) => ['tasks', id, 'context'] as const,
  taskTree: (id: string) => ['tasks', id, 'tree'] as const,
  relations: ['relations'] as const,
  activeCheckpoints: ['checkpoints', 'active'] as const,
  specs: (scope?: string) => ['specs', scope] as const,
  search: (query: string) => ['search', query] as const,
  stats: ['stats'] as const,
};
