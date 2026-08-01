import { readdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { ISource } from '@qcqx/lattice-agent-protocol';

/** 扫描指定目录，加载每个子目录中的源包 */
export async function scanSources(dir: string): Promise<{
  loaded: Array<{ id: string; source: ISource }>;
  failed: Array<{ dir: string; error: string }>;
}> {
  const loaded: Array<{ id: string; source: ISource }> = [];
  const failed: Array<{ dir: string; error: string }> = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // 目录不存在 = 无自定义源
      return { loaded, failed };
    }
    throw err;
  }

  for (const entry of entries) {
    const entryPath = resolve(dir, entry);
    const pkgPath = join(entryPath, 'package.json');

    // 跳过没有 package.json 的子目录
    try {
      await access(pkgPath);
    } catch {
      console.warn(`[source-discovery] Skipping ${entry}: no package.json`);
      continue;
    }

    try {
      // 动态 import，Node.js 会读 package.json 的 exports/main 找到入口
      const mod = await import(entryPath);
      const createSource = mod.default;

      if (typeof createSource !== 'function') {
        failed.push({ dir: entryPath, error: 'default export is not a function' });
        console.warn(`[source-discovery] Skipping ${entry}: default export is not a function`);
        continue;
      }

      const source: ISource = createSource();

      // 基本校验：ISource 应该有 id 和 describe 方法
      if (!source || typeof source.id !== 'string' || typeof source.describe !== 'function') {
        failed.push({ dir: entryPath, error: 'default export did not return a valid ISource' });
        console.warn(`[source-discovery] Skipping ${entry}: not a valid ISource`);
        continue;
      }

      loaded.push({ id: source.id, source });
    } catch (err: any) {
      failed.push({ dir: entryPath, error: err.message || String(err) });
      console.warn(`[source-discovery] Failed to load ${entry}: ${err.message}`);
    }
  }

  return { loaded, failed };
}
