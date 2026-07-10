import { randomBytes } from 'node:crypto';
import { join as pathJoin } from 'node:path';
import { stringify, parse } from 'yaml';
import type { FastStartLogEntry, FastStartLogFile } from './types';
import {
  getFastStartLogDir,
  getFastStartLogFilePath,
  getFastStartLogFileName,
  ensureDir,
  readText,
  writeText,
  fileExists,
  listDir,
  removeDir,
} from './paths';
import { nowISO } from './utils/time';

/** 单文件最大条目数，超过后自动分片到下一个文件 */
export const MAX_ENTRIES_PER_FILE = 1000;

/** 生成日志条目 ID：fs_<8 位 hex> */
function generateLogId(): string {
  return `fs_${randomBytes(4).toString('hex')}`;
}

/** 列出所有日志文件名（按文件名排序 = 按创建时间排序） */
async function listLogFiles(username: string): Promise<string[]> {
  const dir = getFastStartLogDir(username);
  const exists = await fileExists(dir);
  if (!exists) return [];

  const entries = await listDir(dir);
  return entries.filter((name) => name.startsWith('log-') && name.endsWith('.yaml')).sort();
}

/** 按完整路径读取日志文件 */
async function readLogFileByPath(filePath: string): Promise<FastStartLogFile | null> {
  const content = await readText(filePath);
  if (!content || !content.trim()) return null;

  try {
    const data = parse(content) as FastStartLogFile | null;
    if (!data || !Array.isArray(data.entries)) return null;
    return data;
  } catch {
    return null;
  }
}

/** 按文件名读取日志文件 */
async function readLogFileByName(
  username: string,
  fileName: string,
): Promise<FastStartLogFile | null> {
  return readLogFileByPath(pathJoin(getFastStartLogDir(username), fileName));
}

/** 写入日志文件 */
async function writeLogFile(username: string, file: FastStartLogFile): Promise<void> {
  const filePath = getFastStartLogFilePath(username, file.createdAt);
  const content = stringify(file, { lineWidth: 0 });
  await writeText(filePath, content);
}

/**
 * 找到当前可写入的日志文件创建时间。
 *
 * 扫描已有文件，返回最后一个条目数未满的文件 createdAt；
 * 若所有文件都满了或目录为空，返回当前时间戳作为新文件的 createdAt。
 */
export async function getWritableFileCreatedAt(username: string): Promise<string> {
  const logFiles = await listLogFiles(username);
  if (logFiles.length === 0) return nowISO();

  const lastFileName = logFiles[logFiles.length - 1];
  const lastFile = await readLogFileByName(username, lastFileName);
  if (!lastFile) return nowISO();

  if (lastFile.entries.length < MAX_ENTRIES_PER_FILE) {
    return lastFile.createdAt;
  }

  // 已满，返回新时间戳
  return nowISO();
}

export interface AddLogOptions {
  title: string;
  message: string;
  cwd: string;
  projectId?: string;
  projectName?: string;
  files?: string[];
}

/** 添加一条 fast-start 日志 */
export async function addLogEntry(
  username: string,
  opts: AddLogOptions,
): Promise<FastStartLogEntry> {
  const entry: FastStartLogEntry = {
    id: generateLogId(),
    time: nowISO(),
    title: opts.title.trim(),
    message: opts.message.trim(),
    cwd: opts.cwd,
    projectId: opts.projectId,
    projectName: opts.projectName,
    files: opts.files?.length ? opts.files : undefined,
  };

  const createdAt = await getWritableFileCreatedAt(username);
  await ensureDir(getFastStartLogDir(username));

  let file = await readLogFileByName(username, getFastStartLogFileName(createdAt));
  if (!file) {
    file = { createdAt, entries: [] };
  }

  file.entries.push(entry);
  await writeLogFile(username, file);

  return entry;
}

export interface ListLogOptions {
  /** 只返回最近 N 条 */
  last?: number;
  /** 按项目 ID 过滤 */
  projectId?: string;
}

/**
 * 列出所有 fast-start 日志条目（跨所有分片文件）。
 *
 * 按时间顺序返回（旧→新）。支持 last / projectId 过滤。
 */
