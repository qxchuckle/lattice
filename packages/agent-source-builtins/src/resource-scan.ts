/**
 * 产品约定目录资源扫描（源层私有工具）
 *
 * md + frontmatter 扫描：commands（递归，名称=相对路径）/ agents / skills（SKILL.md 目录）/ rules。
 * 供 QoderSource 等以目录约定发现资源的源复用；不属于 protocol（非跨层）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type {
  SourceResourceInfo,
  SourceResourceQuery,
  SourceResourceKind,
} from '@qcqx/lattice-agent-protocol';

type Scope = NonNullable<SourceResourceInfo['scope']>;

/** 按 query.kinds 过滤（缺省全部） */
export function filterKinds(
  resources: SourceResourceInfo[],
  kinds?: SourceResourceQuery['kinds'],
): SourceResourceInfo[] {
  return kinds?.length ? resources.filter((r) => kinds.includes(r.kind)) : resources;
}

/** 最小 frontmatter 解析：只取顶层 `key: value` 字符串对（够用即可，不引依赖） */
export function parseFrontmatterAttrs(text: string): Record<string, string> {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const attrs: Record<string, string> = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = /^([A-Za-z][\w-]*):\s*(.+)$/.exec(line.trim());
    if (m) attrs[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return attrs;
}

/** 描述兜底：frontmatter description → 首个标题行 → 首个非空行（截断） */
function extractDescription(text: string): string | undefined {
  const body = text.startsWith('---')
    ? text.slice(Math.max(text.indexOf('\n---', 3) + 4, 0))
    : text;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    return t.replace(/^#+\s*/, '').slice(0, 120);
  }
  return undefined;
}

function safeReadDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readMd(path: string): { attrs: Record<string, string>; description?: string } | null {
  try {
    const text = readFileSync(path, 'utf-8');
    const attrs = parseFrontmatterAttrs(text);
    return { attrs, description: attrs.description ?? extractDescription(text) };
  } catch {
    return null;
  }
}

/** 递归扫描命令目录：name = 相对路径去 .md（'lattice/task/start'） */
export function scanCommandDir(dir: string, scope: Scope): SourceResourceInfo[] {
  const out: SourceResourceInfo[] = [];
  const walk = (cur: string): void => {
    for (const entry of safeReadDir(cur)) {
      const full = join(cur, entry);
      if (isDir(full)) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        const md = readMd(full);
        if (!md) continue;
        const name = relative(dir, full).slice(0, -3).split(sep).join('/');
        out.push({
          kind: 'command',
          name: md.attrs.name || name,
          ...(md.description ? { description: md.description } : {}),
          ...(md.attrs['argument-hint'] ? { argumentHint: md.attrs['argument-hint'] } : {}),
          scope,
          path: full,
        });
      }
    }
  };
  walk(dir);
  return out;
}

/** 平铺 md 文件扫描（agents / rules）：name = 文件名去扩展名 */
export function scanFlatMdDir(
  dir: string,
  kind: Extract<SourceResourceKind, 'agent' | 'rule'>,
  scope: Scope,
): SourceResourceInfo[] {
  const out: SourceResourceInfo[] = [];
  for (const entry of safeReadDir(dir)) {
    if (!/\.(md|mdc)$/.test(entry)) continue;
    const full = join(dir, entry);
    const md = readMd(full);
    if (!md) continue;
    out.push({
      kind,
      name: md.attrs.name || entry.replace(/\.(md|mdc)$/, ''),
      ...(md.description ? { description: md.description } : {}),
      scope,
      path: full,
    });
  }
  return out;
}

/** skills 扫描：含 SKILL.md 的子目录 = 一个 skill；根下散置 .md 也算 */
export function scanSkillDir(dir: string, scope: Scope): SourceResourceInfo[] {
  const out: SourceResourceInfo[] = [];
  for (const entry of safeReadDir(dir)) {
    const full = join(dir, entry);
    if (isDir(full)) {
      const skillFile = join(full, 'SKILL.md');
      const md = readMd(skillFile);
      if (md) {
        out.push({
          kind: 'skill',
          name: md.attrs.name || entry,
          ...(md.description ? { description: md.description } : {}),
          scope,
          path: skillFile,
        });
      }
    } else if (entry.endsWith('.md')) {
      const md = readMd(full);
      if (!md) continue;
      out.push({
        kind: 'skill',
        name: md.attrs.name || entry.slice(0, -3),
        ...(md.description ? { description: md.description } : {}),
        scope,
        path: full,
      });
    }
  }
  return out;
}
