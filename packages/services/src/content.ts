/** 内容域：实体路径解析与正文读取（prd/design/progress/spec/profile/目录）。 */
import {
  fileExists,
  getProjectDir,
  getProjectProfileSummaryPath,
  getTaskDesignPath,
  getTaskDir,
  getTaskPrdPath,
  getTaskProgressPath,
  readText,
} from '@qcqx/lattice-core';
import { findSpec } from './specs';
import { resolveProjectDirName } from './projects';

export type ContentPathType =
  | 'task'
  | 'task-dir'
  | 'project'
  | 'project-dir'
  | 'prd'
  | 'design'
  | 'progress'
  | 'spec'
  | 'profile';

/**
 * 路径解析：pathType + 实体 ID → 磁盘绝对路径（只读；不存在返回 null）。
 * 路径基于 core 根（含宿主注入的 setLatticeRootOverride）。
 */
export async function resolveContentPath(
  username: string,
  type: string,
  entityId: string,
): Promise<string | null> {
  switch (type) {
    case 'task':
    case 'task-dir':
      return getTaskDir(username, entityId);
    case 'prd':
      return getTaskPrdPath(username, entityId);
    case 'design':
      return getTaskDesignPath(username, entityId);
    case 'progress':
      return getTaskProgressPath(username, entityId);
    case 'spec': {
      const found = await findSpec(username, entityId);
      return found?.spec.filePath ?? null;
    }
    case 'project':
    case 'project-dir': {
      const dirName = await resolveProjectDirName(username, entityId);
      return dirName ? getProjectDir(username, dirName) : null;
    }
    case 'profile': {
      const dirName = await resolveProjectDirName(username, entityId);
      return dirName ? getProjectProfileSummaryPath(username, dirName) : null;
    }
    default:
      return null;
  }
}

/** 读取实体正文（不存在返回 null）。 */
export async function readContent(
  username: string,
  type: string,
  entityId: string,
): Promise<string | null> {
  const filePath = await resolveContentPath(username, type, entityId);
  if (!filePath || !(await fileExists(filePath))) return null;
  try {
    return await readText(filePath);
  } catch {
    return null;
  }
}
