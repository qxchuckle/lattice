/**
 * 导出目录校验：重算 hash 对比 manifest（支持 v2 lattice-export 与历史 v1 lattice-spec-export 目录）。
 * 不导出、不写盘。
 */
import { join } from 'node:path';
import { listDir, readText } from '../paths';
import { EXPORT_MANIFEST, readExportManifest, sha256 } from './manifest';
import type { ExportVerifyIssue, ExportVerifyResult } from './types';

export async function verifyExport(dir: string): Promise<ExportVerifyResult> {
  const manifest = await readExportManifest(dir);
  if (!manifest) {
    throw new Error(
      `目录不含有效的 ${EXPORT_MANIFEST}（lattice-export / lattice-spec-export）：${dir}`,
    );
  }

  const issues: ExportVerifyIssue[] = [];
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
  const entries = await listDir(join(root, prefix));
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (entry === EXPORT_MANIFEST) continue;
    const sub = await listDir(join(root, rel));
    if (sub.length > 0) {
      results.push(...(await listDirRecursive(root, rel)));
    } else {
      results.push(rel);
    }
  }
  return results;
}
