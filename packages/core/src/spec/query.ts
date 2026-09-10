import type { ParsedSpec } from '../types';
import { parseSpec } from './io';
import {
  getGlobalSpecs,
  getUserSpecs,
  getProjectSpecs,
  getAllProjectSpecsGrouped,
} from './cascade';

export interface SpecMatch {
  scope: 'project' | 'user' | 'global' | 'direct';
  spec: ParsedSpec;
}

/** 按 spec ID 查找的命中结果（project 级携带归属项目，供跨项目引用精确定位） */
export interface SpecByIdMatch {
  scope: 'project' | 'user' | 'global';
  spec: ParsedSpec;
  /** project 级命中时的归属项目 ID */
  projectId?: string;
  /** project 级命中时的归属项目名 */
  projectName?: string;
}

export interface FindSpecOptions {
  /** 限定查找的层级 */
  scope?: 'project' | 'user' | 'global';
}

/**
 * 按文件名、相对路径或标题在多层级中查找 spec。
 *
 * 匹配策略（按优先级）：
 * 1. 绝对路径直接解析 → scope='direct'
 * 2. 精确匹配：relativePath / fileName 完全相等
 * 3. Glob 匹配（输入含 `*` `?` `[` 时）：对 relativePath / fileName / title 做 glob
 * 4. 模糊匹配（无 glob 字符时）：对 relativePath / fileName / title 做大小写不敏感子串匹配
 *
 * 返回所有匹配，按层级优先级排列：project > user > global。
 */
export async function findSpecByName(
  username: string,
  projectId: string | null,
  input: string,
  opts?: FindSpecOptions,
): Promise<SpecMatch[]> {
  // 尝试作为完整路径直接解析
  const directSpec = await parseSpec(input);
  if (directSpec) {
    return [{ scope: 'direct', spec: directSpec }];
  }

  // 收集各层级 specs
  const levels = await collectLevels(username, projectId, opts);

  // Phase 1: 精确匹配（relativePath / fileName）
  const exact: SpecMatch[] = [];
  for (const level of levels) {
    const match = level.specs.find((s) => s.relativePath === input || s.fileName === input);
    if (match) {
      exact.push({ scope: level.scope, spec: match });
    }
  }
  if (exact.length > 0) return exact;

  // Phase 2: Glob / 模糊匹配
  const isGlob = /[*?]/.test(input) || input.includes('[');

  if (isGlob) {
    return matchByGlob(levels, input);
  }
  return matchByFuzzy(levels, input);
}

/**
 * 按 spec ID（frontmatter.id）查找 spec —— ref-spec 推荐入口。
 *
 * 与 findSpecByName 的关键差异：ID 全局唯一，故搜索覆盖 global + user + **全部已注册项目**
 * 的项目级 spec（经 getAllProjectSpecsGrouped 归组聚合，携带项目归属），
 * 从而支持关联任意项目（含跨项目）的项目级 spec，不受 cwd 项目限制。
 *
 * 搜索顺序：global → user → 全部项目，命中即返回（ID 唯一，短路避免不必要的全项目扫描）。
 * 异常多命中（同一 ID 被跨项目复制）时，优先返回 preferProjectId 对应项，其次首个。
 */
export async function findSpecById(
  username: string,
  specId: string,
  opts?: { preferProjectId?: string | null },
): Promise<SpecByIdMatch | null> {
  for (const s of await getGlobalSpecs()) {
    if (s.frontmatter.id === specId) return { scope: 'global', spec: s };
  }
  for (const s of await getUserSpecs(username)) {
    if (s.frontmatter.id === specId) return { scope: 'user', spec: s };
  }

  const groups = await getAllProjectSpecsGrouped(username);
  const projectMatches: SpecByIdMatch[] = [];
  for (const g of groups) {
    for (const s of g.specs) {
      if (s.frontmatter.id === specId) {
        projectMatches.push({
          scope: 'project',
          spec: s,
          projectId: g.projectId,
          projectName: g.projectName,
        });
      }
    }
  }
  if (projectMatches.length === 0) return null;
  if (projectMatches.length === 1) return projectMatches[0];

  const preferred = opts?.preferProjectId
    ? projectMatches.find((m) => m.projectId === opts.preferProjectId)
    : undefined;
  return preferred ?? projectMatches[0];
}

// ─── 内部辅助 ───

interface LevelEntry {
  scope: 'project' | 'user' | 'global';
  specs: ParsedSpec[];
}

async function collectLevels(
  username: string,
  projectId: string | null,
  opts?: FindSpecOptions,
): Promise<LevelEntry[]> {
  const levels: LevelEntry[] = [];
  if ((!opts?.scope || opts.scope === 'project') && projectId) {
    levels.push({ scope: 'project', specs: await getProjectSpecs(username, projectId) });
  }
  if (!opts?.scope || opts.scope === 'user') {
    levels.push({ scope: 'user', specs: await getUserSpecs(username) });
  }
  if (!opts?.scope || opts.scope === 'global') {
    levels.push({ scope: 'global', specs: await getGlobalSpecs() });
  }
  return levels;
}

/** Glob 匹配：对 relativePath / fileName / title 执行 glob */
function matchByGlob(levels: LevelEntry[], pattern: string): SpecMatch[] {
  const re = globToRegex(pattern);
  const matches: SpecMatch[] = [];

  for (const level of levels) {
    for (const s of level.specs) {
      const relNoExt = stripMd(s.relativePath);
      const fnNoExt = stripMd(s.fileName);
      const title = s.frontmatter.title ?? '';

      if (
        re.test(s.relativePath) ||
        re.test(s.fileName) ||
        re.test(relNoExt) ||
        re.test(fnNoExt) ||
        re.test(title)
      ) {
        matches.push({ scope: level.scope, spec: s });
      }
    }
  }
  return matches;
}

/** 模糊匹配：大小写不敏感子串 + 去 .md 后缀 + 标题匹配 */
function matchByFuzzy(levels: LevelEntry[], input: string): SpecMatch[] {
  const needle = input.toLowerCase().replace(/\.md$/i, '');
  const matches: SpecMatch[] = [];

  for (const level of levels) {
    for (const s of level.specs) {
      const relNoExt = stripMd(s.relativePath).toLowerCase();
      const fnNoExt = stripMd(s.fileName).toLowerCase();
      const title = (s.frontmatter.title ?? '').toLowerCase();

      if (relNoExt.includes(needle) || fnNoExt.includes(needle) || title.includes(needle)) {
        matches.push({ scope: level.scope, spec: s });
      }
    }
  }
  return matches;
}

/** 去 .md 后缀 */
function stripMd(name: string): string {
  return name.replace(/\.md$/i, '');
}

/**
 * 将简易 glob 模式转为正则（支持 `*` `?` `[...]`）。
 * 大小写不敏感。
 */
function globToRegex(glob: string): RegExp {
  let re = '';
  let inBracket = false;
  for (const ch of glob) {
    if (inBracket) {
      re += ch === ']' ? ((inBracket = false), ']') : ch;
      continue;
    }
    switch (ch) {
      case '*':
        re += '.*';
        break;
      case '?':
        re += '.';
        break;
      case '[':
        re += '[';
        inBracket = true;
        break;
      case '.':
        re += '\\.';
        break;
      default:
        re += ch.replace(/[{}()+^$|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}
