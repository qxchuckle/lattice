/**
 * spec 导出：把三级 spec（global/user/project）导出为标准 Agent Skills 目录结构。
 *
 * 产物：SKILL.md（入口）+ manifest.yaml（hash 清单）+ global/ + user/ + <项目名>/ 一层平铺。
 * 详见任务 2026-08-18-8faa design.md / prd.md。
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ParsedSpec } from '../types';
import { nowISO } from '../utils/time';
import { listProjects } from '../project';
import { listAllUsernames } from '../project/cross-user';
import {
  getCacheDir,
  ensureDir,
  writeText,
  readText,
  dirExists,
  removeDir,
  listDir,
  listUserDirs,
  join as pathJoin,
  toKebabCase,
} from '../paths';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from './cascade';

// ─── 类型 ───

export type SpecExportScope = 'global' | 'user' | 'project' | 'all';

export interface SpecExportOptions {
  /** 关键词筛选（可多个，任一命中即通过）：tags/文件名/标题/description；项目级含所属项目元数据 */
  filters?: string[];
  /** 精确 tag 筛选（可多个，任一命中即通过） */
  tags?: string[];
  /** 指定项目 id 或 name（可多个） */
  projects?: string[];
  /** 层级过滤，默认 all */
  scope?: SpecExportScope;
  /** 导出用户（可多个）；'all' 表示全部用户；缺省由调用方决定（CLI 传当前用户） */
  users?: string[];
  /** skill 名（SKILL.md frontmatter name），默认 lattice-specs */
  skillName?: string;
  /** 覆盖自动生成的 description */
  description?: string;
  /** 输出目录，默认 ~/.lattice/.cache/export-spec/<skill名>/ */
  outputDir?: string;
  /** 清空重导（仅限含本工具 manifest.yaml 的目录） */
  clean?: boolean;
}

export interface SpecExportSource {
  level: 'global' | 'user' | 'project';
  user: string;
  specId?: string;
  updated?: string;
  projectId?: string;
}

export interface SpecExportFileEntry {
  path: string;
  hash: string;
  title: string;
  source: SpecExportSource;
  /** 生成文件标记（如 SKILL.md，非源 spec） */
  generated?: boolean;
}

export interface SpecExportManifest {
  exportedAt: string;
  tool: 'lattice-spec-export';
  version: 1;
  name: string;
  stats: { global: number; user: number; project: number };
  files: SpecExportFileEntry[];
}

export type SpecExportWarningType = 'local-path' | 'ltc-ref' | 'dangling-ref' | 'sensitive';

export interface SpecExportWarning {
  file: string;
  type: SpecExportWarningType;
  message: string;
}

export interface SpecExportResult {
  outputDir: string;
  manifest: SpecExportManifest;
  /** 本次写入的文件（新增或内容变更） */
  written: string[];
  /** hash 未变而跳过写入的文件 */
  skipped: string[];
  warnings: SpecExportWarning[];
  /** 缺 description 的导出文件（目录选读依据缺失，建议补齐后重导）；specId 供直接 ref-spec/set */
  missingDescriptions: { path: string; specId?: string }[];
}

export interface SpecExportVerifyIssue {
  path: string;
  type: 'hash-mismatch' | 'missing' | 'extra';
  message: string;
}

export interface SpecExportVerifyResult {
  dir: string;
  ok: boolean;
  checked: number;
  issues: SpecExportVerifyIssue[];
}

export const SPEC_EXPORT_TOOL = 'lattice-spec-export' as const;
export const SPEC_EXPORT_MANIFEST = 'manifest.yaml';
export const SPEC_EXPORT_DEFAULT_NAME = 'lattice-specs';

// ─── 内部结构 ───

