import { createHash, randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { basename as pathBasename, resolve as pathResolve } from 'node:path';
import machineIdPkg from 'node-machine-id';
import type { ProjectMeta, ProjectRow } from '../types';
import {
  getUserProjectsDir,
  getProjectDir,
  getProjectMetaPath,
  getProjectSpecDir,
  makeProjectDirName,
  readJSON,
  writeJSON,
  ensureDir,
  fileExists,
  listDir,
  removeDir,
  join,
} from '../paths';
import {
  upsertProject,
  deleteProject as dbDeleteProject,
  getProjectById as dbGetProjectById,
  getProjectByPath as dbGetProjectByPath,
  listAllProjects as dbListAllProjects,
} from '../db';

// ─── ID 生成 ───

const PROJECT_ID_PATTERN = /^[0-9a-f]{16}$/;
const { machineIdSync } = machineIdPkg;

function hashSegment(input: string, length: number): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

function getMachineCode(): string {
  return hashSegment(machineIdSync(), 4);
}

function getDirectoryCode(projectPath: string): string {
  return hashSegment(pathResolve(projectPath), 4);
}

export function generateProjectId(projectPath: string): string {
  return `${getMachineCode()}${getDirectoryCode(projectPath)}${randomBytes(4).toString('hex')}`;
}

// ─── 项目信息自动检测 ───

export interface DetectedProjectInfo {
  name: string;
  description?: string;
  gitRemote?: string;
}

export async function detectProjectInfo(projectPath: string): Promise<DetectedProjectInfo> {
  const name = pathBasename(projectPath);
  let description: string | undefined;
  let gitRemote: string | undefined;

  const pkgPath = join(projectPath, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJSON<{ name?: string; description?: string }>(pkgPath);
    if (pkg?.description) description = pkg.description;
  }

  const cargoPath = join(projectPath, 'Cargo.toml');
  if (!description && (await fileExists(cargoPath))) {
    // Cargo.toml 简单读取不解析 TOML，只做最基本的检测
  }

  try {
    gitRemote = execSync('git remote get-url origin', {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    }).trim();
  } catch {
    // 没有 git remote 也不报错
  }

  return { name, description, gitRemote };
}

// ─── 项目注册 ───

export async function registerProject(
  username: string,
  id: string,
  localPath: string,
  opts?: Partial<Pick<ProjectMeta, 'name' | 'description' | 'groups' | 'tags' | 'gitRemote'>>,
): Promise<ProjectMeta> {
  const detected = await detectProjectInfo(localPath);
  const now = new Date().toISOString();
  const dirName = makeProjectDirName(id);
  const existingMeta = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
  const name = opts?.name ?? detected.name ?? existingMeta?.name;

  const meta: ProjectMeta = {
    id,
    name,
    description: opts?.description ?? detected.description ?? existingMeta?.description,
    localPath,
    gitRemote: opts?.gitRemote ?? detected.gitRemote ?? existingMeta?.gitRemote,
    groups: opts?.groups ?? existingMeta?.groups,
    tags: opts?.tags ?? existingMeta?.tags,
    created: existingMeta?.created ?? now,
    updated: existingMeta ? now : undefined,
  };

  const projectDir = getProjectDir(username, dirName);
  await ensureDir(projectDir);
  await ensureDir(getProjectSpecDir(username, dirName));
  await writeJSON(getProjectMetaPath(username, dirName), meta);

  syncProjectToDb(username, meta);

  return meta;
}

// ─── 取消注册 ───

export async function unregisterProject(username: string, id: string): Promise<void> {
  dbDeleteProject(id);
  const dirName = await findProjectDirName(username, id);
  if (dirName) {
    await removeDir(getProjectDir(username, dirName));
  }
}

// ─── 查询 ───

export async function getProjectMeta(username: string, id: string): Promise<ProjectMeta | null> {
  const dirName = await findProjectDirName(username, id);
  if (!dirName) return null;
  return readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
}

export async function updateProjectMeta(
  username: string,
  id: string,
  updates: Partial<ProjectMeta>,
): Promise<ProjectMeta | null> {
  const dirName = await findProjectDirName(username, id);
  if (!dirName) return null;

  const metaPath = getProjectMetaPath(username, dirName);
  const existing = await readJSON<ProjectMeta>(metaPath);
  if (!existing) return null;

  const updated: ProjectMeta = {
    ...existing,
    ...updates,
    id: existing.id,
    created: existing.created,
    updated: new Date().toISOString(),
  };

  await writeJSON(metaPath, updated);
  syncProjectToDb(username, updated);
  return updated;
}

export function listProjects(username: string): ProjectRow[] {
  return dbListAllProjects(username);
}

export function findProjectByPath(localPath: string): ProjectRow | undefined {
  return dbGetProjectByPath(localPath);
}

export function findProjectById(id: string): ProjectRow | undefined {
  return dbGetProjectById(id);
}

// ─── 扫描发现 ───

export async function scanForProjects(
  username: string,
  dirs: string[],
): Promise<{ added: string[]; updated: string[]; total: number }> {
  const added: string[] = [];
  const updated: string[] = [];

  for (const dir of dirs) {
    await scanDir(username, dir, added, updated);
  }

  return { added, updated, total: added.length + updated.length };
}

async function scanDir(
  username: string,
  dir: string,
  added: string[],
  updated: string[],
): Promise<void> {
  const latticeJsonPath = join(dir, 'lattice.json');

  if (await fileExists(latticeJsonPath)) {
    const data = await readJSON<{ id?: string }>(latticeJsonPath);
    if (data?.id && PROJECT_ID_PATTERN.test(data.id)) {
      const existing = dbGetProjectById(data.id);
      if (existing) {
        if (existing.local_path !== dir) {
          // 路径变更了，更新
          const dirName = await findProjectDirName(username, data.id);
          if (dirName) {
            const meta = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
            if (meta) {
              meta.localPath = dir;
              meta.updated = new Date().toISOString();
              await writeJSON(getProjectMetaPath(username, dirName), meta);
              syncProjectToDb(username, meta);
            }
          }
          updated.push(dir);
        }
      } else {
        await registerProject(username, data.id, dir);
        added.push(dir);
      }
      return;
    }
  }

  // 递归子目录（跳过 node_modules/.git 等）
  const entries = await listDir(dir);
  const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.hg',
    '.svn',
    'dist',
    'build',
    '.cache',
    '.next',
    '.nuxt',
    '.output',
    'target',
    'vendor',
    '__pycache__',
  ]);

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    try {
      const { stat } = await import('node:fs/promises');
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        await scanDir(username, fullPath, added, updated);
      }
    } catch {
      // 权限问题等跳过
    }
  }
}

// ─── 工具函数 ───

/** 当前开发阶段直接使用项目 ID 作为目录名 */
async function findProjectDirName(username: string, id: string): Promise<string | null> {
  const dirName = makeProjectDirName(id);
  return (await fileExists(getProjectMetaPath(username, dirName))) ? dirName : null;
}

function syncProjectToDb(username: string, meta: ProjectMeta): void {
  try {
    upsertProject({
      id: meta.id,
      name: meta.name,
      local_path: meta.localPath,
      description: meta.description ?? null,
      git_remote: meta.gitRemote ?? null,
      groups: meta.groups ? JSON.stringify(meta.groups) : null,
      tags: meta.tags ? JSON.stringify(meta.tags) : null,
      username,
      created: meta.created,
      updated: meta.updated ?? null,
    });
  } catch {
    // 数据库可能未初始化（scan 时），静默跳过
  }
}

export { findProjectDirName };
