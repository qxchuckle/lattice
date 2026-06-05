import type { ParsedSpec } from '../types';
import { parseSpec } from './io';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from './cascade';

export interface SpecMatch {
  scope: 'project' | 'user' | 'global' | 'direct';
  spec: ParsedSpec;
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
