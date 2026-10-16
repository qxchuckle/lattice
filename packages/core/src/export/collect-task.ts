/**
 * 任务收集、筛选与渲染（digest / prd / full）。
 *
 * - 默认仅 archived；时间窗按 created（YYYY-MM-DD，UTC 日期边界，双端 inclusive）
 * - 项目维度：涉及被排除项目即整条剔除；白名单要求任务关联项目命中
 * - digest = frontmatter + PRD 全文 + 相关规范（导出命中的 referencedSpecs）+ 过程要点（四类 checkpoint）
 */
import { posix } from 'node:path';
import { minimatch } from 'minimatch';
import { stringify as stringifyYaml } from 'yaml';
import type { CheckpointEntry, TaskMeta, TaskStatus } from '../types';
import { listTasks } from '../task';
import { getTaskPrd, getTaskDesign } from '../task';
import { readProgress } from '../task/checkpoint';
import { getTaskProgressPath, readText } from '../paths';
import { taskExportBase } from './naming';
import { resolveProjectRefs, type ProjectIndex } from './projects';
import type { TaskExportDepth } from './types';
import { SPEC_CATALOG_FILE, mdLinkText } from './skill-md';

export interface TaskCandidate {
  meta: TaskMeta;
  user: string;
  /** 解析到逻辑项目 id 的关联项目集合 */
  resolvedProjectIds: Set<string>;
}

export interface RenderedTask {
  user: string;
  meta: TaskMeta;
  /** tasks/<user>__<taskId>.md 或 tasks/<user>__<taskId>/README.md */
  exportPath: string;
  title: string;
  content: string;
  /** full 深度的原样文件 */
  extraFiles: { path: string; content: string }[];
  /** 项目显示名（未注册回退原始 id） */
  displayProjects: string[];
  /** 覆盖到的导出内 spec（供 SKILL.md 统计） */
  linkedSpecIds: string[];
}

interface TaskLoad {
  prd: string;
  checkpoints: CheckpointEntry[];
}

/** digest「过程要点」摘录的 checkpoint 类型 */
const DIGEST_CHECKPOINT_TYPES = new Set(['decision', 'constraint', 'correction', 'pivot']);

export async function collectTaskCandidates(users: string[]): Promise<TaskCandidate[]> {
  const out: TaskCandidate[] = [];
  for (const user of users) {
    let metas: TaskMeta[];
    try {
      metas = await listTasks(user);
    } catch {
      metas = [];
    }
    for (const meta of metas) {
      out.push({ meta, user, resolvedProjectIds: new Set() });
    }
  }
  return out;
}

export interface TaskFilterOptions {
  /** 已归一化的状态集合（undefined = 不过滤） */
  statuses?: TaskStatus[];
  since?: string;
  until?: string;
  tasks?: string[];
  excludeTasks?: string[];
  filters?: string[];
  excludeFilters?: string[];
  excludeUsers?: string[];
  /** 项目白名单命中的逻辑项目 id（按用户） */
  projectIncludeByUser?: Map<string, Set<string>>;
  /** 项目黑名单命中的逻辑项目 id（按用户） */
  projectExcludeByUser?: Map<string, Set<string>>;
}

function taskMatchesValue(meta: TaskMeta, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  const id = meta.id.toLowerCase();
  if (v.includes('*')) return minimatch(id, v, { nocase: true });
  return id.startsWith(v);
}

