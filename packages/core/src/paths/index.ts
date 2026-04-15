import { homedir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { mkdir, readFile, writeFile, rm, stat, readdir, access } from 'node:fs/promises';

// ─── 根路径 ───

export function getLatticeRoot(): string {
  return pathJoin(homedir(), '.lattice');
}

// ─── 缓存 ───

export function getCacheDir(): string {
  return pathJoin(getLatticeRoot(), '.cache');
}

export function getDbPath(): string {
  return pathJoin(getCacheDir(), 'lattice.db');
}

// ─── 配置 ───

export function getConfigDir(): string {
  return pathJoin(getLatticeRoot(), 'config');
}

export function getGlobalConfigPath(): string {
  return pathJoin(getConfigDir(), 'config.json');
}

export function getLocalConfigPath(): string {
  return pathJoin(getConfigDir(), 'config-local.json');
}

// ─── 全局 spec ───

export function getGlobalSpecDir(): string {
  return pathJoin(getLatticeRoot(), 'spec');
}

export function getSpecTemplatesDir(): string {
  return pathJoin(getLatticeRoot(), 'templates', 'spec');
}

export function getTemplateRegistriesDir(): string {
  return pathJoin(getLatticeRoot(), 'templates', 'registries');
}

// ─── 用户 ───

export function getUsersDir(): string {
  return pathJoin(getLatticeRoot(), 'users');
}

export function getUserDir(username: string): string {
  return pathJoin(getUsersDir(), username);
}

export function getUserSpecDir(username: string): string {
  return pathJoin(getUserDir(username), 'spec');
}

export function getUserProjectsDir(username: string): string {
  return pathJoin(getUserDir(username), 'projects');
}

export function getUserTasksDir(username: string): string {
  return pathJoin(getUserDir(username), 'tasks');
}

// ─── 项目 ───

export function getProjectDir(username: string, projectDirName: string): string {
  return pathJoin(getUserProjectsDir(username), projectDirName);
}

export function getProjectMetaPath(username: string, projectDirName: string): string {
  return pathJoin(getProjectDir(username, projectDirName), 'project.json');
}

export function getProjectSpecDir(username: string, projectDirName: string): string {
  return pathJoin(getProjectDir(username, projectDirName), 'spec');
}

// ─── 任务 ───

export function getTaskDir(username: string, taskId: string): string {
  return pathJoin(getUserTasksDir(username), taskId);
}

export function getTaskMetaPath(username: string, taskId: string): string {
  return pathJoin(getTaskDir(username, taskId), 'task.json');
}

export function getTaskPrdPath(username: string, taskId: string): string {
  return pathJoin(getTaskDir(username, taskId), 'prd.md');
}

// ─── 生成目录名 ───

export function makeProjectDirName(id: string): string {
  return id;
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, '')
    .toLowerCase();
}

// ─── 通用文件操作 ───

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJSON(filePath: string, data: unknown): Promise<void> {
  const dir = pathJoin(filePath, '..');
  await ensureDir(dir);
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeText(filePath: string, content: string): Promise<void> {
  const dir = pathJoin(filePath, '..');
  await ensureDir(dir);
  await writeFile(filePath, content, 'utf-8');
}

export async function removeFile(filePath: string): Promise<void> {
  try {
    await rm(filePath, { recursive: true });
  } catch {
    // 文件不存在也不报错
  }
}

export async function removeDir(dirPath: string): Promise<void> {
  try {
    await rm(dirPath, { recursive: true, force: true });
  } catch {
    // 目录不存在也不报错
  }
}

export async function listDir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

/**
 * 从当前目录向上查找包含指定文件的目录
 */
export async function findUpwards(fileName: string, startDir: string): Promise<string | null> {
  let current = startDir;

  while (true) {
    if (await fileExists(pathJoin(current, fileName))) {
      return current;
    }
    const parent = pathJoin(current, '..');
    if (parent === current) return null;
    current = parent;
  }
}

export { basename } from 'node:path';
export { join } from 'node:path';
