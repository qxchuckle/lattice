/**
 * 扫描逻辑 + 黑名单 — 依赖 identity + lookup + register
 *
 * 核心函数：
 * - scanForProjects() — 扫描入口
 * - scanDir() — 递归扫描
 * - SKIP_DIR_PATTERNS / isBlacklisted() — 黑名单 glob 匹配
 */

import { stat } from 'node:fs/promises';
import { minimatch } from 'minimatch';
import type { FingerprintDerived } from './identity';
import { computeProjectIds, normalizeLegacyId } from './identity';
import { registerProjectWithIds, autoRegisterProject } from './register';
import { collectFingerprint } from './fingerprint';
import { fileExists, readJSON, listDir, join } from '../paths';

// ─── 黑名单 ───

/** 扫描时跳过的目录名（glob 语法匹配） */
const SKIP_DIR_PATTERNS = [
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
  '.pnpm-store',
  '.turbo',
  '.parcel-cache',
  'coverage',
  '.nyc_output',
  'bower_components',
  '.gradle',
  '.idea',
  '.vscode',
  // 通配模式
  '.*', // 所有隐藏目录
  '*.tmp',
];

/** 检查目录名是否在黑名单中（使用 minimatch 做 glob 匹配） */
export function isBlacklisted(name: string): boolean {
  return SKIP_DIR_PATTERNS.some((pattern) => minimatch(name, pattern));
}

// ─── 扫描结果 ───

export interface ScanResult {
  added: string[];
  updated: string[];
}

// ─── 扫描 ───

/**
 * 扫描指定目录列表，发现并注册 git 项目
 *
 * @param username 用户名
 * @param scanDirs 要扫描的目录列表
 * @returns 扫描结果（新增/更新的路径）
 */
export async function scanForProjects(username: string, scanDirs: string[]): Promise<ScanResult> {
  const added: string[] = [];
  const updated: string[] = [];

  for (const dir of scanDirs) {
    await scanDir(username, dir, added, updated);
  }

  return { added, updated };
}

/**
 * 递归扫描目录，发现 git 项目或 lattice.json 并注册
 *
 * 所有目录都递归子目录（不因当前目录有 id 源就跳过）
 */
async function scanDir(
  username: string,
  dir: string,
  added: string[],
  updated: string[],
): Promise<void> {
  // 1. 检查 .git 目录是否存在
  const isGitRepo = await fileExists(join(dir, '.git'));

  // 2. 检查 lattice.json 是否存在（兼容）
  const latticeJsonPath = join(dir, 'lattice.json');
  const hasLatticeJson = await fileExists(latticeJsonPath);
  let legacyId: string | null = null;
  if (hasLatticeJson) {
    const data = await readJSON<{ id?: string }>(latticeJsonPath);
    if (data?.id) {
      legacyId = normalizeLegacyId(data.id);
    }
  }

  // 3. 如果是 git 仓库或有 lattice.json → 采集指纹
  if (isGitRepo || legacyId) {
    const { derived } = await collectFingerprint(dir);
    const ids = computeProjectIds(derived as FingerprintDerived, legacyId);

    if (ids.length > 0) {
      // 4. 统一用 autoRegisterProject 处理（内部判断：已注册/fork/多用户/新建）
      const { meta, isNew } = await autoRegisterProject(username, ids, dir);
      if (isNew) {
        added.push(dir);
      } else if (meta) {
        updated.push(dir);
      }
    }
  }

  // 7. 所有目录都递归子目录
  let subEntries: string[];
  try {
    subEntries = await listDir(dir);
  } catch {
    return; // 目录不可读
  }

  for (const entry of subEntries) {
    // 黑名单匹配
    if (isBlacklisted(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        await scanDir(username, fullPath, added, updated);
      }
    } catch {
      // 权限问题等跳过
    }
  }
}
