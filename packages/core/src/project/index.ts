import { createHash, randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { basename as pathBasename, resolve as pathResolve } from 'node:path';
import machineIdPkg from 'node-machine-id';
import type { ProjectMeta, ProjectRow } from '../types';
import {
  getProjectDir,
  getProjectMetaPath,
  getProjectSpecDir,
  getUserProjectsDir,
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
import {
  collectFingerprint,
  persistFingerprints,
  normalizeGitRemote,
  normalizeLocalPath,
  findProjectByPathSmart,
  isPathPrefixOf,
} from './fingerprint';
import { deleteRelationsByProject, listRelations as listRelationsFromFile } from './relation';
import type { ProjectRelation } from '../types';
import { moveToTrash } from '../trash';

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

// ─── 项目信息自动检测（轻量）───

export interface DetectedProjectInfo {
  name: string;
  description?: string;
  gitRemotes: string[];
}

export async function detectProjectInfo(projectPath: string): Promise<DetectedProjectInfo> {
  const name = pathBasename(projectPath);
  let description: string | undefined;
  const gitRemotes: string[] = [];

  const pkgPath = join(projectPath, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJSON<{ name?: string; description?: string }>(pkgPath);
    if (pkg?.description) description = pkg.description;
  }

  try {
    const remoteNames = execSync('git remote', {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 3000,
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const r of remoteNames) {
      try {
        const url = execSync(`git remote get-url ${r}`, {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        if (url) {
          const normalized = normalizeGitRemote(url);
          if (normalized && !gitRemotes.includes(normalized)) gitRemotes.push(normalized);
        }
      } catch {
        // 忽略
      }
    }
  } catch {
    // 不是 git 仓库
  }

  return { name, description, gitRemotes };
}

// ─── 项目注册 ───

export async function registerProject(
  username: string,
  id: string,
  localPath: string,
  opts?: Partial<Pick<ProjectMeta, 'name' | 'description' | 'groups' | 'tags'>> & {
    gitRemotes?: string[];
  },
): Promise<ProjectMeta> {
  const detected = await detectProjectInfo(localPath);
  const fingerprint = await collectFingerprint(localPath);
  const now = new Date().toISOString();
  const dirName = makeProjectDirName(id);
  const existingMeta = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
  const name = opts?.name ?? detected.name ?? existingMeta?.name;
  const normalizedPath = normalizeLocalPath(localPath);

  // localPaths 合并（去重）
  const localPaths = new Set<string>();
  if (existingMeta?.localPaths) {
    for (const p of existingMeta.localPaths) localPaths.add(p);
  }
  localPaths.add(normalizedPath);

  // gitRemotes 合并
  const gitRemotes = new Set<string>();
  if (existingMeta?.gitRemotes) {
    for (const r of existingMeta.gitRemotes) gitRemotes.add(r);
  }
  for (const r of opts?.gitRemotes ?? []) gitRemotes.add(normalizeGitRemote(r));
  for (const r of detected.gitRemotes) gitRemotes.add(r);

  const meta: ProjectMeta = {
    id,
    name,
    description: opts?.description ?? existingMeta?.description ?? undefined,
    localPaths: [...localPaths],
    gitRemotes: gitRemotes.size > 0 ? [...gitRemotes] : undefined,
    gitFirstCommit: fingerprint.derived.gitFirstCommit ?? existingMeta?.gitFirstCommit,
    gitDefaultBranch: fingerprint.derived.gitDefaultBranch ?? existingMeta?.gitDefaultBranch,
    packageNames:
      fingerprint.derived.packageNames.length > 0
        ? fingerprint.derived.packageNames
        : existingMeta?.packageNames,
    monorepoPackages:
      fingerprint.derived.monorepoPackages.length > 0
        ? fingerprint.derived.monorepoPackages
        : existingMeta?.monorepoPackages,
    fingerprintsUpdated: now,
    groups: opts?.groups ?? existingMeta?.groups,
    tags: opts?.tags ?? existingMeta?.tags,
    created: existingMeta?.created ?? now,
    updated: existingMeta ? now : undefined,
  };

  if (!meta.description && existingMeta?.description) meta.description = existingMeta.description;
  if (!meta.description && detected.description) meta.description = detected.description;

  const projectDir = getProjectDir(username, dirName);
  await ensureDir(projectDir);
  await ensureDir(getProjectSpecDir(username, dirName));
  await writeJSON(getProjectMetaPath(username, dirName), meta);

  syncProjectToDb(username, meta);
  persistFingerprints(id, fingerprint.entries);

  return meta;
}

// ─── 取消注册 ───

export async function unregisterProject(username: string, id: string): Promise<void> {
  const dirName = await findProjectDirName(username, id);
  if (dirName) {
    const projectDir = getProjectDir(username, dirName);
    const meta = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
    await moveToTrash(projectDir, {
      type: 'project',
      originalPath: projectDir,
      title: meta?.name ?? id,
      username,
      entityId: id,
      restoreHints: { localPaths: meta?.localPaths ?? [] },
    });
  }
  try {
    await deleteRelationsByProject(username, id);
  } catch {
    // relations.json 不存在时忽略
  }
  dbDeleteProject(id, username);
}

/** 彻底删除项目（跳过垃圾桶） */
export async function purgeProject(username: string, id: string): Promise<void> {
  try {
    await deleteRelationsByProject(username, id);
  } catch {
    // ignore
  }
  dbDeleteProject(id, username);
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

export function listProjects(
  username: string,
  filter?: { group?: string; tag?: string },
): ProjectRow[] {
  let projects = dbListAllProjects(username);
  if (filter?.group) {
    projects = projects.filter((p) => {
      const groups: string[] = p.groups ? JSON.parse(p.groups) : [];
      return groups.includes(filter.group!);
    });
  }
  if (filter?.tag) {
    projects = projects.filter((p) => {
      const tags: string[] = p.tags ? JSON.parse(p.tags) : [];
      return tags.includes(filter.tag!);
    });
  }
  return projects;
}

/**
 * 按本地路径查找项目：
 * 1. 先走 db 的 LIKE 精确包含查询（localPaths 存为 JSON 字符串）
 * 2. 如果未命中，再走 fingerprint 反查（父目录前缀 / basename / monorepo 包名）
 */
export function findProjectByPath(localPath: string): ProjectRow | undefined {
  const direct = dbGetProjectByPath(localPath);
  if (direct) return direct;
  return undefined;
}

/** 智能查找：返回带评分的候选列表 */
export async function findProjectsByPathSmart(localPath: string) {
  return findProjectByPathSmart(localPath);
}

export function findProjectById(id: string): ProjectRow | undefined {
  return dbGetProjectById(id);
}

/** 通过精确 ID 或前缀匹配解析项目 */
export function resolveProjectById(username: string, input: string): ProjectRow | undefined {
  const projects = dbListAllProjects(username);
  return projects.find((p) => p.id === input) ?? projects.find((p) => p.id.startsWith(input));
}

/**
 * 获取所有项目关系（从 relations.json 单一真源读取）
 * 返回格式保持与原同，但额外带 id。
 */
export async function getAllUniqueRelations(
  username: string,
  projectIds?: string[],
): Promise<
  {
    id: string;
    project_a: string;
    project_b: string;
    relation_type: string;
    description: string | null;
  }[]
> {
  let relations: ProjectRelation[];
  try {
    relations = await listRelationsFromFile(username);
  } catch {
    relations = [];
  }

  const projectFilter = projectIds ? new Set(projectIds) : null;
  const seen = new Set<string>();
  const results: {
    id: string;
    project_a: string;
    project_b: string;
    relation_type: string;
    description: string | null;
  }[] = [];

  for (const r of relations) {
    if (projectFilter && !projectFilter.has(r.projectA) && !projectFilter.has(r.projectB)) continue;
    const key = `${r.projectA}:${r.projectB}:${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: r.id,
      project_a: r.projectA,
      project_b: r.projectB,
      relation_type: r.type,
      description: r.description ?? null,
    });
  }
  return results;
}

/** 解析项目行的 tags/groups JSON 字符串为数组 */
export function parseProjectRow(
  row: ProjectRow,
): ProjectRow & { parsedTags: string[]; parsedGroups: string[] } {
  return {
    ...row,
    parsedTags: row.tags ? JSON.parse(row.tags) : [],
    parsedGroups: row.groups ? JSON.parse(row.groups) : [],
  };
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
        // 检查当前路径是否在 localPaths 中；不在则追加
        const dirName = await findProjectDirName(username, data.id);
        let pathChanged = false;
        if (dirName) {
          const meta = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
          if (meta) {
            const norm = normalizeLocalPath(dir);
            const existingPaths = new Set(meta.localPaths ?? []);
            if (!existingPaths.has(norm)) {
              existingPaths.add(norm);
              meta.localPaths = [...existingPaths];
              meta.updated = new Date().toISOString();
              await writeJSON(getProjectMetaPath(username, dirName), meta);
              syncProjectToDb(username, meta);
              pathChanged = true;
            }
          }
        }
        if (pathChanged) updated.push(dir);
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

/**
 * 解析项目 id 对应的目录名。
 * 主路径：dirName === makeProjectDirName(id)（当前为 id 本身）。
 * 兼容回退：扫描 projects 目录，匹配 project.json 中 id 一致的 legacy 短前缀目录。
 */
async function findProjectDirName(username: string, id: string): Promise<string | null> {
  const direct = makeProjectDirName(id);
  if (await fileExists(getProjectMetaPath(username, direct))) {
    return direct;
  }
  try {
    const entries = await listDir(getUserProjectsDir(username));
    for (const entry of entries) {
      if (entry === direct) continue;
      const metaPath = getProjectMetaPath(username, entry);
      if (!(await fileExists(metaPath))) continue;
      const meta = await readJSON<ProjectMeta>(metaPath);
      if (meta?.id === id) return entry;
    }
  } catch {
    // projects 目录不存在或不可读，安静失败
  }
  return null;
}

function syncProjectToDb(username: string, meta: ProjectMeta): void {
  try {
    upsertProject({
      id: meta.id,
      name: meta.name,
      local_path: JSON.stringify(meta.localPaths ?? []),
      description: meta.description ?? null,
      git_remote:
        meta.gitRemotes && meta.gitRemotes.length > 0 ? JSON.stringify(meta.gitRemotes) : null,
      git_first_commit: meta.gitFirstCommit ?? null,
      git_default_branch: meta.gitDefaultBranch ?? null,
      package_names:
        meta.packageNames && meta.packageNames.length > 0
          ? JSON.stringify(meta.packageNames)
          : null,
      monorepo_packages:
        meta.monorepoPackages && meta.monorepoPackages.length > 0
          ? JSON.stringify(meta.monorepoPackages)
          : null,
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

// 指针导出：路径阅读辅助
export { isPathPrefixOf };

export { findProjectDirName };
