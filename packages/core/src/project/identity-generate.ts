/**
 * 项目 ID 生成 — Node.js 专有模块
 *
 * 包含 generateProjectId / computeProjectIds，依赖 node:crypto / node:path。
 * 浏览器环境不要导入此文件。
 */

import { createHash, randomBytes } from 'node:crypto';
import { resolve as pathResolve } from 'node:path';
import { ID_PREFIX, type FingerprintDerived } from './identity';

function hashSegment(input: string, length: number): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

function getDirectoryCode(projectPath: string): string {
  return hashSegment(pathResolve(projectPath), 4);
}

/**
 * 生成 legacy ID（16 字符 hex）
 *
 * 格式：4 字符目录码 + 12 字符随机数
 * 用于 lattice.json 的 id 字段
 */
export function generateProjectId(projectPath: string): string {
  return `${getDirectoryCode(projectPath)}${randomBytes(6).toString('hex')}`;
}

/**
 * 从指纹数据 + legacy id 计算项目的所有 IDs
 *
 * IDs 顺序不保证优先级，优先级由 selectPrimaryId() 运行时计算
 */
export function computeProjectIds(derived: FingerprintDerived, legacyId: string | null): string[] {
  const ids: string[] = [];

  if (legacyId) {
    ids.push(legacyId);
  }

  if (derived.gitFirstCommit) {
    ids.push(`${ID_PREFIX.GIT}:${derived.gitFirstCommit.slice(0, 16)}`);
  }

  for (const remote of derived.gitRemotes) {
    const hash = createHash('sha256').update(remote).digest('hex').slice(0, 16);
    ids.push(`${ID_PREFIX.REMOTE}:${hash}`);
  }

  return ids;
}
