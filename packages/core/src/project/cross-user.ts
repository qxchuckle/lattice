import { listProjectRowsById, listAllProjects } from '../db';
import { getUsersDir, listDir } from '../paths';

/**
 * 查找其他用户下与指定 projectId 匹配的项目。
 * 通过数据库 (id, username) 复合主键查询，无需文件系统扫描。
 */
export async function findSameProjectInOtherUsers(
  currentUsername: string,
  projectId: string,
): Promise<{ username: string; projectId: string }[]> {
  try {
    const rows = listProjectRowsById(projectId);
    return rows
      .filter((r) => r.username !== currentUsername)
      .map((r) => ({ username: r.username, projectId: r.id }));
  } catch {
    return [];
  }
}

/**
 * 列出系统中所有用户名（排除隐藏目录）
 */
export async function listAllUsernames(): Promise<string[]> {
  // 优先从 DB 获取（更快），回退到文件系统
  try {
    const projects = listAllProjects();
    const usernames = new Set(projects.map((p) => p.username));
    if (usernames.size > 0) return [...usernames];
  } catch {
    // DB 未初始化，回退
  }

  try {
    const entries = await listDir(getUsersDir());
    return entries.filter((name) => !name.startsWith('.'));
  } catch {
    return [];
  }
}
