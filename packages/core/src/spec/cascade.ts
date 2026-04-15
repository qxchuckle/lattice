import { join, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import type { ParsedSpec } from '../types';
import { getGlobalSpecDir, getUserSpecDir, getProjectSpecDir, listDir } from '../paths';
import { parseSpec } from './io';
import { findProjectDirName } from '../project';

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await listDir(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const entryStat = await stat(fullPath);
      if (entryStat.isDirectory()) {
        files.push(...(await listMarkdownFiles(fullPath)));
      } else if (entry.endsWith('.md')) {
        files.push(fullPath);
      }
    } catch {
      // 忽略不可访问文件
    }
  }

  return files;
}

/** 递归列出目录下所有 .md 文件并解析 */
async function listSpecsInDir(dir: string): Promise<ParsedSpec[]> {
  const files = await listMarkdownFiles(dir);
  const results: ParsedSpec[] = [];
  for (const filePath of files) {
    const spec = await parseSpec(filePath, relative(dir, filePath));
    if (spec) results.push(spec);
  }
  return results;
}

/** 获取全局 spec */
export async function getGlobalSpecs(): Promise<ParsedSpec[]> {
  return listSpecsInDir(getGlobalSpecDir());
}

/** 获取用户 spec */
export async function getUserSpecs(username: string): Promise<ParsedSpec[]> {
  return listSpecsInDir(getUserSpecDir(username));
}

/** 获取项目 spec */
export async function getProjectSpecs(username: string, projectId: string): Promise<ParsedSpec[]> {
  const dirName = await findProjectDirName(username, projectId);
  if (!dirName) return [];
  return listSpecsInDir(getProjectSpecDir(username, dirName));
}

/**
 * 三层级联聚合：项目 > 用户 > 全局
 * 同相对路径文件按优先级覆盖，不同路径文件合并
 */
export async function getCascadedSpecs(username: string, projectId: string): Promise<ParsedSpec[]> {
  const [globalSpecs, userSpecs, projectSpecs] = await Promise.all([
    getGlobalSpecs(),
    getUserSpecs(username),
    getProjectSpecs(username, projectId),
  ]);

  const specMap = new Map<string, ParsedSpec>();

  // 全局 spec 先加入（最低优先级）
  for (const s of globalSpecs) specMap.set(s.relativePath, s);
  // 用户 spec 覆盖全局
  for (const s of userSpecs) specMap.set(s.relativePath, s);
  // 项目 spec 覆盖用户
  for (const s of projectSpecs) specMap.set(s.relativePath, s);

  return Array.from(specMap.values());
}
