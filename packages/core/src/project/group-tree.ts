/**
 * 项目分组树 — 纯函数模块（无 IO，便于单测）
 *
 * 数据模型：注册表是「扁平列表 + parentId」（见 GroupRegistry），
 * 树派生、路径解析、祖先/子树集合、名称校验等逻辑全部集中在本模块。
 */
import type { GroupNode } from '../types';

// ─── 路径输入规范化 ───

/** 把「工作 / 前端/组件库」等输入切成规范段（split '/'、trim、去空段） */
export function normalizeGroupPathSegments(input: string): string[] {
  return input
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** 规范化单条路径为「工作/前端/组件库」；全空输入返回空串 */
export function normalizeGroupPath(input: string): string {
  return normalizeGroupPathSegments(input).join('/');
}

/** 解析逗号分隔的多条路径输入（规范化、去重、保留顺序） */
export function parseGroupPathListInput(input: string): string[] {
  const result: string[] = [];
  for (const part of input.split(',')) {
    const path = normalizeGroupPath(part);
    if (path.length > 0 && !result.includes(path)) result.push(path);
  }
  return result;
}

// ─── id ↔ 路径 ───

export function groupNodeMap(nodes: GroupNode[]): Map<string, GroupNode> {
  const map = new Map<string, GroupNode>();
  for (const node of nodes) map.set(node.id, node);
  return map;
}

/**
 * 计算所有节点的完整路径映射（id → 「工作/前端/组件库」）。
 * 破损数据（父级缺失 / 环）降级取已能解析的部分（doctor 负责报告完整性问题）。
 */
export function groupPathMap(nodes: GroupNode[]): Map<string, string> {
  const byId = groupNodeMap(nodes);
  const memo = new Map<string, string>();

  const resolvePath = (id: string, seen: Set<string>): string => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node) return '';
    if (seen.has(id)) return node.name; // 环保护：截断到当前节点
    seen.add(id);
    const parentPath = node.parentId ? resolvePath(node.parentId, seen) : '';
    const full = parentPath ? `${parentPath}/${node.name}` : node.name;
    memo.set(id, full);
    return full;
  };

  for (const node of nodes) resolvePath(node.id, new Set());
  return memo;
}

/** 单个节点的完整路径（不存在返回 null） */
export function groupPathOf(nodes: GroupNode[], id: string): string | null {
  return groupPathMap(nodes).get(id) ?? null;
}

/** 按完整路径解析节点（逐段匹配同名子节点；找不到返回 null） */
export function resolveGroupPath(nodes: GroupNode[], pathInput: string): GroupNode | null {
  const segments = normalizeGroupPathSegments(pathInput);
  if (segments.length === 0) return null;
  let parentId: string | null = null;
  let current: GroupNode | null = null;
  for (const segment of segments) {
    const node = nodes.find((n) => (n.parentId ?? null) === parentId && n.name === segment);
    if (!node) return null;
    parentId = node.id;
    current = node;
  }
  return current;
}

// ─── 树派生 ───

export interface GroupTreeNode {
  node: GroupNode;
  /** 完整路径（工作/前端） */
  path: string;
  depth: number;
  children: GroupTreeNode[];
}

/** 兄弟排序：order 升序 → created 升序 → name 比较 */
export function compareGroupSiblings(a: GroupNode, b: GroupNode): number {
  if (a.order !== b.order) return a.order - b.order;
  const createdCmp = (a.created ?? '').localeCompare(b.created ?? '');
  if (createdCmp !== 0) return createdCmp;
  return a.name.localeCompare(b.name);
}

/**
 * 派生分组树（根节点数组）。
 * 破损父级引用（父不存在）视为根节点；环内节点最后以「伪根」兜底，保证不丢节点。
 */
export function buildGroupTree(nodes: GroupNode[]): GroupTreeNode[] {
  const paths = groupPathMap(nodes);
  const byId = groupNodeMap(nodes);
  const childrenOf = new Map<string | null, GroupNode[]>();
  for (const node of nodes) {
    const parent = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(node);
    childrenOf.set(parent, list);
  }
  for (const list of childrenOf.values()) list.sort(compareGroupSiblings);

  const visited = new Set<string>();
  const build = (parentId: string | null, depth: number): GroupTreeNode[] => {
    const children = childrenOf.get(parentId) ?? [];
    const result: GroupTreeNode[] = [];
    for (const node of children) {
      if (visited.has(node.id)) continue; // 环保护
      visited.add(node.id);
      result.push({
        node,
        path: paths.get(node.id) ?? node.name,
        depth,
        children: build(node.id, depth + 1),
      });
    }
    return result;
  };

  const roots = build(null, 0);
  // 环内节点不可达（其父也在环内）→ 以伪根兜底
  if (visited.size < nodes.length) {
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      roots.push({ node, path: paths.get(node.id) ?? node.name, depth: 0, children: [] });
    }
  }
  return roots;
}

// ─── 祖先 / 子树 ───

/** 节点自身 + 全部祖先 id（含自身） */
export function ancestorOrSelfIds(nodes: GroupNode[], id: string): Set<string> {
  const byId = groupNodeMap(nodes);
  const result = new Set<string>();
  let current = byId.get(id);
  while (current && !result.has(current.id)) {
    result.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

/** 节点自身 + 全部后代 id（含自身） */
export function collectSubtreeIds(nodes: GroupNode[], id: string): Set<string> {
  const result = new Set<string>([id]);
  let frontier = new Set<string>([id]);
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const node of nodes) {
      if (node.parentId && frontier.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id);
        next.add(node.id);
      }
    }
    frontier = next;
  }
  return result;
}

// ─── 消费语义 ───

/** 过滤语义：候选路径是否命中目标路径的子树（目标自身或其后代） */
export function isSubtreePathMatch(targetPath: string, candidatePath: string): boolean {
  return candidatePath === targetPath || candidatePath.startsWith(`${targetPath}/`);
}

/** 「同组」语义：两组路径集合共享的最深祖先路径（无共享返回 null） */
export function nearestSharedAncestorPath(pathsA: string[], pathsB: string[]): string | null {
  let best: string | null = null;
  let bestDepth = 0;
  for (const a of pathsA) {
    const segmentsA = a.split('/');
    for (const b of pathsB) {
      const segmentsB = b.split('/');
      const limit = Math.min(segmentsA.length, segmentsB.length);
      let common = 0;
      while (common < limit && segmentsA[common] === segmentsB[common]) common++;
      if (common === 0) continue;
      if (common > bestDepth) {
        bestDepth = common;
        best = segmentsA.slice(0, common).join('/');
      }
    }
  }
  return best;
}

// ─── 名称校验 ───

/** 分组名称最大长度 */
export const GROUP_NAME_MAX_LENGTH = 50;

/**
 * 校验分组名称（同级唯一、大小写敏感）。
 * @param excludeId 重命名/移动时排除自身
 * @returns 错误提示；通过返回 null
 */
export function validateGroupName(
  nodes: GroupNode[],
  parentId: string | null,
  name: string,
  excludeId?: string,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '分组名称不能为空';
  if (trimmed.includes('/')) return '分组名称不能包含 “/”';
  if (/[,，]/.test(trimmed)) return '分组名称不能包含逗号（, 或 ，）';
  if (trimmed.length > GROUP_NAME_MAX_LENGTH) {
    return `分组名称不能超过 ${GROUP_NAME_MAX_LENGTH} 个字符`;
  }
  const conflict = nodes.some(
    (n) => n.id !== excludeId && (n.parentId ?? null) === parentId && n.name === trimmed,
  );
  if (conflict) return `同级下已存在分组「${trimmed}」`;
  return null;
}
