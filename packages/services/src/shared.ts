/**
 * 服务层共享类型与纯函数。
 */
import { getGlobalSpecDir, getUserSpecDir } from '@qcqx/lattice-core';
import type { ParsedSpec, ProjectMeta, TaskMeta, TaskTreeNode } from '@qcqx/lattice-core';

export type SpecScopeWire = 'global' | 'user' | 'project';

/** 带层级标注的 spec（wire 形状的中间体）。 */
export interface SpecWithScope {
  spec: ParsedSpec;
  scope: SpecScopeWire;
  projectId?: string;
}

/** 任务详情 bundle。 */
export interface TaskDetail {
  task: TaskMeta | null;
  progress: import('@qcqx/lattice-core').CheckpointEntry[];
  tree: TaskTreeNode | null;
  lineage: TaskMeta[];
}

/** 去掉 ID 前缀（legacy:/git:/remote:/<user>:）后的比较键。 */
export function canonicalKey(id: string): string {
  const idx = id.indexOf(':');
  return idx === -1 ? id : id.slice(idx + 1);
}

/** 构建项目 ID 匹配集合（含去前缀变体，供任务/关系归属判断）。 */
export function projectIdSet(project: ProjectMeta): Set<string> {
  const set = new Set<string>();
  const add = (id: string | undefined) => {
    if (!id) return;
    set.add(id);
    set.add(canonicalKey(id));
  };
  add(project.id);
  for (const id of project.ids ?? []) add(id);
  return set;
}

export function idMatches(idSet: Set<string>, candidate: string): boolean {
  return idSet.has(candidate) || idSet.has(canonicalKey(candidate));
}

/** 由路径推断 spec 作用域（findSpec 的 direct 命中兜底）。 */
export function inferSpecScope(filePath: string, username: string): SpecScopeWire {
  if (filePath.startsWith(getGlobalSpecDir())) return 'global';
  if (filePath.startsWith(getUserSpecDir(username))) return 'user';
  return 'project';
}
