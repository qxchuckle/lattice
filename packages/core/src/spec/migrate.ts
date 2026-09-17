import type { ParsedSpec } from '../types';
import { writeSpec, normalizeSpecFrontmatter, formatSpecParseError } from './io';
import { isValidSpecId } from './id';
import { getGlobalSpecs, getUserSpecs, getAllProjectSpecsGrouped } from './cascade';
import { getUsername } from '../config';
import { getProjectSpecDir, getUserSpecDir, getGlobalSpecDir, getFileMtime } from '../paths';

/** spec 所属层级 */
export type MigrateSpecLevel = 'global' | 'user' | 'project';

/** 迁移结果中单条 spec 的归属信息（全项目视角下用于溯源、展示与跨项目确认判定） */
export interface MigrateSpecRef {
  filePath: string;
  level: MigrateSpecLevel;
  /** 仅 project 级非空 */
  projectId: string | null;
  /** 仅 project 级非空 */
  projectName: string | null;
}

export interface MigrateResult {
  /** 成功 backfill 的 spec */
  migrated: (MigrateSpecRef & { addedFields: string[] })[];
  /** 跳过的（已合规） */
  skipped: string[];
  /** 出错的 */
  errors: (MigrateSpecRef & { message: string })[];
  /** 缺 description 但不自动补（仅报告） */
  needsDescription: MigrateSpecRef[];
}

export interface MigrateOptions {
  /** 限定 scope（默认 all）；project / all 的 project 级覆盖全部已注册项目 */
  scope?: 'all' | 'global' | 'user' | 'project';
  /** 是否仅报告不写入 */
  dryRun?: boolean;
  /** 按名称过滤（支持 fileName / relativePath / title 的子串或精确匹配） */
  filter?: string;
}

/** 扫描集内的单条 spec：附带层级与项目归属 */
interface SpecEntry {
  spec: ParsedSpec;
  level: MigrateSpecLevel;
  projectId: string | null;
  projectName: string | null;
}

/**
 * 批量迁移历史 spec：
 * - 自动补 id（如缺失或非法格式）
 * - 自动刷新 updated（如缺失或文件 mtime 晚于 updated，说明被外部编辑过）
 * - 自动补 title（从首 H1 或文件名 fallback）
 * - **不自动补 description**（仅报告缺失，引导用户手动补）
 */
export async function migrateSpecs(options?: MigrateOptions): Promise<MigrateResult> {
  const scope = options?.scope ?? 'all';
  const dryRun = options?.dryRun ?? false;
  const username = await getUsername();

  const allSpecs: SpecEntry[] = [];

  if (scope === 'all' || scope === 'global') {
    for (const spec of await getGlobalSpecs()) {
      allSpecs.push({ spec, level: 'global', projectId: null, projectName: null });
    }
  }
  if (scope === 'all' || scope === 'user') {
    for (const spec of await getUserSpecs(username)) {
      allSpecs.push({ spec, level: 'user', projectId: null, projectName: null });
    }
  }
  if (scope === 'all' || scope === 'project') {
    // 全量视角：project 级覆盖全部已注册项目（与 lint / suggest-description / export 一致）
    for (const group of await getAllProjectSpecsGrouped(username)) {
      for (const spec of group.specs) {
        allSpecs.push({
          spec,
          level: 'project',
          projectId: group.projectId,
          projectName: group.projectName,
        });
      }
    }
  }

  const result: MigrateResult = {
    migrated: [],
    skipped: [],
    errors: [],
    needsDescription: [],
  };

  const filter = options?.filter?.toLowerCase() ?? null;
  const filteredSpecs = filter
    ? allSpecs.filter(({ spec }) => {
        const name = spec.fileName.replace(/\.md$/i, '').toLowerCase();
        const rel = spec.relativePath.toLowerCase();
        const title = (spec.frontmatter.title ?? '').toLowerCase();
        return (
          name === filter ||
          rel === filter ||
          name.includes(filter) ||
          rel.includes(filter) ||
          title.includes(filter)
        );
      })
    : allSpecs;

  for (const { spec, level, projectId, projectName } of filteredSpecs) {
    try {
      // YAML 语法错误：跳过迁移（writeSpec 会重建 frontmatter，原内容将丢失）
      if (spec.parseError) {
        result.errors.push({
          filePath: spec.filePath,
          level,
          projectId,
          projectName,
          message: `frontmatter YAML 解析失败，已跳过（避免重写丢失原字段）：${formatSpecParseError(spec.parseError)}`,
        });
        continue;
      }

      const fm = spec.frontmatter;
      const addedFields: string[] = [];

      // 检查是否需要迁移
      const needsId = !isValidSpecId(fm.id);
      const needsTitle = !fm.title || (typeof fm.title === 'string' && fm.title.trim() === '');
      const needsDescription =
        !fm.description || (typeof fm.description === 'string' && fm.description.trim() === '');

      // 检测 updated 是否过期：缺失，或文件 mtime 晚于 updated（说明被外部编辑过）
      let needsUpdated = false;
      if (!fm.updated || typeof fm.updated !== 'string') {
        needsUpdated = true;
      } else {
        const updatedMs = Date.parse(fm.updated);
        const mtimeMs = await getFileMtime(spec.filePath);
        if (!isNaN(updatedMs) && mtimeMs !== null && mtimeMs > updatedMs + 1000) {
          needsUpdated = true;
        }
      }

      if (!needsId && !needsTitle && !needsUpdated) {
        // id / title / updated 都正常，不需要迁移（description 只报告）
        if (needsDescription) {
          result.needsDescription.push({ filePath: spec.filePath, level, projectId, projectName });
        }
        result.skipped.push(spec.filePath);
        continue;
      }

      // 需要迁移
      if (needsId) addedFields.push('id');
      if (needsUpdated) addedFields.push('updated');
      if (needsTitle) {
        // 从正文首个 H1 取 title fallback
        const h1Match = spec.content.match(/^#\s+(.+)$/m);
        const fallbackTitle =
          h1Match?.[1]?.trim() || spec.fileName.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
        fm.title = fallbackTitle;
        addedFields.push('title');
      }
      if (needsDescription) {
        result.needsDescription.push({ filePath: spec.filePath, level, projectId, projectName });
      }

      if (!dryRun) {
        // normalizeSpecFrontmatter 会自动补 id 和 updated
        await writeSpec(spec.filePath, fm, spec.content);
      }

      result.migrated.push({ filePath: spec.filePath, level, projectId, projectName, addedFields });
    } catch (e) {
      result.errors.push({
        filePath: spec.filePath,
        level,
        projectId,
        projectName,
        message: (e as Error).message,
      });
    }
  }

  return result;
}
