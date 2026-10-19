/**
 * 项目分组树摆放纯逻辑（视图侧）：
 * 注册表树（services 的 ProjectGroupTreeItem 结构）+ 可见项目行 → 可渲染的摆放结果。
 *
 * 摆放规则：
 * - 项目按其 `groupIds` 精确挂到对应分组节点下（多分组 = 树中多处出现，标签式语义）；
 * - 节点顺序：子分组在前、直接挂载的项目在后（项目按名称排序）；
 * - 无有效分组的项目进「未分组」；无可见项目的子树剪枝；
 * - count = 子树内去重后的可见项目数（同一项目多处挂载只计一次）。
 */
import { ProjectRow } from '../cli/types';

/** 注册表树节点（与 services ProjectGroupTreeItem 对齐的最小形状）。 */
export interface GroupTreeNodeLike {
  id: string;
  path: string;
  children: GroupTreeNodeLike[];
}

export interface PlacedGroupNode<T> {
  id: string;
  path: string;
  /** 子树内（含本节点直接挂载、去重）的可见项目数 */
  count: number;
  /** 直接挂在本分组下的可见项目 */
  projects: T[];
  children: PlacedGroupNode<T>[];
}

export interface PlacedGroupTree<T> {
  roots: PlacedGroupNode<T>[];
  /** 无有效分组的项目（按名称排序） */
  ungrouped: T[];
}

export function placeProjectsInGroupTree<T extends Pick<ProjectRow, 'id' | 'groupIds'>>(
  tree: GroupTreeNodeLike[],
  projects: T[],
): PlacedGroupTree<T> {
  const knownIds = new Set<string>();
  const collect = (nodes: GroupTreeNodeLike[]): void => {
    for (const node of nodes) {
      knownIds.add(node.id);
      collect(node.children);
    }
  };
  collect(tree);

  const byGroup = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const project of projects) {
    const ids = [...new Set(project.groupIds ?? [])].filter((id) => knownIds.has(id));
    if (ids.length === 0) {
      ungrouped.push(project);
      continue;
    }
    for (const id of ids) {
      const bucket = byGroup.get(id);
      if (bucket) bucket.push(project);
      else byGroup.set(id, [project]);
    }
  }

  const byName = (a: T & { name?: string }, b: T & { name?: string }): number =>
    (a.name || a.id).localeCompare(b.name || b.id);

  const place = (node: GroupTreeNodeLike): { placed: PlacedGroupNode<T>; ids: Set<string> } => {
    const childResults = node.children.map(place);
    const direct = (byGroup.get(node.id) ?? []).slice().sort(byName);
    const ids = new Set<string>(direct.map((project) => project.id));
    for (const child of childResults) {
      for (const id of child.ids) ids.add(id);
    }
    const placed: PlacedGroupNode<T> = {
      id: node.id,
      path: node.path,
      count: ids.size,
      projects: direct,
      children: childResults.map((child) => child.placed),
    };
    return { placed, ids };
  };

  const roots = tree.map((node) => place(node).placed).filter((node) => node.count > 0);
  return { roots, ungrouped: ungrouped.sort(byName) };
}

/** 项目在摆放树中的第一条挂载链（根 → 父级分组 id；null = 未分组 / 不在树中）。 */
export function findProjectGroupChain<T extends { id: string }>(
  roots: PlacedGroupNode<T>[],
  projectId: string,
): string[] | null {
  const walk = (nodes: PlacedGroupNode<T>[], chain: string[]): string[] | null => {
    for (const node of nodes) {
      if (node.projects.some((project) => project.id === projectId)) return [...chain, node.id];
      const found = walk(node.children, [...chain, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(roots, []);
}
