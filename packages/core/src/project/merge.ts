/**
 * 物理合并事务 — 依赖 identity + DB + 文件操作
 *
 * lattice project merge <from> <to> 的实现
 *
 * 事务流程：准备 → 执行 → 提交 → 失败处理
 * 不回滚已完成的步骤（日志记录让用户手动修复）
 */

import type { ProjectMeta } from '../types';
import { resolveProjectIds, mergeIds, selectPrimaryId } from './identity';
import { getProjectMetaById, findUsernameAndDirName } from './lookup';
import {
  getProjectDir,
  getProjectMetaPath,
  getProjectSpecDir,
  readJSON,
  writeJSON,
  ensureDir,
  fileExists,
  listDir,
  removeDir,
  join,
  getCacheDir,
} from '../paths';
import { upsertProject, upsertFingerprint, deleteProject as dbDeleteProject } from '../db';
import { deleteFingerprintsByProject } from '../db';
import { nowISO } from '../utils/time';
import { moveToTrash } from '../trash';

// ─── 合并日志 ───

interface MergeLogEntry {
  timestamp: string;
  fromId: string;
  toId: string;
  status: 'started' | 'completed' | 'failed';
  steps?: string[];
  error?: string;
}

async function appendMergeLog(entry: MergeLogEntry): Promise<void> {
  const logPath = join(getCacheDir(), 'merge-log.json');
  let logs: MergeLogEntry[] = [];
  if (await fileExists(logPath)) {
    logs = (await readJSON<MergeLogEntry[]>(logPath)) ?? [];
    if (!Array.isArray(logs)) logs = [];
  }
  logs.push(entry);
  await writeJSON(logPath, logs);
}

// ─── 合并 ───

export interface MergeResult {
  success: boolean;
  message: string;
  steps?: string[];
}

/**
 * 物理合并两个项目
 *
 * 将 from 项目的所有数据合并到 to 项目：
 * 1. 合并 ids / localPaths / git 信息到 to 的 project.json
 * 2. 迁移 spec 文件到 to 的 spec 目录
 * 3. 更新 task.json 的 projects
 * 4. 更新 DB（fingerprints → to.id，删除 from 的 projects 行）
 * 5. 删除 from 的项目目录
 *
 * 不回滚已完成的步骤（日志记录让用户手动修复）
 */
