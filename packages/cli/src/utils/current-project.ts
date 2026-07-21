import { resolve as pathResolve, dirname, sep, join } from 'node:path';
import {
  readJSON,
  fileExists,
  initDb,
  collectFingerprint,
  computeProjectIds,
  normalizeLegacyId,
  selectPrimaryId,
  findProjectByAnyId,
  autoRegisterProject,
  getProjectMetaById,
  resolveProjectIds,
  getUsername,
  type ProjectMeta,
} from '@qcqx/lattice-core';

export interface CurrentProject {
  root: string;
  latticeJsonPath?: string;
  id: string;
  /** 所有 IDs（含主 ID 在内） */
  ids: string[];
}

export interface CurrentProjectWithAncestors {
  current: CurrentProject;
  /** 祖先项目列表（近→远，直接父级在前） */
  ancestors: CurrentProject[];
}

// ─── 进程内缓存 ───

let _cachedCurrent: CurrentProject | null | undefined;
let _cachedAncestors: CurrentProject[] | undefined;

/**
 * 从目录中收集 ID 源（.git / lattice.json）
 */
async function collectIdSources(
  dir: string,
): Promise<{ gitRepo: boolean; legacyId: string | null }> {
  const gitRepo = await fileExists(join(dir, '.git'));
  const latticeJsonPath = join(dir, 'lattice.json');
  let legacyId: string | null = null;

  if (await fileExists(latticeJsonPath)) {
    const data = await readJSON<{ id?: string }>(latticeJsonPath);
    if (data?.id) {
      legacyId = normalizeLegacyId(data.id);
    }
  }

  return { gitRepo, legacyId };
}

/**
 * 从目录生成 IDs
 */
async function generateIdsForDir(
  dir: string,
): Promise<{ ids: string[]; legacyId: string | null; hasLatticeJson: boolean }> {
  const { gitRepo, legacyId } = await collectIdSources(dir);
  const hasLatticeJson = legacyId !== null;

  if (!gitRepo && !legacyId) {
    return { ids: [], legacyId: null, hasLatticeJson };
  }

  const { derived } = await collectFingerprint(dir);
  const ids = computeProjectIds(derived, legacyId);
  return { ids, legacyId, hasLatticeJson };
}

/**
 * 从 startDir 向上逐级查找 ID 源并自动注册（无缓存核心逻辑）
 *
 * 逐级向上发现 id 源（.git / lattice.json），未注册的自动注册。
 * 返回距 startDir 最近的已注册项目及其祖先列表（近→远）。
 */
export async function resolveAndRegisterUpwards(
  startDir = process.cwd(),
): Promise<CurrentProjectWithAncestors | null> {
  try {
    await initDb();
  } catch {
    // DB 初始化失败，跳过自动注册
  }

  const username = await getUsername();

  // 从 startDir 向上逐级查找所有有 id 源的目录
  const idSourceDirs: { dir: string; ids: string[]; hasLatticeJson: boolean }[] = [];
  let currentDir = pathResolve(startDir);

  while (currentDir && currentDir !== sep && currentDir !== '.') {
    const { ids, hasLatticeJson } = await generateIdsForDir(currentDir);
    if (ids.length > 0) {
      idSourceDirs.push({ dir: currentDir, ids, hasLatticeJson });
    }
    currentDir = dirname(currentDir);
  }

  if (idSourceDirs.length === 0) {
    return null;
  }

  // 对每个有 id 源的目录：查 DB 或自动注册
  const registered: CurrentProject[] = [];
  for (const { dir, ids, hasLatticeJson } of idSourceDirs) {
    // 统一用 autoRegisterProject 处理（内部判断：已注册/fork/多用户/新建）
    try {
      const { meta, isNew } = await autoRegisterProject(username, ids, dir);
      if (meta && isNew) {
        console.log(`✓ 自动注册项目：${meta.name} (${selectPrimaryId(ids) ?? ids[0]})`);
      }
      if (meta) {
        const allIds = resolveProjectIds(meta);
        registered.push({
          root: dir,
          latticeJsonPath: hasLatticeJson ? join(dir, 'lattice.json') : undefined,
          id: selectPrimaryId(allIds) ?? allIds[0],
          ids: allIds,
        });
      }
    } catch {
      // 自动注册失败，跳过
    }
  }

  if (registered.length === 0) {
    return null;
  }

  // 返回距 startDir 最近的已注册项目（idSourceDirs 是从近到远排序的）
  return { current: registered[0], ancestors: registered.slice(1) };
}

/**
 * 解析当前项目（查找 + 自动注册，带进程内缓存）
 *
 * 从 cwd 向上逐级查找 id 源（.git / lattice.json），未注册的自动注册。
 * 返回距 cwd 最近的已注册项目。
 */
export async function resolveCurrentProject(
  startDir = process.cwd(),
): Promise<CurrentProject | null> {
  // 缓存检查
  if (_cachedCurrent !== undefined) return _cachedCurrent;

  const result = await resolveAndRegisterUpwards(startDir);
  if (!result) {
    _cachedCurrent = null;
    return null;
  }

  _cachedCurrent = result.current;
  _cachedAncestors = result.ancestors;
  return _cachedCurrent;
}

/**
 * 解析当前项目及其所有祖先项目
 *
 * 返回当前项目和按距离排序（近→远）的祖先项目列表
 */
export async function resolveCurrentProjectWithAncestors(
  startDir = process.cwd(),
): Promise<CurrentProjectWithAncestors | null> {
  if (_cachedCurrent !== undefined) {
    return _cachedCurrent ? { current: _cachedCurrent, ancestors: _cachedAncestors ?? [] } : null;
  }

  const result = await resolveAndRegisterUpwards(startDir);
  if (!result) {
    _cachedCurrent = null;
    return null;
  }

  _cachedCurrent = result.current;
  _cachedAncestors = result.ancestors;
  return result;
}

/**
 * 在指定目录解析项目（不向上查找，不自动注册）
 */
export async function resolveProjectAtDirectory(
  dir = process.cwd(),
): Promise<CurrentProject | null> {
  const { ids, hasLatticeJson } = await generateIdsForDir(dir);
  if (ids.length === 0) return null;

  try {
    await initDb();
  } catch {
    // ignore
  }

  const existing = findProjectByAnyId(ids);
  if (!existing) return null;

  const meta = await getProjectMetaById(existing.id);
  if (!meta) return null;

  const allIds = resolveProjectIds(meta.meta);
  return {
    root: dir,
    latticeJsonPath: hasLatticeJson ? join(dir, 'lattice.json') : undefined,
    id: existing.id,
    ids: allIds,
  };
}

/**
 * 清除进程内缓存
 */
export function clearCurrentProjectCache(): void {
  _cachedCurrent = undefined;
  _cachedAncestors = undefined;
}
