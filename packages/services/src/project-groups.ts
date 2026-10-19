/**
 * 项目分组域服务：注册表用例 + 项目引用编排（web / vscode 等多宿主共享）。
 *
 * 分层：core（注册表纯操作 + 项目引用编排）→ 本层（面向宿主的用例视图：
 * 树 + 计数、影响面预览、操作后的 DB 缓存刷新）→ 宿主绑定。
 */
import {
  ancestorOrSelfIds,
  buildGroupTree,
  collectSubtreeIds,
  createGroupNode,
  findGroupByRef,
  groupPathOf,
  listProjectMetas,
  listProjectsReferencingGroupSubtree,
  moveGroupNode,
  readGroupRegistry,
  refreshProjectGroupPaths,
  removeProjectGroupTree,
  renameGroupNode,
  resolveGroupPathsForIds,
  updateProjectGroups,
  type GroupNode,
  type GroupTreeNode,
  type ProjectGroupUpdateOptions,
} from '@qcqx/lattice-core';

// ─── 树查询 ───

export interface ProjectGroupTreeItem {
  node: GroupNode;
  path: string;
  depth: number;
  /** 子树内（含自身）引用的项目数（同一项目在节点上最多计一次） */
  projectCount: number;
  children: ProjectGroupTreeItem[];
}

export interface ProjectGroupTree {
  roots: ProjectGroupTreeItem[];
  /** 注册表节点总数 */
  total: number;
  /** 未引用任何有效分组的项目数 */
  ungroupedProjects: number;
}

/** 分组树 + 每节点项目计数 + 未分组项目数。 */
export async function getProjectGroupTree(username: string): Promise<ProjectGroupTree> {
  const registry = await readGroupRegistry(username);
  const metas = await listProjectMetas(username);
  const known = new Set(registry.groups.map((n) => n.id));
  const counts = new Map<string, number>();
  let ungroupedProjects = 0;

  for (const meta of metas) {
    const ids = (meta.groupIds ?? []).filter((id) => known.has(id));
    if (ids.length === 0) {
      ungroupedProjects++;
      continue;
    }
    const touched = new Set<string>();
    for (const id of ids) {
      for (const ancestorId of ancestorOrSelfIds(registry.groups, id)) touched.add(ancestorId);
    }
    for (const nodeId of touched) counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
  }

  const attach = (item: GroupTreeNode): ProjectGroupTreeItem => ({
    node: item.node,
    path: item.path,
    depth: item.depth,
    projectCount: counts.get(item.node.id) ?? 0,
    children: item.children.map(attach),
  });

  return {
    roots: buildGroupTree(registry.groups).map(attach),
    total: registry.groups.length,
    ungroupedProjects,
  };
}

/** 全部分组路径（先序扁平化，供过滤器 / 提示词 / 复制路径选择）。 */
export async function listProjectGroupPaths(username: string): Promise<string[]> {
  const registry = await readGroupRegistry(username);
  const out: string[] = [];
  const walk = (items: GroupTreeNode[]) => {
    for (const item of items) {
      out.push(item.path);
      walk(item.children);
    }
  };
  walk(buildGroupTree(registry.groups));
  return out;
}

// ─── 项目引用编排 ───

export interface ProjectGroupsSetResult {
  /** 本次自动创建的分组路径（调用方负责提示） */
  createdPaths: string[];
  /** 未能解析的移除引用（原样回显） */
  unknownRemovals: string[];
  error?: string;
}

/** 更新项目的分组引用（set/add 路径缺失自动创建；remove 接受路径或 grp- id）。 */
export async function setProjectGroups(
  username: string,
  projectId: string,
  options: ProjectGroupUpdateOptions,
): Promise<ProjectGroupsSetResult> {
  const result = await updateProjectGroups(username, projectId, options);
  if (result.error) {
    return { createdPaths: [], unknownRemovals: result.unknownRemovals, error: result.error };
  }
  const registry = await readGroupRegistry(username);
  return {
    createdPaths: resolveGroupPathsForIds(
      registry,
      result.created.map((node) => node.id),
    ),
    unknownRemovals: result.unknownRemovals,
  };
}

// ─── 注册表 CRUD（含影响面与 DB 缓存刷新） ───