interface CollectedSpec {
  spec: ParsedSpec;
  level: 'global' | 'user' | 'project';
  /** 来源用户（global 级记导出执行用户） */
  user: string;
  /** 项目级：逻辑项目 id */
  projectId?: string;
  /** 项目级：项目文件夹名（未做冲突消解） */
  projectFolder?: string;
  /** 项目级：项目元数据（用于 --filter 扩展匹配与 SKILL.md 项目信息） */
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

/** Windows 保留名 */
const WINDOWS_RESERVED = /^(con|nul|aux|prn|com\d|lpt\d)$/i;

/** 规范化为安全目录名：@scope/pkg → scope-pkg，全大写缩写词不粘连，非法字符移除，Windows 保留名加后缀 */
function toSafeDirName(raw: string): string {
  let name = toKebabCase(
    raw
      .replace(/^@/, '')
      .replace(/\//g, '-')
      // 全大写缩写词与后续驼峰分段：HBOSSection → HBOS-Section（toKebabCase 只处理小写→大写边界）
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2'),
  );
  if (!name) name = 'project';
  if (WINDOWS_RESERVED.test(name)) name = `${name}-dir`;
  return name;
}

/** 项目文件夹名兜底链：name → mainPath basename → id */
function resolveProjectFolder(p: { id: string; name: string; local_path: string }): string {
  let candidate = p.name;
  if (!candidate) {
    try {
      const paths: string[] = JSON.parse(p.local_path || '[]');
      const first = paths[0];
      if (first) candidate = first.split('/').pop() ?? '';
    } catch {
      // local_path 非法 JSON 时走 id 兜底
    }
  }
  if (!candidate) candidate = p.id;
  return toSafeDirName(candidate);
}

/** 短 ID：取冒号后前 8 位（git:dbd5070e... → dbd5070e） */
function shortProjectId(id: string): string {
  const tail = id.includes(':') ? id.split(':').slice(1).join(':') : id;
  return (tail || id).slice(0, 8);
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf-8').digest('hex')}`;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ─── 收集 ───

function buildExportContent(spec: ParsedSpec): string {
  const content = spec.content.trim();
  // 正文不以一级标题开头时，用 frontmatter title 补齐（保证脱离 frontmatter 后语义完整）
  if (content.startsWith('# ')) return `${content}\n`;
  const title = spec.frontmatter.title ?? spec.fileName.replace(/\.md$/, '');
  return `# ${title}\n\n${content}\n`;
}

function exportFileName(userName: string, relativePath: string): string {
  // relativePath 可能含子目录，前缀只加在 basename 上
  const parts = relativePath.split('/');
  const base = parts.pop() ?? '';
  return [...parts, `${userName}__${base}`].join('/');
}

async function collectSpecs(
  options: SpecExportOptions,
  execUser: string,
): Promise<{ items: CollectedSpec[]; sourceFileNames: Set<string> }> {
  const scope = options.scope ?? 'all';
  const users = options.users ?? [execUser];
  const items: CollectedSpec[] = [];
  const sourceFileNames = new Set<string>();

  // 全局级（机器级共享，仅收集一次，前缀记执行用户）
  if (scope === 'all' || scope === 'global') {
    for (const spec of await getGlobalSpecs()) {
      sourceFileNames.add(spec.fileName);
      items.push({
        spec,
        level: 'global',
        user: execUser,
        exportPath: `global/${exportFileName(execUser, spec.relativePath)}`,
        content: buildExportContent(spec),
        title: spec.frontmatter.title ?? spec.fileName.replace(/\.md$/, ''),
      });
    }
  }

  for (const username of users) {
    // 用户级
    if (scope === 'all' || scope === 'user') {
      for (const spec of await getUserSpecs(username)) {
        sourceFileNames.add(spec.fileName);
        items.push({
          spec,
          level: 'user',
          user: username,
          exportPath: `user/${exportFileName(username, spec.relativePath)}`,
          content: buildExportContent(spec),
          title: spec.frontmatter.title ?? spec.fileName.replace(/\.md$/, ''),
        });
      }
    }

    // 项目级（按逻辑项目分组，getProjectSpecs 内部聚合虚拟合并组）
    if (scope === 'all' || scope === 'project') {
      for (const p of listProjects(username)) {
        const meta = {
          name: p.name,
          localPath: p.local_path,
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
              name: p.name,
              local_path: p.local_path,
            }),
            projectMeta: meta,
            // projectFolder 后置冲突消解，先占位
            exportPath: '',
            content: buildExportContent(spec),
            title: spec.frontmatter.title ?? spec.fileName.replace(/\.md$/, ''),
          });
        }
      }
    }
  }

  return { items, sourceFileNames };
}

// ─── 筛选 ───

function matchesFilter(item: CollectedSpec, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  const fm = item.spec.frontmatter;
  if (fm.tags?.some((t) => t.toLowerCase().includes(kw))) return true;
  if (item.spec.fileName.toLowerCase().includes(kw)) return true;
  if (fm.title?.toLowerCase().includes(kw)) return true;
  if (fm.description?.toLowerCase().includes(kw)) return true;
  // 项目级追加所属项目元数据命中
  if (item.projectMeta) {
    if (item.projectMeta.name.toLowerCase().includes(kw)) return true;
    if (item.projectMeta.localPath.toLowerCase().includes(kw)) return true;
    if (parseJsonArray(item.projectMeta.packageNames).some((n) => n.toLowerCase().includes(kw)))
      return true;
  }
  return false;
}

