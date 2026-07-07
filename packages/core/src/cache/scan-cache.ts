/**
 * 扫描缓存 — 纯文件操作
 *
 * 读写 ~/.lattice/cache/last-scan.json
 * 记录上次扫描成功的时间、目录和结果
 */

import { getCacheDir, readJSON, writeJSON, fileExists, join } from '../paths';

const SCAN_CACHE_FILE = 'last-scan.json';

function getScanCachePath(): string {
  return join(getCacheDir(), SCAN_CACHE_FILE);
}

export interface ScanCache {
  /** 上次扫描成功完成的时间（ISO 8601） */
  lastSuccessAt: string;
  /** 上次扫描的目录列表 */
  lastScanDirs: string[];
  /** 上次扫描结果摘要 */
  lastResult: {
    added: number;
    updated: number;
  };
}

/**
 * 读取扫描缓存
 */
export async function readScanCache(): Promise<ScanCache | null> {
  const path = getScanCachePath();
  if (!(await fileExists(path))) return null;
  return readJSON<ScanCache>(path);
}

/**
 * 写入扫描缓存（只在扫描成功后调用）
 */
export async function writeScanCache(cache: ScanCache): Promise<void> {
  const path = getScanCachePath();
  await writeJSON(path, cache);
}

/**
 * 检查是否需要扫描（超过指定间隔）
 *
 * @param intervalMs 间隔毫秒数（默认 12h）
 * @returns true 如果需要扫描
 */
export async function shouldScan(intervalMs: number = 12 * 60 * 60 * 1000): Promise<boolean> {
  const cache = await readScanCache();
  if (!cache?.lastSuccessAt) return true;
  const lastSuccess = new Date(cache.lastSuccessAt).getTime();
  const now = Date.now();
  return now - lastSuccess > intervalMs;
}
