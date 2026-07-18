import dagre from '@dagrejs/dagre';
import dayjs from 'dayjs';
import { tokens } from './theme';
import type { LatticeNode, LatticeEdge } from './types/graph';
import type { ProjectMeta } from '@qcqx/lattice-core';
import { selectPrimaryId } from '@qcqx/lattice-core';
import { authStore, clearToken } from './store';

// ── 通用请求函数（自动携带 auth token）──

/** 获取鉴权请求头 */
export function getAuthHeaders(): Record<string, string> {
  return authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {};
}

/** GET 请求（自动携带 token，401 自动清除） */
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (res.status === 401) {
    clearToken();
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

/** POST 请求（自动携带 token + Content-Type，401 自动清除） */
export async function apiPost<T = { success?: boolean; [key: string]: unknown }>(
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json', ...getAuthHeaders() } : getAuthHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    clearToken();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── 实体配色 ──

export function getEntityColor(entityType: string): string {
  return (tokens.entity as Record<string, string>)[entityType] || '#8C8C8C';
}

export function getTaskStatusColor(status: string): string {
  return (tokens.taskStatus as Record<string, string>)[status] || '#8C8C8C';
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
  return dayjs(iso).format('YYYY-MM-DD HH:mm:ss');
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
  specs: (scope?: string) => ['specs', scope] as const,
  search: (query: string, type?: string, filters?: unknown) =>
    ['search', query, type ?? 'all', filters] as const,
  stats: ['stats'] as const,
};

// ── 多 ID 机制工具 ──

/**
 * 构建 anyId → primaryId 映射表
 *
 * 遍历所有项目的 ids 数组，每个 ID 都映射到该项目的 primary ID。
 * 同时注册无前缀版本（如 `legacy:abc` → 也注册 `abc`），
 * 兼容 task.projects / relation 中存储的无前缀旧 ID。
 */
export function buildIdMap(projects: ProjectMeta[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of projects) {
    const primaryId = selectPrimaryId(p.ids) ?? p.id ?? p.ids[0];
    if (!primaryId) continue;
    for (const id of p.ids) {
      map.set(id, primaryId);
      // 兼容无前缀旧 ID：legacy:abc → 也注册 abc
      const idx = id.indexOf(':');
      if (idx > 0) {
        const content = id.slice(idx + 1);
        if (!map.has(content)) map.set(content, primaryId);
      }
    }
    // 兼容：id 字段也加入映射
    if (p.id && !map.has(p.id)) {
      map.set(p.id, primaryId);
    }
  }
  return map;
}

/**
 * 将任意项目 ID 解析为 primary ID
 *
 * 如果映射表中找不到，返回原 ID（可能是未注册项目或旧数据）。
 */
export function resolvePrimaryId(idMap: Map<string, string>, id: string): string {
  return idMap.get(id) ?? id;
}

/**
 * 获取项目的 primary ID（始终返回 string，兜底 ids[0] 或空串）
 *
 * 用于替代 `p.id`（现在可能是 undefined）。
 */
export function getProjectId(p: ProjectMeta): string {
  return selectPrimaryId(p.ids) ?? p.id ?? p.ids[0] ?? '';
}

/**
 * 检测两个项目的 ids 是否有交集（虚拟合并条件）
 *
 * 虚拟合并保护机制：有 legacy: ID 的项目只匹配 legacy: 交集，
 * 无 legacy: ID 的项目匹配所有 IDs 交集。
 */
export function hasIdIntersection(idsA: string[], idsB: string[]): boolean {
  const setB = new Set(idsB);
  return idsA.some((id) => setB.has(id));
}

/**
 * 虚拟合并去重：IDs 有交集的项目合并为一个
 *
 * 使用并查集（Union-Find）检测 IDs 交集，每组选 primary ID 优先级最高的作为代表，
 * 合并 localPaths / gitRemotes 等数组字段。
 */
export function deduplicateProjects(projects: ProjectMeta[]): ProjectMeta[] {
  // 并查集
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // 路径压缩
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // 用每个项目的主 ID 作为并查集节点，IDs 交集做 union
  const projectByPrimaryId = new Map<string, ProjectMeta>();
  for (const p of projects) {
    const primaryId = selectPrimaryId(p.ids) ?? p.id ?? p.ids[0];
    if (!primaryId) continue;
    projectByPrimaryId.set(primaryId, p);
    // 同一项目的所有 IDs 互相 union
    for (const id of p.ids) {
      union(primaryId, id);
    }
  }

  // 按 root 分组
  const groups = new Map<string, ProjectMeta[]>();
  for (const p of projects) {
    const primaryId = selectPrimaryId(p.ids) ?? p.id ?? p.ids[0];
    if (!primaryId) continue;
    const root = find(primaryId);
    const list = groups.get(root) || [];
    list.push(p);
    groups.set(root, list);
  }

  // 每组合并为一个 ProjectMeta
  const results: ProjectMeta[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      results.push(group[0]);
      continue;
    }
    // 选 primary ID 优先级最高的作为代表
    const sorted = [...group].sort((a, b) => {
      const pa = selectPrimaryId(a.ids) ?? '';
      const pb = selectPrimaryId(b.ids) ?? '';
      // selectPrimaryId 已按优先级排序，直接比较字符串不可靠
      // 用 ids 数组中第一个（已排序）比较
      return (a.ids[0] ?? '').localeCompare(b.ids[0] ?? '');
    });
    const rep = sorted[0];
    // 合并 ids / localPaths / gitRemotes
    const idsSet = new Set<string>();
    const localPathsSet = new Set<string>();
    const gitRemotesSet = new Set<string>();
    for (const p of group) {
      p.ids.forEach((id) => idsSet.add(id));
      (p.localPaths || []).forEach((lp) => localPathsSet.add(lp));
      (p.gitRemotes || []).forEach((gr) => gitRemotesSet.add(gr));
    }
    results.push({
      ...rep,
      ids: [...idsSet],
      localPaths: [...localPathsSet],
      gitRemotes: [...gitRemotesSet],
    });
  }
  return results;
}