export async function filterTasks(
  candidates: TaskCandidate[],
  opts: TaskFilterOptions,
  indexFor: (user: string) => ProjectIndex,
): Promise<{ kept: TaskCandidate[]; excluded: number }> {
  const loadCache = new Map<string, TaskLoad>();
  const load = async (c: TaskCandidate): Promise<TaskLoad> => {
    const key = `${c.user}/${c.meta.id}`;
    const cached = loadCache.get(key);
    if (cached) return cached;
    const prd = (await getTaskPrd(c.user, c.meta.id)) ?? '';
    let checkpoints: CheckpointEntry[];
    try {
      const progress = await readProgress(c.user, c.meta.id);
      checkpoints = progress.entries;
    } catch {
      checkpoints = [];
    }
    const loaded = { prd, checkpoints };
    loadCache.set(key, loaded);
    return loaded;
  };

  const kept: TaskCandidate[] = [];
  let excluded = 0;

  for (const c of candidates) {
    let drop = false;

    // 用户黑名单
    if (!drop && opts.excludeUsers?.length && opts.excludeUsers.includes(c.user)) drop = true;

    // 状态
    if (!drop && opts.statuses && !opts.statuses.includes(c.meta.status)) drop = true;

    // 时间窗（created，UTC 日期边界，双端 inclusive）
    if (!drop && (opts.since || opts.until)) {
      const d = (c.meta.created ?? '').slice(0, 10);
      if (opts.since && d < opts.since) drop = true;
      if (opts.until && d > opts.until) drop = true;
    }

    // 精确条目
    if (!drop && opts.tasks?.length && !opts.tasks.some((v) => taskMatchesValue(c.meta, v)))
      drop = true;
    if (
      !drop &&
      opts.excludeTasks?.length &&
      opts.excludeTasks.some((v) => taskMatchesValue(c.meta, v))
    )
      drop = true;

    // 项目维度（连坐：涉及即剔除 / 白名单要求命中；按用户解析。
    // 注意：白名单给出但该用户名下无任何命中时，其任务应全部剔除——不能用空集合跳过判定）
    if (!drop && (opts.projectIncludeByUser?.size || opts.projectExcludeByUser?.size)) {
      c.resolvedProjectIds = resolveProjectRefs(c.meta.projects ?? [], indexFor(c.user));
      const includeGiven = Boolean(opts.projectIncludeByUser?.size);
      const excludeGiven = Boolean(opts.projectExcludeByUser?.size);
      if (includeGiven) {
        const inc = opts.projectIncludeByUser!.get(c.user) ?? new Set<string>();
        if (![...c.resolvedProjectIds].some((id) => inc.has(id))) drop = true;
      }
      if (!drop && excludeGiven) {
        const exc = opts.projectExcludeByUser!.get(c.user) ?? new Set<string>();
        if ([...c.resolvedProjectIds].some((id) => exc.has(id))) drop = true;
      }
    } else {
      c.resolvedProjectIds = resolveProjectRefs(c.meta.projects ?? [], indexFor(c.user));
    }

    // 关键词（title / PRD / checkpoint 消息；召回口径）
    if (!drop && (opts.filters?.length || opts.excludeFilters?.length)) {
      const { prd, checkpoints } = await load(c);
      const haystack = [
        c.meta.title ?? '',
        prd,
        ...checkpoints.map((e) => `${e.title}\n${e.message}`),
      ]
        .join('\n')
        .toLowerCase();
      if (opts.filters?.length && !opts.filters.some((kw) => haystack.includes(kw.toLowerCase())))
        drop = true;
      if (
        !drop &&
        opts.excludeFilters?.length &&
        opts.excludeFilters.some((kw) => haystack.includes(kw.toLowerCase()))
      )
        drop = true;
    }

    if (drop) excluded += 1;
    else kept.push(c);
  }

  return { kept, excluded };
}

// ─── 渲染 ───

function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface SpecLinkIndex {
  /** specId → 导出内 spec 的路径与标题 */
  bySpecId: Map<string, { path: string; title: string }>;
}

function relLink(fromPath: string, toPath: string): string {
  return posix.relative(posix.dirname(fromPath), toPath);
}

/** digest / README 的「相关规范」段（仅列出导出命中的 referencedSpecs；Markdown 链接可点击） */
function buildRelatedSection(
  meta: TaskMeta,
  exportPath: string,
  specIndex: SpecLinkIndex,
): string[] {
  const lines: string[] = [];
  for (const ref of meta.referencedSpecs ?? []) {
    const hit = specIndex.bySpecId.get(ref.id);
    if (!hit) continue;
    const base = hit.path.split('/').pop() ?? hit.path;
    lines.push(`- [${mdLinkText(hit.title || base)}](${relLink(exportPath, hit.path)})`);
  }
  if (lines.length === 0) return [];
  return ['## 相关规范', '', ...lines, ''];
}

/** 三向串联：任务 → 规范目录项目节；无对应项目节时只列名称 */
export interface TaskProjectLinks {
  anchors?: Map<string, string>;
}

function buildProjectsSection(
  displayProjects: string[],
  exportPath: string,
  projectLink?: TaskProjectLinks,
): string[] {
  if (displayProjects.length === 0) return [];
  const lines = displayProjects.map((name) => {
    const anchor = projectLink?.anchors?.get(name);
    if (!anchor) return `- ${name}`;
    return `- [${name}](${relLink(exportPath, `${SPEC_CATALOG_FILE}#${anchor}`)})`;
  });
  return ['## 关联项目', '', ...lines, ''];
}

/** 过程要点：四类 checkpoint，升序，压平单行不截断 */
function buildDigestSection(checkpoints: CheckpointEntry[]): string[] {
  const picked = checkpoints.filter((e) => DIGEST_CHECKPOINT_TYPES.has(e.type));
  if (picked.length === 0) return [];
  const lines = picked.map(
    (e) => `- ${flat(e.title)}（${(e.time ?? '').slice(0, 10)}）：${flat(e.message)}`,
  );
  return ['## 过程要点', '', ...lines, ''];
}