function projectSelected(item: CollectedSpec, projects: string[]): boolean {
  if (!item.projectId) return false;
  return projects.some((v) => {
    if (v === item.projectId) return true;
    if (item.projectMeta?.name === v) return true;
    if (toSafeDirName(item.projectMeta?.name ?? '') === toSafeDirName(v)) return true;
    return false;
  });
}

function applyFilters(items: CollectedSpec[], options: SpecExportOptions): CollectedSpec[] {
  return items.filter((item) => {
    if (options.filters?.length && !options.filters.some((kw) => matchesFilter(item, kw))) {
      return false;
    }
    if (
      options.tags?.length &&
      !options.tags.some((t) => item.spec.frontmatter.tags?.includes(t))
    ) {
      return false;
    }
    if (options.projects?.length && !projectSelected(item, options.projects)) return false;
    return true;
  });
}

// ─── 守卫检测 ───

function detectWarnings(items: CollectedSpec[], sourceFileNames: Set<string>): SpecExportWarning[] {
  const warnings: SpecExportWarning[] = [];
  const exportedFileNames = new Set(items.map((i) => i.spec.fileName));

  for (const item of items) {
    const content = item.content;
    if (/\/Users\/[^/\s"')]+/.test(content)) {
      warnings.push({
        file: item.exportPath,
        type: 'local-path',
        message: '正文含本机绝对路径（/Users/...），分发前建议改为相对描述',
      });
    }
    if (content.includes('~/.lattice')) {
      warnings.push({
        file: item.exportPath,
        type: 'local-path',
        message: '正文含 ~/.lattice 路径引用，外部使用者无法解析',
      });
    }
    if (/(^|[^a-zA-Z])ltc\s+\w/.test(content)) {
      warnings.push({
        file: item.exportPath,
        type: 'ltc-ref',
        message: '正文含 ltc 命令引用，外部使用者无 lattice 环境',
      });
    }
    // 敏感信息：赋值形态（key: value / key=value），外发前必须人工确认
    if (
      /(password|passwd|token|secret|api[_-]?key|apikey|authorization|bearer)\s*[:=]\s*["']?\S{4,}/i.test(
        content,
      )
    ) {
      warnings.push({
        file: item.exportPath,
        type: 'sensitive',
        message: '正文疑似含敏感信息（密钥/token 赋值形态），分发前必须人工确认',
      });
    }
    // 悬空引用：引用了源库中存在但未导出的 spec 文件名
    const refs = content.match(/[\w.-]+\.md/g) ?? [];
    for (const ref of refs) {
      if (sourceFileNames.has(ref) && !exportedFileNames.has(ref)) {
        warnings.push({
          file: item.exportPath,
          type: 'dangling-ref',
          message: `引用了未导出的 spec 文件：${ref}`,
        });
      }
    }
  }
  return warnings;
}

// ─── SKILL.md 生成 ───

function buildAutoDescription(items: CollectedSpec[]): string {
  const total = items.length;
  if (total === 0) return 'Lattice spec 导出知识库（当前筛选条件下为空）。';
  const tagCount = new Map<string, number>();
  for (const i of items) {
    for (const t of i.spec.frontmatter.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  }
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);
  const topic = topTags.length ? `，主题：${topTags.join('、')}` : '';
  return `Lattice spec 导出知识库（${total} 份${topic}）。相关开发任务时查阅。`;
}

function truncate(text: string, max = 100): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** 目录行：链接文本只留 basename（section 上下文已限定目录），省 token */
function tocLine(i: CollectedSpec): string {
  const base = i.exportPath.split('/').pop() ?? i.exportPath;
  return `- [${base}](${i.exportPath}) — ${i.title}${descSuffix(i)}`;
}

function buildSkillMd(
  options: SpecExportOptions,
  items: CollectedSpec[],
  folderOf: (item: CollectedSpec) => string,
  envHints: { ltc: boolean; localPath: boolean },
): string {
  const name = options.skillName ?? SPEC_EXPORT_DEFAULT_NAME;
  const description = options.description ?? buildAutoDescription(items);
  const stats = countByLevel(items);

  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${description.replace(/\n/g, ' ')}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${name}`);
  lines.push('');
  lines.push(
    `Lattice spec 导出知识库（${items.length} 份：global ${stats.global} · user ${stats.user} · project ${stats.project}）。`,
  );
  lines.push('');

  // 目录：用户级 → 项目级（按项目分小节）→ 全局级（确定性排序）
  const byLevel: Record<string, CollectedSpec[]> = { user: [], project: [], global: [] };
  for (const i of items) byLevel[i.level].push(i);

  // 三级 section 标题始终输出（空层级内容标「无」）；展示顺序 global → user → project（从远到近，与覆盖优先级呼应）
  const sections: string[] = [];
  if (byLevel.global.length) {
    const sec: string[] = ['## 全局级规范'];
    for (const i of byLevel.global.sort((a, b) => a.exportPath.localeCompare(b.exportPath))) {
      sec.push(tocLine(i));
    }
    sections.push(sec.join('\n'));
  } else {
    sections.push('## 全局级规范\n\n无');
  }
  if (byLevel.user.length) {
    const byUser = new Map<string, CollectedSpec[]>();
    for (const i of byLevel.user) {
      if (!byUser.has(i.user)) byUser.set(i.user, []);
      byUser.get(i.user)!.push(i);
    }
    const sec: string[] = ['## 用户级规范'];
    for (const username of [...byUser.keys()].sort()) {
      sec.push('');
      sec.push(`### ${username}`);
      sec.push('');
      for (const i of byUser
        .get(username)!
        .sort((a, b) => a.exportPath.localeCompare(b.exportPath))) {
        sec.push(tocLine(i));
      }
    }
    sections.push(sec.join('\n'));
  } else {
    sections.push('## 用户级规范\n\n无');
  }
  if (byLevel.project.length) {
    const byFolder = new Map<string, CollectedSpec[]>();
    const metaByFolder = new Map<string, NonNullable<CollectedSpec['projectMeta']>>();
    for (const i of byLevel.project) {
      const f = folderOf(i);
      if (!byFolder.has(f)) {
        byFolder.set(f, []);
        if (i.projectMeta) metaByFolder.set(f, i.projectMeta);
      }
      byFolder.get(f)!.push(i);
    }
    // 同名项目标题撞车时附文件夹名区分
    const nameCount = new Map<string, number>();
    for (const meta of metaByFolder.values()) {
      nameCount.set(meta.name, (nameCount.get(meta.name) ?? 0) + 1);
    }
    const sec: string[] = ['## 项目级规范'];
    for (const folder of [...byFolder.keys()].sort()) {
      const group = byFolder.get(folder)!;
      const meta = metaByFolder.get(folder);
      const projectTitle =
        meta && (nameCount.get(meta.name) ?? 0) > 1
          ? `${meta.name}（${folder}）`
          : (meta?.name ?? folder);
      sec.push('');
      sec.push(`### ${projectTitle}`);
      sec.push('');
      // 项目匹配信息：外部 agent 凭包名/git/路径对上项目
      const info = buildProjectInfoLine(meta);
      if (info) {
        sec.push(info);
        sec.push('');
      }
      for (const i of group.sort((a, b) => a.exportPath.localeCompare(b.exportPath))) {
        sec.push(tocLine(i));
      }
    }
    sections.push(sec.join('\n'));
  } else {
    sections.push('## 项目级规范\n\n无');
  }

  // 层级语义前置：读目录前先理解三层覆盖规则与用户前缀语义
  lines.push('## 层级语义');
  lines.push('');
  lines.push(
    '- project > user > global（同相对路径近覆盖远）；多用户同名 spec 靠文件名 `<user>__` 前缀区分',
  );
  lines.push('');
  // 使用注意（仅生成命中项）：原作者环境引用不改写正文，引导使用方 AI 灵活处理
  const notes: string[] = [];
  if (envHints.localPath) {
    notes.push(
      '- 文档中 `~/.lattice/...` 与 `/Users/...` 为原作者本机路径：查找当前环境实际对应路径后再使用',
    );
  }
  if (envHints.ltc) {
    notes.push(
      '- 文档中 `ltc <命令>` 为原作者的 Lattice CLI 调用，当前环境无此工具：按流程语义理解，灵活查找等效方式；按某 spec 执行遇到无法使用的命令时，显式说明并跳过该步骤',
    );
  }
  if (notes.length) {
    lines.push('## 使用注意');
    lines.push('');
    lines.push(...notes);
    lines.push('');
  }
  lines.push(sections.join('\n\n'));
  lines.push('');
  return lines.join('\n');
}

