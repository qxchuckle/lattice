/**
 * Session Index — 会话元数据索引，列表操作不读 JSONL 正文
 * 参考 Claude Code 的 sessions-index.json 模式
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NodeRole } from '../types.js';
import { getSessionsCacheDir, getSessionsIndexPath } from '@qcqx/lattice-foundation';

// ── 索引数据结构 ──

export interface SessionIndexEntry {
  treeId: string;
  title?: string;
  taskId?: string;
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
  lastRole?: NodeRole;
  /** 最近一次 compaction 的摘要 */
  summary?: string;
}

export interface SessionIndex {
  sessions: SessionIndexEntry[];
  updatedAt: number;
}

// ── Session Index Manager ──

export class SessionIndexManager {
  private readonly indexPath: string;
  private readonly baseDir: string;
  private index: SessionIndex | null = null;

  constructor() {
    this.indexPath = getSessionsIndexPath();
    this.baseDir = getSessionsCacheDir();
  }

  /** 加载索引（内存缓存，不存在则返回空） */
  async load(): Promise<SessionIndex> {
    if (this.index) return this.index;
    try {
      const raw = await readFile(this.indexPath, 'utf-8');
      this.index = JSON.parse(raw) as SessionIndex;
    } catch {
      this.index = { sessions: [], updatedAt: Date.now() };
    }
    return this.index;
  }

  /** 列出所有会话（不读 JSONL 正文） */
  async listSessions(): Promise<SessionIndexEntry[]> {
    const idx = await this.load();
    return [...idx.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 按 treeId 查找 */
  async getEntry(treeId: string): Promise<SessionIndexEntry | undefined> {
    const idx = await this.load();
    return idx.sessions.find((s) => s.treeId === treeId);
  }

  /** 创建或更新条目 */
  async upsert(entry: SessionIndexEntry): Promise<void> {
    const idx = await this.load();
    const existing = idx.sessions.findIndex((s) => s.treeId === entry.treeId);
    if (existing >= 0) {
      idx.sessions[existing] = entry;
    } else {
      idx.sessions.push(entry);
    }
    idx.updatedAt = Date.now();
    await this.persist();
  }

  /** 增量更新节点计数和时间戳 */
  async touch(treeId: string, opts?: { lastRole?: NodeRole; nodeCount?: number }): Promise<void> {
    const idx = await this.load();
    const entry = idx.sessions.find((s) => s.treeId === treeId);
    if (!entry) return;
    entry.updatedAt = Date.now();
    if (opts?.lastRole) entry.lastRole = opts.lastRole;
    if (opts?.nodeCount !== undefined) entry.nodeCount = opts.nodeCount;
    idx.updatedAt = Date.now();
    await this.persist();
  }

  /** 更新摘要（compaction 后调用） */
  async updateSummary(treeId: string, summary: string): Promise<void> {
    const idx = await this.load();
    const entry = idx.sessions.find((s) => s.treeId === treeId);
    if (!entry) return;
    entry.summary = summary;
    entry.updatedAt = Date.now();
    idx.updatedAt = Date.now();
    await this.persist();
  }

  /** 删除条目 */
  async remove(treeId: string): Promise<void> {
    const idx = await this.load();
    idx.sessions = idx.sessions.filter((s) => s.treeId !== treeId);
    idx.updatedAt = Date.now();
    await this.persist();
  }

  /**
   * 从目录重建索引（索引损坏时的兜底）
   * 遍历 baseDir 下的子目录，读取 tree.json 重建元数据
   */
  async rebuild(): Promise<SessionIndex> {
    const entries: SessionIndexEntry[] = [];
    let dirs: string[];
    try {
      dirs = await readdir(this.baseDir);
    } catch {
      dirs = [];
    }

    for (const dir of dirs) {
      if (dir.startsWith('.') || dir === 'index.json') continue;
      try {
        const raw = await readFile(join(this.baseDir, dir, 'tree.json'), 'utf-8');
        const tree = JSON.parse(raw) as {
          id: string;
          title?: string;
          taskId?: string;
          createdAt: number;
          updatedAt: number;
        };

        // 统计节点数
        let nodeCount = 0;
        try {
          const nodesRaw = await readFile(join(this.baseDir, dir, 'nodes.jsonl'), 'utf-8');
          nodeCount = nodesRaw.split('\n').filter((l) => l.trim()).length;
        } catch {
          // nodes.jsonl 不存在
        }

        entries.push({
          treeId: tree.id,
          title: tree.title,
          taskId: tree.taskId,
          nodeCount,
          createdAt: tree.createdAt,
          updatedAt: tree.updatedAt,
        });
      } catch {
        // 跳过无效目录
      }
    }

    this.index = { sessions: entries, updatedAt: Date.now() };
    await this.persist();
    return this.index;
  }

  /** 清除内存缓存（下次 load 重新读文件） */
  invalidate(): void {
    this.index = null;
  }

  private async persist(): Promise<void> {
    if (!this.index) return;
    const dir = join(this.indexPath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(this.index, null, 2), 'utf-8');
  }
}
