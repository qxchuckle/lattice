import { randomBytes } from 'node:crypto';
import type { ProjectRelation, RelationsFile } from '../types';
import { getRelationsFilePath, readJSON, writeJSON } from '../paths';

/** 生成关系 id（rel_ + 8 位 hex） */
export function generateRelationId(): string {
  return `rel_${randomBytes(4).toString('hex')}`;
}

/** 把 (a,b) 排序，返回字典序较小者在前的元组 */
export function normalizePairOrder(a: string, b: string): { projectA: string; projectB: string } {
  return a <= b ? { projectA: a, projectB: b } : { projectA: b, projectB: a };
}

/** 读取 relations.json（不存在返回空文件） */
export async function readRelationsFile(username: string): Promise<RelationsFile> {
  const file = await readJSON<RelationsFile>(getRelationsFilePath(username));
  if (!file) return { version: 1, relations: [] };
  if (!Array.isArray(file.relations)) return { version: 1, relations: [] };
  return file;
}

/** 写入 relations.json */
export async function writeRelationsFile(username: string, file: RelationsFile): Promise<void> {
  await writeJSON(getRelationsFilePath(username), file);
}

/** 列出所有关系（从 relations.json 真源） */
export async function listRelations(username: string): Promise<ProjectRelation[]> {
  const file = await readRelationsFile(username);
  return file.relations;
}

/** 按 id 查找关系 */
export async function getRelationById(
  username: string,
  id: string,
): Promise<ProjectRelation | null> {
  const file = await readRelationsFile(username);
  return file.relations.find((r) => r.id === id) ?? null;
}

/** 列出涉及某个项目的所有关系 */
export async function getRelationsByProject(
  username: string,
  projectId: string,
): Promise<ProjectRelation[]> {
  const file = await readRelationsFile(username);
  return file.relations.filter((r) => r.projectA === projectId || r.projectB === projectId);
}

/** 创建或更新关系。重复 (a,b,type) 视为同一条，更新 description。 */
export async function upsertRelation(
  username: string,
  input: {
    projectA: string;
    projectB: string;
    type: string;
    description?: string;
    createdBy?: ProjectRelation['createdBy'];
    createdFromTaskId?: string;
  },
): Promise<ProjectRelation> {
  if (input.projectA === input.projectB) {
    throw new Error('不能创建项目与自身的关系');
  }
  const { projectA, projectB } = normalizePairOrder(input.projectA, input.projectB);
  const file = await readRelationsFile(username);

  const existing = file.relations.find(
    (r) => r.projectA === projectA && r.projectB === projectB && r.type === input.type,
  );
  const now = new Date().toISOString();

  let saved: ProjectRelation;
  if (existing) {
    existing.description = input.description ?? existing.description;
    existing.createdBy = input.createdBy ?? existing.createdBy;
    existing.createdFromTaskId = input.createdFromTaskId ?? existing.createdFromTaskId;
    existing.updated = now;
    saved = existing;
  } else {
    saved = {
      id: generateRelationId(),
      projectA,
      projectB,
      type: input.type,
      description: input.description,
      createdBy: input.createdBy ?? 'manual',
      createdFromTaskId: input.createdFromTaskId,
      created: now,
    };
    file.relations.push(saved);
  }

  await writeRelationsFile(username, file);
  return saved;
}

/** 按 id 删除关系 */
export async function deleteRelation(username: string, id: string): Promise<boolean> {
  const file = await readRelationsFile(username);
  const idx = file.relations.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  file.relations.splice(idx, 1);
  await writeRelationsFile(username, file);
  return true;
}

/** 删除涉及指定项目的所有关系（unregister 时联动清理） */
export async function deleteRelationsByProject(
  username: string,
  projectId: string,
): Promise<number> {
  const file = await readRelationsFile(username);
  const before = file.relations.length;
  file.relations = file.relations.filter(
    (r) => r.projectA !== projectId && r.projectB !== projectId,
  );
  await writeRelationsFile(username, file);
  return before - file.relations.length;
}
