import { join } from 'node:path';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { getCacheDir } from '../paths';

/**
 * 域同步日志（JSONL，一行一条）：
 * ~/.lattice/.cache/sync-log/origin.jsonl        —— 主数据 origin 单仓操作（commit/pull/push）
 * ~/.lattice/.cache/sync-log/<domain-hash>.jsonl —— 每域独立（join/unlink/route/pull/push/退出传播）
 *
 * 追加写入、坏行隔离、可流式按行解析；面板经 listSyncLogs 聚合读取。
 */

export type SyncLogAction =
  | 'join'
  | 'unlink'
  | 'reorder'
  | 'route-update'
  | 'pull'
  | 'push'
  | 'conflict'
  | 'enable-git'
  | 'commit';

export interface SyncLogEntry {
  /** ISO 时间 */
  at: string;
  /** 目标：'origin' 或域 hash */
  target: string;
  action: SyncLogAction;
  status: 'ok' | 'error' | 'skip';
  message: string;
  /** 可选明细（推送/退出文件数等） */
  detail?: Record<string, unknown>;
}

export function getSyncLogDir(): string {
  return join(getCacheDir(), 'sync-log');
}

export function getSyncLogPath(target: string): string {
  return join(getSyncLogDir(), `${target}.jsonl`);
}

/** 追加一条同步日志（target = 'origin' 或域 hash） */
export async function appendSyncLog(entry: SyncLogEntry): Promise<void> {
  const dir = getSyncLogDir();
  await mkdir(dir, { recursive: true });
  await appendFile(getSyncLogPath(entry.target), JSON.stringify(entry) + '\n', 'utf-8');
}

/** 读取单个目标的日志（最新在后）；limit 截取尾部 N 条 */
export async function readSyncLog(target: string, limit = 200): Promise<SyncLogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(getSyncLogPath(target), 'utf-8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(Boolean);
  const entries: SyncLogEntry[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      entries.push(JSON.parse(line) as SyncLogEntry);
    } catch {
      // 坏行隔离：跳过损坏行
    }
  }
  return entries;
}