function buildTaskFrontmatter(meta: TaskMeta, displayProjects: string[]): string {
  const fm: Record<string, unknown> = {
    taskId: meta.id,
    title: meta.title ?? '',
    status: meta.status,
  };
  if (displayProjects.length > 0) fm.projects = displayProjects;
  fm.created = (meta.created ?? '').slice(0, 10);
  if (meta.updated) fm.updated = String(meta.updated).slice(0, 10);
  return stringifyYaml(fm, { lineWidth: 0 });
}

/**
 * 渲染单个任务。
 * - digest：frontmatter + PRD + 相关规范 + 过程要点
 * - prd：frontmatter + PRD
 * - full：目录（prd/progress/design 原样 + README.md 生成）
 */
export async function renderTask(
  candidate: TaskCandidate,
  depth: TaskExportDepth,
  specIndex: SpecLinkIndex,
  index: ProjectIndex,
  projectLink?: TaskProjectLinks,
  baseOverride?: string,
): Promise<RenderedTask> {
  const { meta, user } = candidate;
  const base = baseOverride ?? taskExportBase(user, meta.id);
  const title = meta.title ?? meta.id;

  // 项目显示名（未注册回退原始 id）
  const displayProjects: string[] = [];
  for (const ref of meta.projects ?? []) {
    const resolved = resolveProjectRefs([ref], index);
    const entry =
      resolved.size > 0 ? index.entries.find((e) => e.id === [...resolved][0]) : undefined;
    const name = entry?.name && entry.name.trim() ? entry.name : ref;
    if (!displayProjects.includes(name)) displayProjects.push(name);
  }

  const prd = (await getTaskPrd(user, meta.id)) ?? '';
  const frontmatter = buildTaskFrontmatter(meta, displayProjects);

  if (depth === 'full') {
    const exportPath = `tasks/${base}/README.md`;
    const extraFiles: { path: string; content: string }[] = [];

    const prdRaw = await getTaskPrd(user, meta.id);
    if (prdRaw !== null) extraFiles.push({ path: `tasks/${base}/prd.md`, content: prdRaw });

    const progressRaw = await readText(getTaskProgressPath(user, meta.id));
    if (progressRaw !== null)
      extraFiles.push({ path: `tasks/${base}/progress.yaml`, content: progressRaw });

    const designRaw = await getTaskDesign(user, meta.id);
    if (designRaw !== null)
      extraFiles.push({ path: `tasks/${base}/design.md`, content: designRaw });

    const lines: string[] = ['---', frontmatter.trimEnd(), '---', '', `# ${title}`, ''];
    lines.push(
      '本目录为任务原始档案：PRD、过程日志（progress.yaml）、方案讨论（design.md，若有）。',
      '',
    );
    const projectsSec = buildProjectsSection(displayProjects, exportPath, projectLink);
    if (projectsSec.length > 0) lines.push(...projectsSec);
    const related = buildRelatedSection(meta, exportPath, specIndex);
    if (related.length > 0) lines.push(...related);
    const fileLinks = extraFiles.map(
      (f) => `- [${f.path.split('/').pop()}](${f.path.split('/').pop()})`,
    );
    if (fileLinks.length > 0) {
      lines.push('## 本目录文件', '', ...fileLinks, '');
    }
    return {
      user,
      meta,
      exportPath,
      title,
      content: lines.join('\n'),
      extraFiles,
      displayProjects,
      linkedSpecIds: (meta.referencedSpecs ?? [])
        .filter((r) => specIndex.bySpecId.has(r.id))
        .map((r) => r.id),
    };
  }

  const exportPath = `tasks/${base}.md`;
  const lines: string[] = ['---', frontmatter.trimEnd(), '---', ''];
  // PRD 通常自带 `# 标题`（任务目录约定）；已有 H1 时不再重复加标题
  if (!/^#\s/.test(prd.trim())) lines.push(`# ${title}`, '');
  if (prd.trim()) lines.push(prd.trimEnd(), '');

  if (depth === 'digest') {
    const projectsSec = buildProjectsSection(displayProjects, exportPath, projectLink);
    if (projectsSec.length > 0) lines.push(...projectsSec);
    const related = buildRelatedSection(meta, exportPath, specIndex);
    if (related.length > 0) lines.push(...related);
    let checkpoints: CheckpointEntry[];
    try {
      const progress = await readProgress(user, meta.id);
      checkpoints = progress.entries;
    } catch {
      checkpoints = [];
    }
    const digest = buildDigestSection(checkpoints);
    if (digest.length > 0) lines.push(...digest);
  }

  return {
    user,
    meta,
    exportPath,
    title,
    content: lines.join('\n'),
    extraFiles: [],
    displayProjects,
    linkedSpecIds: (meta.referencedSpecs ?? [])
      .filter((r) => specIndex.bySpecId.has(r.id))
      .map((r) => r.id),
  };
}
