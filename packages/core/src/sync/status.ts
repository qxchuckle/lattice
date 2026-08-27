import { join } from 'node:path';
import { getCacheDir } from '../paths';

/**
 * 域同步状态持久化：~/.lattice/.cache/sync-status/<hash>.json
 * 记录每域上次同步结果（ok/error + 摘要 + 时间），供 listDomains/面板展示。
 */

export function getSyncStatusDir(): string {
  return join(getCacheDir(), 'sync-status');
}

export function getSyncStatusPath(domainHash: string): string {
  return join(getSyncStatusDir(), `${domainHash}.json`);
}