function descSuffix(i: CollectedSpec): string {
  const d = i.spec.frontmatter.description;
  // description 是 AI 目录选读的核心依据，不截断；仅压平换行保证单行
  return d ? `：${d.replace(/\s+/g, ' ').trim()}` : '';
}

/** 生成项目匹配信息行：外部 agent 凭包名/git remote 对上项目（本机路径对他人无意义，不含） */
function buildProjectInfoLine(
  meta:
    | {
        name: string;
        localPath: string;
        packageNames: string;
        gitRemote: string;
        description: string;
      }
    | undefined,
): string {
  if (!meta) return '';
  const parts: string[] = [];
  const pkgs = parseJsonArray(meta.packageNames);
  if (pkgs.length) parts.push(`包：${pkgs.join('、')}`);
  const remotes = parseJsonArray(meta.gitRemote);
  if (remotes.length) parts.push(`git：${remotes.join('、')}`);
  if (meta.description) parts.push(`描述：${truncate(meta.description, 80)}`);
  return parts.length ? parts.join(' · ') : '';
}

function countByLevel(items: CollectedSpec[]): { global: number; user: number; project: number } {
  const stats = { global: 0, user: 0, project: 0 };
  for (const i of items) stats[i.level] += 1;
  return stats;
}

// ─── 幂等与清理 ───

