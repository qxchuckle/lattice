import type { ParsedSpec } from '../types';
import { writeSpec, normalizeSpecFrontmatter } from './io';
import { isValidSpecId } from './id';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from './cascade';
import { getUsername } from '../config';
import { getProjectSpecDir, getUserSpecDir, getGlobalSpecDir, getFileMtime } from '../paths';

export interface MigrateResult {
  /** 成功 backfill 的 spec */
  migrated: { filePath: string; addedFields: string[] }[];
  /** 跳过的（已经合规） */
  skipped: string[];
  /** 出错的 */
  errors: { filePath: string; message: string }[];
  /** 缺 description 但不自动补（仅报告） */
  needsDescription: string[];
}

export interface MigrateOptions {
  /** 限定 scope（默认 all） */
  scope?: 'all' | 'global' | 'user' | 'project';
  /** 是否仅报告不写入 */
  dryRun?: boolean;
  /** 项目 ID（scope 为 project 时必填） */
  projectId?: string | null;
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
  const projectId = options?.projectId ?? null;

  const allSpecs: ParsedSpec[] = [];

  if (scope === 'all' || scope === 'global') {
    allSpecs.push(...(await getGlobalSpecs()));
  }
  if (scope === 'all' || scope === 'user') {
    allSpecs.push(...(await getUserSpecs(username)));
  }
  if ((scope === 'all' || scope === 'project') && projectId) {
    allSpecs.push(...(await getProjectSpecs(username, projectId)));
  }

  const result: MigrateResult = {
    migrated: [],
    skipped: [],
    errors: [],
    needsDescription: [],
  };

  for (const spec of allSpecs) {
    try {
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
          result.needsDescription.push(spec.filePath);
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
        result.needsDescription.push(spec.filePath);
      }

      if (!dryRun) {
        // normalizeSpecFrontmatter 会自动补 id 和 updated
        await writeSpec(spec.filePath, fm, spec.content);
      }

      result.migrated.push({ filePath: spec.filePath, addedFields });
    } catch (e) {
      result.errors.push({
        filePath: spec.filePath,
        message: (e as Error).message,
      });
    }
  }

  return result;
}
