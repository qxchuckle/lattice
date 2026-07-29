/**
 * 本地命令模板扫描（编排层）
 *
 * 扫描 lattice 自有命令目录（~/.lattice/agent/commands + <cwd>/.lattice/commands），
 * md 文件 + 可选 frontmatter（name/description/argument-hint），格式与 Qoder/CC 命令文件兼容。
 * 与 agent-source 的产品目录扫描各自维护：那边是源层私有知识，这边是编排层自有资源。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { SourceResourceInfo } from '@qcqx/lattice-agent-protocol';

/** 本地命令注册项（origin='local'，templatePath 供 PromptComposer 惰性读取） */
export interface LocalCommand extends SourceResourceInfo {
  kind: 'command';
  templatePath: string;
}

/** 最小 frontmatter 解析：顶层 `key: value` 字符串对 */
function parseAttrs(text: string): Record<string, string> {
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

/** 去 frontmatter 后的正文（命令模板注入用） */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  return end === -1 ? text : text.slice(end + 4).replace(/^\n+/, '');
}

function firstLine(text: string): string | undefined {
  for (const line of stripFrontmatter(text).split('\n')) {
    const t = line.trim();
    if (t) return t.replace(/^#+\s*/, '').slice(0, 120);
  }
  return undefined;
}

/** 递归扫描命令目录：name = 相对路径去 .md（'lattice/task/start'） */
export function scanLocalCommands(dir: string, scope: 'user' | 'project'): LocalCommand[] {
  const out: LocalCommand[] = [];
  const walk = (cur: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(cur, entry);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        let text: string;
        try {
          text = readFileSync(full, 'utf-8');
        } catch {
          continue;
        }
        const attrs = parseAttrs(text);
        const name = relative(dir, full).slice(0, -3).split(sep).join('/');
        out.push({
          kind: 'command',
          name: attrs.name || name,
          ...(attrs.description || firstLine(text)
            ? { description: attrs.description ?? firstLine(text) }
            : {}),
          ...(attrs['argument-hint'] ? { argumentHint: attrs['argument-hint'] } : {}),
          scope,
          path: full,
          templatePath: full,
        });
      }
    }
  };
  walk(dir);
  return out;
}
