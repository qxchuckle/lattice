import { join, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import type { ParsedSpec } from '../types';
import { getGlobalSpecDir, getUserSpecDir, getProjectSpecDir, listDir } from '../paths';
import { parseSpec } from './io';
import { findProjectDirName, listProjects } from '../project';

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

/** 获取所有已注册项目的 spec（聚合） */
export async function getAllProjectSpecs(username: string): Promise<ParsedSpec[]> {
  const projects = listProjects(username);
  const results: ParsedSpec[] = [];
  for (const p of projects) {
    const specs = await getProjectSpecs(username, p.id);
    results.push(...specs);
  }
  return results;
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

/**
 * 含祖先项目的级联聚合：项目 > 祖先（近→远）> 用户 > 全局
 * ancestorProjectIds 顺序为近→远（直接父级在前），级联时远→近插入确保近覆盖远
 */
export async function getCascadedSpecsWithAncestors(
  username: string,
  projectId: string,
  ancestorProjectIds: string[],
): Promise<{ cascaded: ParsedSpec[]; ancestorSpecs: ParsedSpec[] }> {
  // 并行加载所有层级
  const [globalSpecs, userSpecs, projectSpecs, ...ancestorSpecsList] = await Promise.all([
    getGlobalSpecs(),
    getUserSpecs(username),
    getProjectSpecs(username, projectId),
    ...ancestorProjectIds.map((id) => getProjectSpecs(username, id)),
  ]);

  const specMap = new Map<string, ParsedSpec>();

  // 全局 spec 先加入（最低优先级）
  for (const s of globalSpecs) specMap.set(s.relativePath, s);
  // 用户 spec 覆盖全局
  for (const s of userSpecs) specMap.set(s.relativePath, s);
  // 祖先 spec：从远到近加入（远的先，近的覆盖远的）
  const allAncestorSpecs: ParsedSpec[] = [];
  for (let i = ancestorSpecsList.length - 1; i >= 0; i--) {
    for (const s of ancestorSpecsList[i]) {
      specMap.set(s.relativePath, s);
      allAncestorSpecs.push(s);
    }
  }
  // 项目 spec 覆盖所有祖先
  for (const s of projectSpecs) specMap.set(s.relativePath, s);

  return {
    cascaded: Array.from(specMap.values()),
    ancestorSpecs: allAncestorSpecs,
  };
}
