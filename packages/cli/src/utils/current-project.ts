import { findUpwards, readJSON } from '@qcqx/lattice-core';

export interface CurrentProject {
  root: string;
  latticeJsonPath: string;
  id: string;
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

export async function resolveProjectAtDirectory(
  dir = process.cwd(),
): Promise<CurrentProject | null> {
  return readProjectAtRoot(dir);
}