export async function listLogEntries(
  username: string,
  opts?: ListLogOptions,
): Promise<FastStartLogEntry[]> {
  const logFiles = await listLogFiles(username);
  const allEntries: FastStartLogEntry[] = [];

  for (const fileName of logFiles) {
    const file = await readLogFileByName(username, fileName);
    if (file) {
      allEntries.push(...file.entries);
    }
  }

  let result = allEntries;

  if (opts?.projectId) {
    result = result.filter((e) => e.projectId === opts.projectId);
  }

  // last 取最后 N 条（最新的）
  if (opts?.last && opts.last > 0) {
    result = result.slice(-opts.last);
  }

  return result;
}

export interface SearchLogOptions {
  /** 搜索关键词 */
  query: string;
  /** 按项目 ID 过滤 */
  projectId?: string;
  /** 只返回最近 N 条 */
  last?: number;
}

/**
 * 关键词搜索 fast-start 日志条目。
 *
 * 搜索范围：title / message / files / cwd（不区分大小写）。
 * 按时间倒序返回（新→旧）。
 */
export async function searchLogEntries(
  username: string,
  opts: SearchLogOptions,
): Promise<FastStartLogEntry[]> {
  const query = opts.query.trim().toLowerCase();
  if (!query) return [];

  const logFiles = await listLogFiles(username);
  const matched: FastStartLogEntry[] = [];

  for (const fileName of logFiles) {
    const file = await readLogFileByName(username, fileName);
    if (!file) continue;

    for (const entry of file.entries) {
      const inTitle = entry.title.toLowerCase().includes(query);
      const inMessage = entry.message.toLowerCase().includes(query);
      const inCwd = entry.cwd.toLowerCase().includes(query);
      const inFiles = entry.files?.some((f) => f.toLowerCase().includes(query)) ?? false;

      if (inTitle || inMessage || inCwd || inFiles) {
        matched.push(entry);
      }
    }
  }

  // 按时间倒序（新→旧）
  matched.sort((a, b) => b.time.localeCompare(a.time));

  let result = matched;

  if (opts.projectId) {
    result = result.filter((e) => e.projectId === opts.projectId);
  }

  if (opts.last && opts.last > 0) {
    result = result.slice(0, opts.last);
  }

  return result;
}

/** 获取单条日志（跨所有文件查找） */
export async function getLogEntry(username: string, id: string): Promise<FastStartLogEntry | null> {
  const logFiles = await listLogFiles(username);

  for (const fileName of logFiles) {
    const file = await readLogFileByName(username, fileName);
    if (file) {
      const entry = file.entries.find((e) => e.id === id);
      if (entry) return entry;
    }
  }

  return null;
}

/** 清空所有 fast-start 日志 */
export async function clearAllLogs(username: string): Promise<number> {
  const dir = getFastStartLogDir(username);
  const exists = await fileExists(dir);
  if (!exists) return 0;

  const entries = await listDir(dir);
  const logFiles = entries.filter((name) => name.startsWith('log-') && name.endsWith('.yaml'));

  const count = logFiles.length;
  await removeDir(dir);
  return count;
}

export interface FastStartLogStats {
  totalEntries: number;
  fileCount: number;
  latestFileName: string | null;
  latestFileCreatedAt: string | null;
  latestFileEntries: number;
}

/** 获取日志统计信息 */
export async function getLogStats(username: string): Promise<FastStartLogStats> {
  const logFiles = await listLogFiles(username);

  if (logFiles.length === 0) {
    return {
      totalEntries: 0,
      fileCount: 0,
      latestFileName: null,
      latestFileCreatedAt: null,
      latestFileEntries: 0,
    };
  }

  let totalEntries = 0;
  let latestFileName: string | null = null;
  let latestFileCreatedAt: string | null = null;
  let latestFileEntries = 0;

  for (const fileName of logFiles) {
    const file = await readLogFileByName(username, fileName);
    if (file) {
      totalEntries += file.entries.length;
      latestFileName = fileName;
      latestFileCreatedAt = file.createdAt;
      latestFileEntries = file.entries.length;
    }
  }

  return {
    totalEntries,
    fileCount: logFiles.length,
    latestFileName,
    latestFileCreatedAt,
    latestFileEntries,
  };
}
