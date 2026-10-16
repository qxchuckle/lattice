/**
 * 导出 manifest：hash 清单的读/写素材与工具标记。
 *
 * 兼容：
 * - v2 `lattice-export`（本次单入口命令产物）
 * - v1 `lattice-spec-export`（历史 spec export 产物，--verify 仍可校验）
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readText } from '../paths';
import type { ExportManifest } from './types';

export const EXPORT_TOOL = 'lattice-export' as const;
export const LEGACY_EXPORT_TOOL = 'lattice-spec-export' as const;
export const EXPORT_MANIFEST = 'manifest.yaml';
export const DEFAULT_SKILL_NAME = 'lattice-knowledge';

export function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf-8').digest('hex')}`;
}

/** 读取导出目录的 manifest（接受 v2 与 v1 两种工具标记）；无效返回 null */
export async function readExportManifest(dir: string): Promise<ExportManifest | null> {
  const raw = await readText(join(dir, EXPORT_MANIFEST));
  if (!raw) return null;
  try {
    const m = parseYaml(raw) as ExportManifest | null;
    if (!m || typeof m !== 'object') return null;
    const tool = String(m.tool ?? '');
    if (tool !== EXPORT_TOOL && tool !== LEGACY_EXPORT_TOOL) return null;
    if (!Array.isArray(m.files)) return null;
    return m;
  } catch {
    return null;
  }
}
