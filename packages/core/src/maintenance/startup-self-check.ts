import { isAbsolute, join } from 'node:path';
import type { ProjectRow, TaskProjectRow } from '../types';
import { getUsername, isInitialized } from '../config';
import {
  closeDb,
  deleteProject,
  getProjectById,
  initDb,
  listAllProjects,
  listIndexedDocumentPaths,
  listTaskProjectLinks,
  unlinkTaskProject,
} from '../db';
import {
  fileExists,
  getProjectMetaPath,
  getTaskMetaPath,
  getTaskPrdPath,
  getUsersDir,
  listDir,
  makeProjectDirName,
  readJSON,
} from '../paths';
import { removeSearchDocumentIndex } from '../rag';

export interface StartupSelfCheckResult {
  removedProjects: number;
  removedTaskLinks: number;
  removedSearchDocs: number;
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
        deleteProject(project.id);
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

    return result;
  } finally {
    closeDb();
  }
}

async function isOrphanProject(project: ProjectRow): Promise<boolean> {
  const metaPath = getProjectMetaPath(project.username, makeProjectDirName(project.id));
  if (!(await fileExists(metaPath))) {
    return true;
  }

  if (!(await fileExists(project.local_path))) {
    return false;
  }

  const latticeJson = await readJSON<{ id?: string }>(join(project.local_path, 'lattice.json'));
  if (!latticeJson?.id) {
    return true;
  }

  return latticeJson.id !== project.id;
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

async function isOrphanIndexedDocument(
  filePath: string,
  usernames: Set<string>,
): Promise<boolean> {
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
    return !(await fileExists(getProjectMetaPath(username, makeProjectDirName(projectId))));
  }

  return false;
}