export interface ProjectGroupMutationResult {
  node?: GroupNode;
  /** 操作后的完整路径 */
  path?: string;
  /** 受影响（路径展示变化）的项目主 ID 列表 */
  affectedProjectIds?: string[];
  error?: string;
}

/** 创建分组（parentRef 为路径或 grp- id；null = 根级）。 */
export async function createProjectGroup(
  username: string,
  parentRef: string | null,
  name: string,
): Promise<ProjectGroupMutationResult> {
  const registry = await readGroupRegistry(username);
  let parentId: string | null = null;
  if (parentRef) {
    const parent = findGroupByRef(registry, parentRef);
    if (!parent) return { error: `未找到父分组：${parentRef}` };
    parentId = parent.id;
  }
  const result = await createGroupNode(username, parentId, name);
  if ('error' in result) return { error: result.error };
  const after = await readGroupRegistry(username);
  return { node: result, path: groupPathOf(after.groups, result.id) ?? result.name };
}

/** 重命名分组（单节点写；随后刷新受影响项目的 DB 展示路径）。 */
export async function renameProjectGroup(
  username: string,
  ref: string,
  newName: string,
): Promise<ProjectGroupMutationResult> {
  const registry = await readGroupRegistry(username);
  const node = findGroupByRef(registry, ref);
  if (!node) return { error: `未找到分组：${ref}` };
  const result = await renameGroupNode(username, node.id, newName);
  if ('error' in result) return { error: result.error };
  const affectedProjectIds = await listProjectsReferencingGroupSubtree(username, node.id);
  await refreshProjectGroupPaths(username, affectedProjectIds);
  const after = await readGroupRegistry(username);
  return {
    node: result,
    path: groupPathOf(after.groups, result.id) ?? result.name,
    affectedProjectIds,
  };
}

/** 移动分组（newParentRef 为路径或 grp- id；null = 移到根级）。 */
export async function moveProjectGroup(
  username: string,
  ref: string,
  newParentRef: string | null,
): Promise<ProjectGroupMutationResult> {
  const registry = await readGroupRegistry(username);
  const node = findGroupByRef(registry, ref);
  if (!node) return { error: `未找到分组：${ref}` };
  let parentId: string | null = null;
  if (newParentRef) {
    const parent = findGroupByRef(registry, newParentRef);
    if (!parent) return { error: `未找到目标父分组：${newParentRef}` };
    parentId = parent.id;
  }
  const result = await moveGroupNode(username, node.id, parentId);
  if ('error' in result) return { error: result.error };
  const affectedProjectIds = await listProjectsReferencingGroupSubtree(username, node.id);
  await refreshProjectGroupPaths(username, affectedProjectIds);
  const after = await readGroupRegistry(username);
  return {
    node: result,
    path: groupPathOf(after.groups, result.id) ?? result.name,
    affectedProjectIds,
  };
}

export interface ProjectGroupImpactPreview {
  path: string;
  /** 将被一并删除的子分组数（不含自身；重命名/移动时表示子树节点数） */
  subgroupCount: number;
  affectedProjectIds: string[];
  error?: string;
}

/** 影响面预览（确认框展示「N 个项目、M 个子组」；删除/重命名/移动共用）。 */
export async function previewProjectGroupImpact(
  username: string,
  ref: string,
): Promise<ProjectGroupImpactPreview> {
  const registry = await readGroupRegistry(username);
  const node = findGroupByRef(registry, ref);
  if (!node) {
    return { path: ref, subgroupCount: 0, affectedProjectIds: [], error: `未找到分组：${ref}` };
  }
  const subtree = collectSubtreeIds(registry.groups, node.id);
  const affectedProjectIds = await listProjectsReferencingGroupSubtree(username, node.id);
  return {
    path: groupPathOf(registry.groups, node.id) ?? node.name,
    subgroupCount: subtree.size - 1,
    affectedProjectIds,
  };
}

/** 删除分组子树 + 从引用项目剥离（调用方先用 preview 确认）。 */
export async function removeProjectGroup(
  username: string,
  ref: string,
): Promise<ProjectGroupMutationResult & { removedCount?: number }> {
  const result = await removeProjectGroupTree(username, ref);
  if (result.error) return { error: result.error };
  return { removedCount: result.removed.length, affectedProjectIds: result.affectedProjectIds };
}
