/**
 * spec 收集与筛选（原 spec export 领域逻辑迁入，行为保持一致并扩展黑白名单）。
 */
import { minimatch } from 'minimatch';
import type { ParsedSpec } from '../types';
import { listProjects } from '../project';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from '../spec/cascade';
import { exportFileName, resolveProjectFolder } from './naming';
import { parseJsonArray, projectMatchesValue, type ProjectEntry } from './projects';
import type { SpecExportScope } from './types';

export interface CollectedSpec {
  spec: ParsedSpec;
  level: 'global' | 'user' | 'project';
  /** 来源用户（global 级记导出执行用户） */
  user: string;
  /** 项目级：逻辑项目 id */
  projectId?: string;
  /** 项目级：项目文件夹名（未做冲突消解） */
  projectFolder?: string;
  /** 项目级：项目元数据（用于关键词匹配与 SKILL.md 项目信息行） */
  projectMeta?: {
    name: string;
    localPath: string;
    packageNames: string;
    gitRemote: string;
    description: string;
  };
  /** 导出相对路径 */
  exportPath: string;
  /** 最终写入内容 */
  content: string;
  title: string;
}

/** 正文不以一级标题开头时，用 frontmatter title 补齐（保证脱离 frontmatter 后语义完整） */
export function buildSpecExportContent(spec: ParsedSpec): string {
  const content = spec.content.trim();
  if (content.startsWith('# ')) return `${content}\n`;
  const title = spec.frontmatter.title ?? spec.fileName.replace(/\.md$/, '');
  return `# ${title}\n\n${content}\n`;
}

export async function collectSpecs(opts: {
  scope: SpecExportScope[];
  users: string[];
  execUser: string;
}): Promise<{ items: CollectedSpec[]; sourceFileNames: Set<string> }> {
  const { scope, users, execUser } = opts;
  const scopes = scope.length ? scope : ['all'];
  const want = (level: 'global' | 'user' | 'project') =>
    scopes.includes('all') || scopes.includes(level);
  const items: CollectedSpec[] = [];
  const sourceFileNames = new Set<string>();

  // 全局级（机器级共享，仅收集一次，前缀记执行用户）
  if (want('global')) {
    for (const spec of await getGlobalSpecs()) {
      sourceFileNames.add(spec.fileName);
      items.push({
        spec,
        level: 'global',
        user: execUser,
        exportPath: `global/${exportFileName(execUser, spec.relativePath)}`,
        content: buildSpecExportContent(spec),
        title: spec.frontmatter.title ?? spec.fileName.replace(/\.md$/, ''),
      });
    }
  }

  for (const username of users) {
    // 用户级
    if (want('user')) {
      for (const spec of await getUserSpecs(username)) {
        sourceFileNames.add(spec.fileName);
        items.push({
          spec,
          level: 'user',
          user: username,
          exportPath: `user/${exportFileName(username, spec.relativePath)}`,
          content: buildSpecExportContent(spec),
          title: spec.frontmatter.title ?? spec.fileName.replace(/\.md$/, ''),
        });
      }
    }

    // 项目级（按逻辑项目分组，getProjectSpecs 内部聚合虚拟合并组）
    if (want('project')) {
      for (const p of listProjects(username)) {
        const meta = {
          name: p.name ?? '',
          localPath: p.local_path ?? '[]',
          packageNames: p.package_names ?? '',
          gitRemote: p.git_remote ?? '',
          description: p.description ?? '',
        };
        for (const spec of await getProjectSpecs(username, p.id)) {
          sourceFileNames.add(spec.fileName);
          items.push({
            spec,
            level: 'project',
            user: username,
            projectId: p.id,
            projectFolder: resolveProjectFolder({
              id: p.id,
              name: p.name ?? '',
              local_path: p.local_path ?? '[]',
            }),
            projectMeta: meta,
            // projectFolder 后置冲突消解，先占位
            exportPath: '',
            content: buildSpecExportContent(spec),
            title: spec.frontmatter.title ?? spec.fileName.replace(/\.md$/, ''),
          });
        }
      }
    }
  }

  return { items, sourceFileNames };
}

// ─── 筛选 ───

/** 关键词匹配：tags/文件名/标题/description；项目级追加所属项目元数据（含本机路径，召回口径） */
export function specMatchesKeyword(item: CollectedSpec, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  const fm = item.spec.frontmatter;
  if (fm.tags?.some((t) => t.toLowerCase().includes(kw))) return true;
  if (item.spec.fileName.toLowerCase().includes(kw)) return true;
  if (fm.title?.toLowerCase().includes(kw)) return true;
  if (fm.description?.toLowerCase().includes(kw)) return true;
  if (item.projectMeta) {
    if (item.projectMeta.name.toLowerCase().includes(kw)) return true;
    if (item.projectMeta.localPath.toLowerCase().includes(kw)) return true;
    if (parseJsonArray(item.projectMeta.packageNames).some((n) => n.toLowerCase().includes(kw)))
      return true;
  }
  return false;
}

/** 精确条目匹配：spec id / 文件名（无通配 = 前缀匹配；`*` 通配） */
export function specMatchesValue(item: CollectedSpec, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  const id = (item.spec.frontmatter.id ?? '').toLowerCase();
  const base = item.spec.fileName.toLowerCase();
  if (v.includes('*')) {
    return minimatch(id, v, { nocase: true }) || minimatch(base, v, { nocase: true });
  }
  return (id.length > 0 && id.startsWith(v)) || base.startsWith(v);
}

export interface SpecFilterOptions {
  filters?: string[];
  excludeFilters?: string[];
  tags?: string[];
  excludeTags?: string[];
  specs?: string[];
  excludeSpecs?: string[];
  projects?: string[];
  excludeProjects?: string[];
  excludeUsers?: string[];
}

/**
 * 维度筛选：同类 OR、排除优先、异类 AND。
 * 项目白名单只保留项目级（沿原 spec export 语义）；项目黑名单剔除项目级；global 级不受 user 维度影响。
 */
export function applySpecFilters(
  items: CollectedSpec[],
  opts: SpecFilterOptions,
  entryFor: (item: CollectedSpec) => ProjectEntry | undefined,
): CollectedSpec[] {
  return items.filter((item) => {
    if (opts.filters?.length && !opts.filters.some((kw) => specMatchesKeyword(item, kw)))
      return false;
    if (
      opts.excludeFilters?.length &&
      opts.excludeFilters.some((kw) => specMatchesKeyword(item, kw))
    )
      return false;
    if (opts.tags?.length && !opts.tags.some((t) => item.spec.frontmatter.tags?.includes(t)))
      return false;
    if (
      opts.excludeTags?.length &&
      item.spec.frontmatter.tags?.some((t) => opts.excludeTags!.includes(t))
    )
      return false;
    if (opts.specs?.length && !opts.specs.some((v) => specMatchesValue(item, v))) return false;
    if (opts.excludeSpecs?.length && opts.excludeSpecs.some((v) => specMatchesValue(item, v)))
      return false;
    if (opts.projects?.length) {
      if (!item.projectId) return false;
      const entry = entryFor(item);
      if (!entry || !opts.projects.some((v) => projectMatchesValue(entry, v))) return false;
    }
    if (opts.excludeProjects?.length && item.projectId) {
      const entry = entryFor(item);
      if (entry && opts.excludeProjects.some((v) => projectMatchesValue(entry, v))) return false;
    }
    if (
      opts.excludeUsers?.length &&
      item.level !== 'global' &&
      opts.excludeUsers.includes(item.user)
    )
      return false;
    return true;
  });
}
