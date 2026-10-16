/**
 * 项目维度：项目索引构建（含 id 归一化与虚拟合并组）与过滤值匹配。
 *
 * 匹配口径（v2.3 场景模拟落定）：
 * - 非通配值 = 大小写不敏感子串，候选字段 = id / name / 规范化文件夹名 / 包名（**不含本机路径**）
 * - `*` 通配 = glob
 * - 任务项目归属匹配前先归一化：plain（f92c45e0d902f03b）与 legacy:/git:/remote: 前缀、
 *   虚拟合并组物理目录同视一个项目
 */
import { minimatch } from 'minimatch';
import { listProjects, listProjectMetas, getProjectDirNames, normalizeProjectId } from '../project';
import { resolveProjectFolder } from './naming';

export interface ProjectEntry {
  /** 主 id（listProjects 行的 id） */
  id: string;
  name: string;
  /** 规范化文件夹名 */
  folder: string;
  packages: string[];
  /** git remote（normalized 形式；用于项目索引表与本地环境匹配） */
  gitRemotes: string[];
  /** 项目描述（注册/画像元数据） */
  description: string;
  /** 全部 id 变体（含虚拟合并组目录名），小写 */
  idsLower: string[];
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** 构建用户全部逻辑项目的匹配索引（rows ∪ project.json ids ∪ 虚拟合并组目录名） */
export async function buildProjectEntries(username: string): Promise<ProjectEntry[]> {
  const rows = listProjects(username);

  const metaIdsById = new Map<string, string[]>();
  try {
    const metas = await listProjectMetas(username);
    for (const m of metas) {
      const key = m.id ?? '';
      if (key) metaIdsById.set(key, m.ids ?? []);
    }
  } catch {
    // 无项目元数据目录时仅按行数据匹配
  }

  const entries: ProjectEntry[] = [];
  for (const p of rows) {
    const ids = new Set<string>();
    ids.add(p.id);
    ids.add(normalizeProjectId(p.id));
    for (const id of metaIdsById.get(p.id) ?? []) ids.add(id);
    try {
      for (const d of getProjectDirNames(username, normalizeProjectId(p.id))) ids.add(d);
    } catch {
      // DB 不可用时仅按已有 id 匹配
    }
    const packages = [...parseJsonArray(p.package_names), ...parseJsonArray(p.monorepo_packages)];
    entries.push({
      id: p.id,
      name: p.name ?? '',
      folder: resolveProjectFolder({
        id: p.id,
        name: p.name ?? '',
        local_path: p.local_path ?? '[]',
      }),
      packages,
      gitRemotes: parseJsonArray(p.git_remote),
      description: p.description ?? '',
      idsLower: [...ids].map((x) => x.toLowerCase()),
    });
  }
  return entries;
}

/** 过滤值 → 项目匹配（子串 / glob） */
export function projectMatchesValue(entry: ProjectEntry, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  const fields = [entry.id, entry.name, entry.folder, ...entry.packages, ...entry.idsLower];
  if (v.includes('*')) {
    return fields.some((f) => minimatch(f, v, { nocase: true }));
  }
  return fields.some((f) => f.toLowerCase().includes(v));
}

/** 任务项目归属解析：把 task.projects 的 id 变体解析到逻辑项目 id */
export interface ProjectIndex {
  entries: ProjectEntry[];
  byIdLower: Map<string, ProjectEntry>;
  byContent: Map<string, ProjectEntry>;
}

export function buildProjectIndex(entries: ProjectEntry[]): ProjectIndex {
  const byIdLower = new Map<string, ProjectEntry>();
  const byContent = new Map<string, ProjectEntry>();
  for (const e of entries) {
    for (const id of e.idsLower) {
      if (!byIdLower.has(id)) byIdLower.set(id, e);
      const idx = id.indexOf(':');
      const content = idx === -1 ? id : id.slice(idx + 1);
      if (content && !byContent.has(content)) byContent.set(content, e);
    }
  }
  return { entries, byIdLower, byContent };
}

/** 把一组项目 id 引用解析为逻辑项目 id 集合 */
export function resolveProjectRefs(values: string[], index: ProjectIndex): Set<string> {
  const hit = new Set<string>();
  for (const raw of values) {
    const low = raw.toLowerCase();
    const direct =
      index.byIdLower.get(low) ?? index.byIdLower.get(normalizeProjectId(raw).toLowerCase());
    if (direct) {
      hit.add(direct.id);
      continue;
    }
    const idx = low.indexOf(':');
    const content = idx === -1 ? low : low.slice(idx + 1);
    const byContent = index.byContent.get(content);
    if (byContent) hit.add(byContent.id);
  }
  return hit;
}
