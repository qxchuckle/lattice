import { listAllProjects, listProjectRowsById } from '../db';
import { getDb } from '../db';
import { listUserDirs, getUserDir, dirExists } from '../paths';
import { getRelatedProjectIds } from './virtual-merge';
import { rename as fsRename } from 'node:fs/promises';
import { readLocalConfig, writeLocalConfig } from '../config';

/**
 * 查找其他用户下与指定 projectId 匹配的项目。
 *
 * 适配多 ID 策略 + 虚拟合并：
 * 1. 获取当前项目的虚拟合并组（getRelatedProjectIds）— 这些是同用户下 IDs 有交集的项目
 * 2. 对每个 project_id，用 listProjectRowsById 查所有用户下的 projects 表行
 * 3. 过滤掉当前用户的项目，去重
 *
 * 注意：多用户下同一 git 项目的 primary ID 相同（如 git:first_commit），
 * 所以 projects 表中可能有多行 id 相同但 username 不同的记录。
 * 旧代码用 getProjectById（LIMIT 1）会漏掉其他用户的行。
 */
export async function findSameProjectInOtherUsers(
  currentUsername: string,
  projectId: string,
): Promise<{ username: string; projectId: string }[]> {
  try {
    // 获取虚拟合并组的所有 project_id（同用户下 IDs 有交集的项目）
    const relatedProjectIds = getRelatedProjectIds(projectId);

    // 按用户名去重：同一用户可能有多个相关项目（git: + legacy:），
    // 但跨用户聚合时每个用户只取一个代表项目 ID
    const seenUsernames = new Set<string>();
    const result: { username: string; projectId: string }[] = [];

    // 对每个 project_id，查所有用户下的 projects 表行
    for (const pid of relatedProjectIds) {
      const rows = listProjectRowsById(pid);
      for (const row of rows) {
        if (row.username === currentUsername) continue;
        if (seenUsernames.has(row.username)) continue;
        seenUsernames.add(row.username);
        result.push({ username: row.username, projectId: row.id });
      }
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * 列出系统中所有用户名（排除隐藏目录）
 */
export async function listAllUsernames(): Promise<string[]> {
  try {
    const projects = listAllProjects();
    const usernames = new Set(projects.map((p) => p.username));
    if (usernames.size > 0) return [...usernames];
  } catch {
    // DB 未初始化，回退
  }
  try {
    return await listUserDirs();
  } catch {
    return [];
  }
}

/**
 * 重命名用户：安全地更新用户目录名和数据库中的 username 字段。
 *
 * 操作步骤：
 * 1. 校验旧用户目录存在、新用户名不冲突
 * 2. 更新 DB 中 projects / project_dirs / embeddings 表的 username
 * 3. 重命名文件系统目录
 * 4. 如果是当前用户，更新 config-local.json
 *
 * 调用方负责 initDb/closeDb。
 */
export async function renameUser(oldName: string, newName: string): Promise<void> {
  if (!oldName || !newName) throw new Error('用户名不能为空');
  if (oldName === newName) return;

  const oldDir = getUserDir(oldName);
  const newDir = getUserDir(newName);

  if (!(await dirExists(oldDir))) {
    throw new Error(`用户 ${oldName} 不存在`);
  }
  if (await dirExists(newDir)) {
    throw new Error(`用户 ${newName} 已存在`);
  }

  // 1. 更新 DB 中的 username 字段
  try {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('UPDATE projects SET username = ? WHERE username = ?').run(newName, oldName);
      db.prepare('UPDATE project_dirs SET username = ? WHERE username = ?').run(newName, oldName);
      db.prepare('UPDATE embeddings SET username = ? WHERE username = ?').run(newName, oldName);
    });
    tx();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    throw new Error(`数据库更新失败: ${(err as Error).message}`, { cause: err });
  }

  // 2. 重命名文件系统目录
  await fsRename(oldDir, newDir);

  // 3. 如果是当前用户，更新 config-local.json
  const config = await readLocalConfig();
  if (config?.username === oldName) {
    await writeLocalConfig({ ...config, username: newName });
  }
}