export async function mergeProjects(fromId: string, toId: string): Promise<MergeResult> {
  const steps: string[] = [];
  const timestamp = nowISO();

  // 0. 记录合并日志开始
  await appendMergeLog({ timestamp, fromId, toId, status: 'started' });

  try {
    // 1. 准备阶段（不修改任何数据）
    const fromData = await getProjectMetaById(fromId);
    const toData = await getProjectMetaById(toId);

    if (!fromData) {
      throw new Error(`源项目 ${fromId} 不存在`);
    }
    if (!toData) {
      throw new Error(`目标项目 ${toId} 不存在`);
    }

    const { meta: fromMeta, username: fromUsername } = fromData;
    const { meta: toMeta, username: toUsername } = toData;

    // 2a. 合并 project.json
    const fromIds = fromMeta.ids;
    const toIds = toMeta.ids;
    const mergedIds = mergeIds(toIds, fromIds);
    const primaryId = selectPrimaryId(mergedIds) ?? toId;

    const mergedLocalPaths = new Set([
      ...(toMeta.localPaths ?? []),
      ...(fromMeta.localPaths ?? []),
    ]);
    const mergedGitRemotes = new Set([
      ...(toMeta.gitRemotes ?? []),
      ...(fromMeta.gitRemotes ?? []),
    ]);

    const mergedMeta: ProjectMeta = {
      ids: mergedIds,
      name: toMeta.name,
      description: toMeta.description ?? fromMeta.description,
      localPaths: [...mergedLocalPaths],
      gitRemotes: mergedGitRemotes.size > 0 ? [...mergedGitRemotes] : undefined,
      gitFirstCommit: toMeta.gitFirstCommit ?? fromMeta.gitFirstCommit,
      gitDefaultBranch: toMeta.gitDefaultBranch ?? fromMeta.gitDefaultBranch,
      packageNames: toMeta.packageNames ?? fromMeta.packageNames,
      monorepoPackages: toMeta.monorepoPackages ?? fromMeta.monorepoPackages,
      groups: toMeta.groups ?? fromMeta.groups,
      tags: toMeta.tags ?? fromMeta.tags,
      created: toMeta.created,
      updated: nowISO(),
    };

    const toFound = await findUsernameAndDirName(toId);
    if (!toFound) throw new Error(`找不到目标项目目录: ${toId}`);

    await writeJSON(getProjectMetaPath(toFound.username, toFound.dirName), mergedMeta);
    steps.push('2a. 写入合并后的 project.json');

    // 同步到 DB
    upsertProject({
      id: primaryId,
      name: mergedMeta.name,
      local_path: JSON.stringify(mergedMeta.localPaths),
      description: mergedMeta.description ?? null,
      git_remote: mergedMeta.gitRemotes ? JSON.stringify(mergedMeta.gitRemotes) : null,
      git_first_commit: mergedMeta.gitFirstCommit ?? null,
      git_default_branch: mergedMeta.gitDefaultBranch ?? null,
      package_names: mergedMeta.packageNames ? JSON.stringify(mergedMeta.packageNames) : null,
      monorepo_packages: mergedMeta.monorepoPackages
        ? JSON.stringify(mergedMeta.monorepoPackages)
        : null,
      groups: mergedMeta.groups ? JSON.stringify(mergedMeta.groups) : null,
      tags: mergedMeta.tags ? JSON.stringify(mergedMeta.tags) : null,
      username: toFound.username,
      created: mergedMeta.created,
      updated: mergedMeta.updated ?? null,
    });
    for (const id of mergedIds) {
      upsertFingerprint({ project_id: primaryId, key: 'project_id', value: id, weight: 0 });
    }
    steps.push('2b. 同步合并后数据到 DB');

    // 2c. 迁移 spec 文件
    const fromFound = await findUsernameAndDirName(fromId);
    if (fromFound) {
      const fromSpecDir = getProjectSpecDir(fromFound.username, fromFound.dirName);
      const toSpecDir = getProjectSpecDir(toFound.username, toFound.dirName);
      await ensureDir(toSpecDir);

      if (await fileExists(fromSpecDir)) {
        const specFiles = await listDir(fromSpecDir);
        for (const file of specFiles) {
          if (file.startsWith('.')) continue;
          const fromPath = join(fromSpecDir, file);
          const toPath = join(toSpecDir, file);
          if (!(await fileExists(toPath))) {
            // 复制文件（简单实现：读取后写入）
            const content = await readJSON(fromPath);
            if (content) await writeJSON(toPath, content);
          }
        }
        steps.push('2c. 迁移 spec 文件');
      }
    }

    // 2d. 更新 task.json 的 projects（扫描所有用户的 task.json）
    const { getUsersDir, getTaskMetaPath } = await import('../paths');
    let usernames: string[];
    try {
      usernames = await listDir(getUsersDir());
    } catch {
      usernames = [toFound.username];
    }

    for (const username of usernames) {
      if (username.startsWith('.')) continue;
      let taskDirs: string[];
      try {
        const { getUserTasksDir } = await import('../paths');
        taskDirs = await listDir(getUserTasksDir(username));
      } catch {
        continue;
      }
      for (const taskDir of taskDirs) {
        if (taskDir.startsWith('.')) continue;
        const taskMetaPath = getTaskMetaPath(username, taskDir);
        if (!(await fileExists(taskMetaPath))) continue;
        const taskMeta = await readJSON<{ projects?: string[] }>(taskMetaPath);
        if (!taskMeta?.projects) continue;

        let changed = false;
        const updatedProjects = taskMeta.projects.map((p) => {
          if (p === fromId || fromIds.includes(p)) {
            changed = true;
            return primaryId;
          }
          return p;
        });

        if (changed) {
          await writeJSON(taskMetaPath, { ...taskMeta, projects: updatedProjects });
        }
      }
    }
    steps.push('2d. 更新 task.json 的 projects');

    // 2e. 更新 DB：删除 from 的 fingerprints 和 projects 行
    if (fromFound) {
      deleteFingerprintsByProject(fromId);
      dbDeleteProject(fromId, fromFound.username);
    }
    steps.push('2e. 清理 from 项目的 DB 数据');

    // 3. 提交阶段：删除 from 的项目目录
    if (fromFound) {
      const fromProjectDir = getProjectDir(fromFound.username, fromFound.dirName);
      await moveToTrash(fromProjectDir, {
        type: 'project',
        originalPath: fromProjectDir,
        title: fromMeta.name ?? fromId,
        username: fromFound.username,
        entityId: fromId,
        restoreHints: { localPaths: fromMeta.localPaths ?? [] },
      });
    }
    steps.push('3. 删除 from 项目目录（移入垃圾桶）');

    // 记录合并日志完成
    await appendMergeLog({ timestamp, fromId, toId, status: 'completed', steps });

    return {
      success: true,
      message: `项目 ${fromId} 已合并到 ${toId}`,
      steps,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // 记录合并日志失败
    await appendMergeLog({ timestamp, fromId, toId, status: 'failed', steps, error: errorMsg });

    return {
      success: false,
      message: `合并失败: ${errorMsg}`,
      steps,
    };
  }
}
