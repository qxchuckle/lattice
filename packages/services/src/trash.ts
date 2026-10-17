/** 回收站域：列表 / 恢复（含 DB 关联修复）/ 彻底删除。 */
import {
  deleteTaskLinks,
  emptyTrash as coreEmptyTrash,
  linkTaskProject,
  listTrashItems,
  purgeTrashItem,
  registerProject,
  resolveTrashById,
  restoreFromTrash,
} from '@qcqx/lattice-core';
import type { TrashMeta } from '@qcqx/lattice-core';

export async function listTrash(username: string): Promise<TrashMeta[]> {
  return listTrashItems(username);
}

/** 恢复（best-effort 修复 DB 关联；DB 不可用时跳过）。 */
export async function restoreTrash(username: string, entryId: string): Promise<TrashMeta> {
  const match = await resolveTrashById(entryId);
  if (!match) throw new Error(`未找到回收站条目: ${entryId}`);
  await restoreFromTrash(match.id);
  try {
    const hints = (match.restoreHints ?? {}) as Record<string, unknown>;
    if (match.type === 'task') {
      if (typeof hints.projectId === 'string') {
        linkTaskProject(match.entityId, hints.projectId);
      }
    } else if (match.type === 'project') {
      const localPath = typeof hints.localPath === 'string' ? hints.localPath : match.originalPath;
      await registerProject(username, match.entityId, localPath).catch(() => undefined);
    }
  } catch {
    // best-effort
  }
  return match;
}

export async function purgeTrash(entryId: string): Promise<void> {
  const match = await resolveTrashById(entryId);
  if (!match) throw new Error(`未找到回收站条目: ${entryId}`);
  await purgeTrashItem(match.id);
  if (match.type === 'task') {
    try {
      deleteTaskLinks(match.entityId);
    } catch {
      // best-effort
    }
  }
}

/** 清空回收站；返回删除条目数。 */
export async function emptyTrash(username: string): Promise<number> {
  return coreEmptyTrash(username);
}
