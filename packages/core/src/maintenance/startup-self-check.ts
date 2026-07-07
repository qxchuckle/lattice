import { isAbsolute, join } from 'node:path';
import type { ProjectRow, TaskProjectRow } from '../types';
import { getUsername, isInitialized, readResolvedConfig } from '../config';
import {
  closeDb,
  deleteProject,
  getProjectById,
  getLatticeMeta,
  initDb,
  listAllProjects,
  listIndexedDocumentPaths,
  listTaskProjectLinks,
  unlinkTaskProject,
} from '../db';
import {
  fileExists,
  getTaskMetaPath,
  getTaskPrdPath,
  getUsersDir,
  listDir,
  readJSON,
} from '../paths';
import { findProjectDirName } from '../project';
import { removeSearchDocumentIndex } from '../rag';
import { readScanCache, writeScanCache, shouldScan } from '../cache/scan-cache';
import { scanForProjects } from '../project/scan';

export interface StartupSelfCheckResult {
  removedProjects: number;
  removedTaskLinks: number;
  removedSearchDocs: number;
  scanResult?: { added: number; updated: number };
  ragRebuildNeeded?: boolean;
}

export async function runStartupSelfCheck(): Promise<StartupSelfCheckResult> {
  const result: StartupSelfCheckResult = {
    removedProjects: 0,
    removedTaskLinks: 0,
    removedSearchDocs: 0,
  };

  if (!(await isInitialized())) {
    return result;
  }

  await initDb();

  try {
    const currentUsername = await getUsername();
    const knownUsers = new Set([currentUsername, ...(await listDir(getUsersDir()))]);

    const projects = listAllProjects();
    const removedProjectIds = new Set<string>();

    for (const project of projects) {
      if (await isOrphanProject(project)) {
        deleteProject(project.id, project.username);
        removedProjectIds.add(project.id);
        result.removedProjects++;
      }
    }

    const taskLinks = listTaskProjectLinks();
    for (const link of taskLinks) {
      if (removedProjectIds.has(link.project_id)) continue;
      if (await isOrphanTaskLink(link, knownUsers)) {
        unlinkTaskProject(link.task_id, link.project_id);
        result.removedTaskLinks++;
      }
    }

    const indexedPaths = listIndexedDocumentPaths();
    for (const filePath of indexedPaths) {
      if (await isOrphanIndexedDocument(filePath, knownUsers)) {
        removeSearchDocumentIndex(filePath);
        result.removedSearchDocs++;
      }
    }

    // 定时扫描检查
    await maybeRunScheduledScan(currentUsername, result);

    // 检查是否需要 rag rebuild（DB schema 重建后标记）
    if (getLatticeMeta('rag_rebuild_needed') === 'true') {
      result.ragRebuildNeeded = true;
    }

    return result;
  } finally {
    closeDb();
  }
}

/**
 * 定时扫描：超过 12h 则自动扫描
 * 只在扫描成功后更新时间
 */
async function maybeRunScheduledScan(
  username: string,
  result: StartupSelfCheckResult,
): Promise<void> {
  const needScan = await shouldScan();
  if (!needScan) return;

  const config = await readResolvedConfig();
  const scanDirs = config.scanDirs;
  if (!scanDirs?.length) return;

  try {
    const scanResult = await scanForProjects(username, scanDirs);

    // 只在扫描成功后更新时间
    await writeScanCache({
      lastSuccessAt: new Date().toISOString(),
      lastScanDirs: scanDirs,
      lastResult: { added: scanResult.added.length, updated: scanResult.updated.length },
    });

    result.scanResult = {
      added: scanResult.added.length,
      updated: scanResult.updated.length,
    };
  } catch {
    // 扫描失败不更新时间，下次启动时重试
  }
}

/**
 * 启动自检对项目是否孤儿的判定。
 *
 * 设计原则：**磁盘 project.json 是真源**。
 * - 必要条件（允许 db DELETE）：projects/<dir>/project.json 不存在（包含 legacy 短前缀目录扫描）。
 * - 其余不一致（本地路径丢失 / lattice.json 被他人接管）不视为启动阶段孤儿，
 *   交由 `doctor` / `project list --orphaned` / `unlink --remove-data` 走 trash 可恢复流程。
 * - 这避免了与 `doctor --migrate` 的「回填 ↔ 静默删除」拉锯。
 */
async function isOrphanProject(project: ProjectRow): Promise<boolean> {
  const dirName = await findProjectDirName(project.username, project.id);
  return dirName === null;
}

async function isOrphanTaskLink(link: TaskProjectRow, usernames: Set<string>): Promise<boolean> {
  if (!getProjectById(link.project_id)) {
    return true;
  }

  for (const username of usernames) {
    if (await fileExists(getTaskMetaPath(username, link.task_id))) {
      return false;
    }
  }

  return true;
}

async function isOrphanIndexedDocument(filePath: string, usernames: Set<string>): Promise<boolean> {
  if (isAbsolute(filePath)) {
    return !(await fileExists(filePath));
  }

  const normalized = filePath.replace(/[\\/]+/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 5 && parts[0] === 'user' && parts[2] === 'task' && parts[4] === 'prd.md') {
    const [, username, , taskId] = parts;
    if (!usernames.has(username)) return true;
    return !(await fileExists(getTaskPrdPath(username, taskId)));
  }

  if (
    parts.length === 5 &&
    parts[0] === 'user' &&
    parts[2] === 'project' &&
    parts[4] === 'project.md'
  ) {
    const [, username, , projectId] = parts;
    if (!usernames.has(username)) return true;
    // 兼容 legacy 短前缀目录：findProjectDirName 会回退扫描
    return (await findProjectDirName(username, projectId)) === null;
  }

  return false;
}
