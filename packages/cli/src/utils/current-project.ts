import { findUpwards, findAllUpwards, readJSON } from '@qcqx/lattice-core';

export interface CurrentProject {
  root: string;
  latticeJsonPath: string;
  id: string;
}

export interface CurrentProjectWithAncestors {
  current: CurrentProject;
  /** 祖先项目列表（近→远，直接父级在前） */
  ancestors: CurrentProject[];
}

async function readProjectAtRoot(root: string): Promise<CurrentProject | null> {
  const latticeJsonPath = `${root}/lattice.json`;
  const data = await readJSON<{ id?: string }>(latticeJsonPath);
  if (!data?.id) return null;

  return {
    root,
    latticeJsonPath,
    id: data.id,
  };
}

export async function resolveCurrentProject(
  startDir = process.cwd(),
): Promise<CurrentProject | null> {
  const root = await findUpwards('lattice.json', startDir);
  if (!root) return null;
  return readProjectAtRoot(root);
}

/**
 * 解析当前项目及其所有祖先 Lattice 项目（npm 风格向上查找）
 * 返回当前项目和按距离排序（近→远）的祖先项目列表
 */
export async function resolveCurrentProjectWithAncestors(
  startDir = process.cwd(),
): Promise<CurrentProjectWithAncestors | null> {
  const root = await findUpwards('lattice.json', startDir);
  if (!root) return null;

  const current = await readProjectAtRoot(root);
  if (!current) return null;

  // 从当前项目根目录向上查找所有祖先 lattice.json
  const ancestorRoots = await findAllUpwards('lattice.json', root);
  const ancestors: CurrentProject[] = [];

  for (const ancestorRoot of ancestorRoots) {
    const ancestor = await readProjectAtRoot(ancestorRoot);
    if (ancestor && ancestor.id !== current.id) {
      ancestors.push(ancestor);
    }
  }

  return { current, ancestors };
}

export async function resolveProjectAtDirectory(
  dir = process.cwd(),
): Promise<CurrentProject | null> {
  return readProjectAtRoot(dir);
}
