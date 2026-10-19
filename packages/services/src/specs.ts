/** Spec 域：分层列表 / 查找 / 冲突 / 迁移。 */
import {
  detectSpecConflicts,
  findSpecById,
  findSpecByName,
  formatSpecParseError,
  getGlobalSpecs,
  getAllProjectSpecsGrouped,
  getProjectSpecs,
  getUserSpecs,
  migrateSpecs as coreMigrateSpecs,
  parseSpec,
  writeSpec,
} from '@qcqx/lattice-core';
import type { ParsedSpec, SpecConflict, SpecFrontmatter } from '@qcqx/lattice-core';
import { inferSpecScope, type SpecScopeWire, type SpecWithScope } from './shared';

export interface ListSpecsOptions {
  scope?: SpecScopeWire;
  /** project 范围限定（不传 = 全部项目）。 */
  projectId?: string;
}

/** Spec 列表（带层级标注；project 范围默认覆盖全部已注册项目）。 */
export async function listSpecs(
  username: string,
  opts: ListSpecsOptions = {},
): Promise<SpecWithScope[]> {
  const want = opts.scope;
  const out: SpecWithScope[] = [];
  // 同一物理文件只保留首见条目：防上游项目列表出现别名/重复时把 spec 列两遍
  // （重复条目会让消费端树节点 id 撞车 / 计数虚高）。
  const seenPaths = new Set<string>();
  const push = (
    spec: SpecWithScope['spec'],
    scope: SpecWithScope['scope'],
    projectId?: string,
  ): void => {
    if (spec.filePath && seenPaths.has(spec.filePath)) return;
    if (spec.filePath) seenPaths.add(spec.filePath);
    out.push(projectId ? { spec, scope, projectId } : { spec, scope });
  };

  if (!want || want === 'global') {
    for (const spec of await getGlobalSpecs()) push(spec, 'global');
  }
  if (!want || want === 'user') {
    for (const spec of await getUserSpecs(username)) push(spec, 'user');
  }
  if (!want || want === 'project') {
    if (opts.projectId) {
      for (const spec of await getProjectSpecs(username, opts.projectId)) {
        push(spec, 'project', opts.projectId);
      }
    } else {
      const groups = await getAllProjectSpecsGrouped(username).catch(() => []);
      for (const group of groups) {
        for (const spec of group.specs) {
          push(spec, 'project', group.projectId);
        }
      }
    }
  }
  return out;
}

/** 按 spec ID 或名称查找（ID 精确优先 → 名称模糊）。 */
export async function findSpec(username: string, idOrName: string): Promise<SpecWithScope | null> {
  const byId = await findSpecById(username, idOrName).catch(() => null);
  if (byId) {
    return { spec: byId.spec, scope: byId.scope, projectId: byId.projectId };
  }
  const matches = await findSpecByName(username, null, idOrName).catch(() => []);
  const first = matches[0];
  if (!first) return null;
  const scope =
    first.scope === 'direct' ? inferSpecScope(first.spec.filePath, username) : first.scope;
  return { spec: first.spec, scope, projectId: first.spec.projectId };
}

/** 三层同名冲突检测（projectId 为空时仅比较 global/user 层）。 */
export async function detectConflicts(username: string, projectId = ''): Promise<SpecConflict[]> {
  try {
    return await detectSpecConflicts(username, projectId);
  } catch {
    return [];
  }
}

/**
 * 全量冲突检测（跨所有项目，供编辑器诊断使用）：
 * 判据与 core detectSpecConflicts 一致（同一项目视窗内三层的同相对路径），
 * global/user 层只报一次；同组冲突按文件集合去重。
 */
export async function detectAllConflicts(username: string): Promise<SpecConflict[]> {
  const [global, user, groups] = await Promise.all([
    getGlobalSpecs(),
    getUserSpecs(username),
    getAllProjectSpecsGrouped(username).catch(() => []),
  ]);

  const seen = new Set<string>();
  const conflicts: SpecConflict[] = [];

  const collect = (projectSpecs: ParsedSpec[]) => {
    const byRelative = new Map<
      string,
      Array<{ scope: 'project' | 'user' | 'global'; spec: ParsedSpec }>
    >();
    const add = (specs: ParsedSpec[], scope: 'project' | 'user' | 'global') => {
      for (const spec of specs) {
        const list = byRelative.get(spec.relativePath) ?? [];
        list.push({ scope, spec });
        byRelative.set(spec.relativePath, list);
      }
    };
    add(global, 'global');
    add(user, 'user');
    add(projectSpecs, 'project');

    for (const [relativePath, entries] of byRelative) {
      if (entries.length <= 1) continue;
      const key = entries
        .map((entry) => entry.spec.filePath)
        .sort()
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        fileName: relativePath,
        levels: entries.map((entry) => ({
          scope: entry.scope,
          filePath: entry.spec.filePath,
          specId: entry.spec.frontmatter.id,
          snippet:
            entry.spec.content.slice(0, 100) + (entry.spec.content.length > 100 ? '...' : ''),
        })),
      });
    }
  };

  collect([]);
  for (const group of groups) collect(group.specs);
  return conflicts;
}

/** 迁移旧格式 spec（frontmatter 补 id/title/updated）。 */
export async function migrateSpecs(
  opts: { scope?: 'all' | 'global' | 'user' | 'project'; dryRun?: boolean; filter?: string } = {},
): Promise<Awaited<ReturnType<typeof coreMigrateSpecs>>> {
  return coreMigrateSpecs({
    scope: opts.scope ?? 'all',
    dryRun: opts.dryRun ?? false,
    filter: opts.filter,
  });
}

export interface SpecFrontmatterUpdates {
  title?: string;
  description?: string;
  tags?: string[];
}

/**
 * 更新 spec frontmatter（title / description / tags；正文不动）。
 * 与 CLI `spec set` 同口径：YAML 解析失败时拒绝写入，避免丢字段。
 */
export async function updateSpecFrontmatter(
  username: string,
  specId: string,
  updates: SpecFrontmatterUpdates,
): Promise<{ specId: string; filePath: string } | null> {
  const found = await findSpec(username, specId);
  if (!found) return null;
  const parsed = await parseSpec(found.spec.filePath);
  if (!parsed) return null;
  if (parsed.parseError) {
    throw new Error(
      `spec frontmatter YAML 解析失败，已拒绝写入：${formatSpecParseError(parsed.parseError)}`,
    );
  }
  const frontmatter: SpecFrontmatter = { ...parsed.frontmatter };
  if (updates.title !== undefined) frontmatter.title = updates.title.trim();
  if (updates.description !== undefined) frontmatter.description = updates.description.trim();
  if (updates.tags !== undefined) {
    frontmatter.tags = [...new Set(updates.tags.map((tag) => tag.trim()).filter(Boolean))];
  }
  await writeSpec(found.spec.filePath, frontmatter, parsed.content);
  const reread = await parseSpec(found.spec.filePath);
  return {
    specId: reread?.frontmatter.id ?? frontmatter.id ?? found.spec.fileName,
    filePath: found.spec.filePath,
  };
}
