/** 项目关系域：列表 / 新增 / 删除。 */
import {
  deleteRelationFile,
  listRelations as coreListRelations,
  upsertRelationFile,
} from '@qcqx/lattice-core';
import type { ProjectRelation } from '@qcqx/lattice-core';
import { resolveProjectId } from './projects';

export async function listRelations(username: string): Promise<ProjectRelation[]> {
  return coreListRelations(username);
}

export async function addRelation(
  username: string,
  projectA: string,
  projectB: string,
  opts: { type?: string; description?: string; taskId?: string } = {},
): Promise<ProjectRelation> {
  const a = await resolveProjectId(username, projectA);
  const b = await resolveProjectId(username, projectB);
  if (!a) throw new Error(`未找到项目: ${projectA}`);
  if (!b) throw new Error(`未找到项目: ${projectB}`);
  return upsertRelationFile(username, {
    projectA: a,
    projectB: b,
    type: opts.type ?? 'related',
    description: opts.description,
    createdBy: 'manual',
    createdFromTaskId: opts.taskId,
  });
}

export async function removeRelation(username: string, relationId: string): Promise<void> {
  const relations = await coreListRelations(username);
  if (!relations.some((relation) => relation.id === relationId)) {
    throw new Error(`未找到项目关系: ${relationId}`);
  }
  await deleteRelationFile(username, relationId);
}