async function readManifest(dir: string): Promise<SpecExportManifest | null> {
  const raw = await readText(join(dir, SPEC_EXPORT_MANIFEST));
  if (!raw) return null;
  try {
    const m = parseYaml(raw) as SpecExportManifest;
    if (m?.tool !== SPEC_EXPORT_TOOL) return null;
    return m;
  } catch {
    return null;
  }
}

// ─── 主流程 ───

/**
 * 导出 spec 为标准 skill 目录结构。
 *
 * 幂等：重复导出按 manifest hash 对比，仅重写变更文件；覆盖同名+新增、不删除。
 * clean：仅当目标目录存在本工具 manifest 时允许清空重建。
 */
export async function exportSpecs(
  options: SpecExportOptions & { execUser?: string },
): Promise<SpecExportResult> {
  const execUser = options.execUser ?? options.users?.[0] ?? 'default';
  const skillName = options.skillName ?? SPEC_EXPORT_DEFAULT_NAME;
  // export-spec/ 为公共文件夹：未指定输出目录时按 skill 名分子目录，多次不同名导出互不覆盖
  const outputDir = options.outputDir ?? join(getCacheDir(), 'export-spec', skillName);

  // 用户解析：'all' → 全部用户（DB 项目表 ∪ 文件系统用户目录，避免无项目注册的用户被漏）
  let users = options.users ?? [execUser];
  if (users.includes('all')) {
    const dbUsers = await listAllUsernames().catch(() => [] as string[]);
    const fsUsers = await listUserDirs();
    users = [...new Set([...dbUsers, ...fsUsers])].sort();
  }

  // clean 守卫
  if (options.clean && (await dirExists(outputDir))) {
    const manifest = await readManifest(outputDir);
    const entries = await listDir(outputDir);
    if (!manifest && entries.length > 0) {
      throw new Error(
        `目标目录非空且不含本工具 ${SPEC_EXPORT_MANIFEST}，拒绝 --clean（防误删）。目录：${outputDir}`,
      );
    }
    await removeDir(outputDir);
  }

  // 收集 + 筛选
  const { items: allItems, sourceFileNames } = await collectSpecs({ ...options, users }, execUser);
  const items = applyFilters(allItems, options);
  if (items.length === 0) {
    throw new Error('筛选条件下无匹配 spec，未导出任何内容。');
  }

  // 项目文件夹冲突消解（同名不同逻辑项目 → 追加短 ID）
  const folderByProject = new Map<string, string>();
  const usedFolders = new Set<string>(['global', 'user']);
  const folderOf = (item: CollectedSpec): string => {
    if (!item.projectId || !item.projectFolder) return item.level;
    const cached = folderByProject.get(item.projectId);
    if (cached) return cached;
    let folder = item.projectFolder;
    if (usedFolders.has(folder.toLowerCase()))
      folder = `${folder}-${shortProjectId(item.projectId)}`;
    usedFolders.add(folder.toLowerCase());
    folderByProject.set(item.projectId, folder);
    return folder;
  };
  for (const i of items) {
    if (i.level === 'project')
      i.exportPath = `${folderOf(i)}/${exportFileName(i.user, i.spec.relativePath)}`;
  }

  // 守卫检测
  const warnings = detectWarnings(items, sourceFileNames);

  // 生成内容 + manifest
  const stats = countByLevel(items);
  // 环境依赖存在性 → SKILL.md「使用注意」段条件生成（不改写正文，引导使用方 AI）
  const envHints = {
    ltc: warnings.some((w) => w.type === 'ltc-ref'),
    localPath: warnings.some((w) => w.type === 'local-path'),
  };
  const skillMd = buildSkillMd({ ...options, skillName }, items, folderOf, envHints);
  const manifest: SpecExportManifest = {
    exportedAt: nowISO(),
    tool: SPEC_EXPORT_TOOL,
    version: 1,
    name: skillName,
    stats,
    files: [],
  };

  const outputs = new Map<string, string>();
  outputs.set('SKILL.md', skillMd);
  for (const i of items) outputs.set(i.exportPath, i.content);

  // 幂等对比
  const oldManifest = await readManifest(outputDir);
  const oldHashes = new Map(oldManifest?.files.map((f) => [f.path, f.hash]) ?? []);

  const written: string[] = [];
  const skipped: string[] = [];
  await ensureDir(outputDir);
  for (const [relPath, content] of [...outputs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const hash = sha256(content);
    if (oldHashes.get(relPath) === hash) {
      skipped.push(relPath);
    } else {
      await writeText(join(outputDir, relPath), content);
      written.push(relPath);
    }

    if (relPath === 'SKILL.md') {
      manifest.files.push({
        path: relPath,
        hash,
        title: skillName,
        source: { level: 'user', user: execUser },
        generated: true,
      });
    } else {
      const item = items.find((i) => i.exportPath === relPath)!;
      manifest.files.push({
        path: relPath,
        hash,
        title: item.title,
        source: {
          level: item.level,
          user: item.user,
          specId: item.spec.frontmatter.id,
          updated: item.spec.frontmatter.updated,
          projectId: item.projectId,
        },
      });
    }
  }

  // manifest 自身总是重写（exportedAt 变化）
  await writeText(
    join(outputDir, SPEC_EXPORT_MANIFEST),
    stringifyYaml(manifest, { lineWidth: 120 }),
  );

  // 缺 description 清单（目录选读依据缺失）
  const missingDescriptions = items
    .filter((i) => !i.spec.frontmatter.description?.trim())
    .map((i) => ({ path: i.exportPath, specId: i.spec.frontmatter.id }));

  return { outputDir, manifest, written, skipped, warnings, missingDescriptions };
}

// ─── 校验 ───

/** 校验导出目录与 manifest.yaml 的一致性（不导出、不写盘） */
export async function verifySpecExport(dir: string): Promise<SpecExportVerifyResult> {
  const manifest = await readManifest(dir);
  if (!manifest) {
    throw new Error(`目录不含有效的 ${SPEC_EXPORT_MANIFEST}：${dir}`);
  }

  const issues: SpecExportVerifyIssue[] = [];
  const manifestPaths = new Set(manifest.files.map((f) => f.path));

  for (const entry of manifest.files) {
    const raw = await readText(join(dir, entry.path));
    if (raw === null) {
      issues.push({ path: entry.path, type: 'missing', message: '文件缺失' });
      continue;
    }
    const actual = sha256(raw);
    if (actual !== entry.hash) {
      issues.push({
        path: entry.path,
        type: 'hash-mismatch',
        message: 'hash 不一致（文件被修改）',
      });
    }
  }

  // 目录中存在但 manifest 未记录的文件
  for (const relPath of await listDirRecursive(dir)) {
    if (!manifestPaths.has(relPath)) {
      issues.push({ path: relPath, type: 'extra', message: 'manifest 未记录的多余文件' });
    }
  }

  return { dir, ok: issues.length === 0, checked: manifest.files.length, issues };
}

async function listDirRecursive(root: string, prefix = ''): Promise<string[]> {
  const results: string[] = [];
  const entries = await listDir(pathJoin(root, prefix));
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (entry === SPEC_EXPORT_MANIFEST) continue;
    // SKILL.md 在 manifest 内；目录递归展开
    const sub = await listDir(pathJoin(root, rel));
    if (sub.length > 0) {
      results.push(...(await listDirRecursive(root, rel)));
    } else {
      results.push(rel);
    }
  }
  return results;
}
