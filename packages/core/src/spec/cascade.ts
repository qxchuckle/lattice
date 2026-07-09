import { join, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import type { ParsedSpec } from '../types';
import { getGlobalSpecDir, getUserSpecDir, getProjectSpecDir, listDir } from '../paths';
import { parseSpec } from './io';
import {
  findProjectDirName,
  listProjects,
  getProjectDirNames,
  normalizeProjectId,
} from '../project';

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

/**
 * 获取项目 spec（含虚拟合并组聚合）
 *
 * 通过 DB project_dirs 表查询虚拟合并组的所有物理目录，
 * 聚合所有目录的项目级 spec，按 relativePath 去重。
 * 当前项目目录优先级最高（最后写入覆盖同名 spec）。
 *
 * 应用层只需调用本函数即可获得虚拟合并后的完整 spec 集合，
 * 无需感知虚拟合并的存在。
 */
export async function getProjectSpecs(username: string, projectId: string): Promise<ParsedSpec[]> {
  const normalizedId = normalizeProjectId(projectId);

  // 从 DB 查询虚拟合并组的所有物理目录名
  let dirNames: string[];
  try {
    dirNames = getProjectDirNames(username, normalizedId);
  } catch {
    dirNames = [];
  }
  const currentDirName = await findProjectDirName(username, normalizedId);

  const specMap = new Map<string, ParsedSpec>();

  // 先获取其他目录（低优先级）
  for (const dirName of dirNames) {
    if (dirName === currentDirName) continue;
    try {
      const specs = await listSpecsInDir(getProjectSpecDir(username, dirName));
      for (const s of specs) {
        if (!specMap.has(s.relativePath)) specMap.set(s.relativePath, s);
      }
    } catch {
      // 忽略单个目录读取失败
    }
  }

  // 当前项目目录最后写入（高优先级）
  if (currentDirName) {
    const currentSpecs = await listSpecsInDir(getProjectSpecDir(username, currentDirName));
    for (const s of currentSpecs) specMap.set(s.relativePath, s);
  }

  return [...specMap.values()];
}

/** 获取所有已注册项目的 spec（聚合，按 filePath 去重） */
export async function getAllProjectSpecs(username: string): Promise<ParsedSpec[]> {
  const projects = listProjects(username);
  const specMap = new Map<string, ParsedSpec>();
  for (const p of projects) {
    const specs = await getProjectSpecs(username, p.id);
    for (const s of specs) {
      specMap.set(s.filePath, s);
    }
  }
  return [...specMap.values()];
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
