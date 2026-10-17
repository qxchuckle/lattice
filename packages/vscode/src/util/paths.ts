import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';

export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isExecutableFile(p: string): Promise<boolean> {
  try {
    await access(p, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 向上查找最近的 lattice.json 锚点目录（对齐 CLI resolveCurrentProject 的「最近锚点」语义）。 */
export async function findLatticeAnchor(startDir: string, maxDepth = 16): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (let i = 0; i <= maxDepth; i++) {
    if (await fileExists(path.join(dir, 'lattice.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 读取 lattice.json 的 id（可能无前缀）。读不到或非法返回 null。 */
export async function readLatticeId(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, 'lattice.json'), 'utf8');
    const parsed = JSON.parse(raw) as { id?: unknown };
    if (typeof parsed.id === 'string' && parsed.id.trim() !== '') return parsed.id.trim();
    return null;
  } catch {
    return null;
  }
}

/** 无前缀 id 补 `legacy:`（对齐 core normalizeLegacyId）。 */
export function normalizeLegacyId(id: string): string {
  return /^[a-z]+:/i.test(id) ? id : `legacy:${id}`;
}

export function stripIdPrefix(id: string): string {
  const idx = id.indexOf(':');
  return idx === -1 ? id : id.slice(idx + 1);
}

/** child 是否位于 parent 之内（路径段对齐，防 /foo 匹配 /foobar）。 */
export function isPathInside(parent: string, child: string): boolean {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (p === c) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

export function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith(`~${path.sep}`)) return path.join(home, p.slice(2));
  return p;
}
