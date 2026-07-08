/**
 * 嵌套项目自动检测 — 向上查找祖先 git 项目并建立 nested-in 关系
 *
 * 在 autoRegisterProject / registerProjectWithIds 末尾自动调用。
 * 幂等：每次先清除该项目旧的 auto nested-in 关系，再重新检测。
 */

import { resolve as pathResolve, dirname, sep } from 'node:path';
import type { ProjectMeta } from '../types';
import { fileExists, readJSON } from '../paths';
import { collectFingerprint } from './fingerprint';
import { computeProjectIds } from './identity-generate';
import { normalizeLegacyId } from './identity';
import { findProjectByAnyId } from './lookup';
import { deleteRelationsByFilter, upsertRelation as upsertRelationFile } from './relation';

/**
 * 从 lattice.json 读取 legacy ID
 */
async function readLegacyIdFromLatticeJson(dir: string): Promise<string | null> {
  try {
    const latticeJsonPath = pathResolve(dir, 'lattice.json');
    if (!(await fileExists(latticeJsonPath))) return null;
    const data = await readJSON<{ id?: string }>(latticeJsonPath);
    if (!data?.id) return null;
    return normalizeLegacyId(data.id);
  } catch {
    return null;
  }
}

/**
 * 向上查找所有有 .git 或 lattice.json 的祖先目录
 */
async function findAncestorProjectRoots(startDir: string): Promise<string[]> {
  const roots: string[] = [];
  let currentDir = pathResolve(startDir);

  while (currentDir && currentDir !== sep && currentDir !== '.') {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;

    try {
      const hasGit = await fileExists(pathResolve(currentDir, '.git'));
      const hasLatticeJson = await fileExists(pathResolve(currentDir, 'lattice.json'));
      if (hasGit || hasLatticeJson) {
        roots.push(currentDir);
      }
    } catch {
      // 权限问题等跳过
    }
  }

  return roots;
}

/**
 * 自动检测父级项目并建立 nested-in 关系
 *
 * @param username 当前用户
 * @param childProjectId 子项目 primary ID
 * @param childDir 子项目目录
 * @returns 检测到的父级项目列表
 */
export async function detectAndLinkNestedIn(
  username: string,
  childProjectId: string,
  childDir: string,
): Promise<{ id: string; name: string; type: 'direct' | 'ancestor' }[]> {
  const results: { id: string; name: string; type: 'direct' | 'ancestor' }[] = [];

  try {
    // 幂等：先清除该项目旧的 auto nested-in 关系
    await deleteRelationsByFilter(username, {
      projectId: childProjectId,
      type: 'nested-in',
      createdBy: 'auto',
    });

    // 向上查找所有祖先 .git / lattice.json 目录
    const ancestorRoots = await findAncestorProjectRoots(childDir);

    for (let i = 0; i < ancestorRoots.length; i++) {
      const ancestorRoot = ancestorRoots[i];

      try {
        const { derived: ancestorDerived } = await collectFingerprint(ancestorRoot);
        const ancestorLegacyId = await readLegacyIdFromLatticeJson(ancestorRoot);
        const ancestorIds = computeProjectIds(ancestorDerived, ancestorLegacyId);

        if (ancestorIds.length === 0) continue;

        const ancestorRow = findProjectByAnyId(ancestorIds);
        if (!ancestorRow) continue;
        if (ancestorRow.id === childProjectId) continue;

        // 建立 nested-in 关系（幂等）
        await upsertRelationFile(username, {
          projectA: childProjectId,
          projectB: ancestorRow.id,
          type: 'nested-in',
          description: i === 0 ? '直接父级项目' : `第 ${i + 1} 级祖先项目`,
          createdBy: 'auto',
        });

        results.push({
          id: ancestorRow.id,
          name: ancestorRow.name,
          type: i === 0 ? 'direct' : 'ancestor',
        });
      } catch {
        // 单个祖先检测失败不影响其他
      }
    }
  } catch {
    // 整体失败不阻塞注册流程
  }

  return results;
}
