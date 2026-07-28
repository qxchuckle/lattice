/**
 * SessionRepository — 会话持久化层（文件 I/O 唯一入口）
 *
 * 从 SessionManager 分离出的纯持久化职责：
 *   - tree.json 读写
 *   - nodes.jsonl 追加 / 重写 / 尾部读取
 *   - streaming 中间态文件
 *   - 目录遍历（无索引兜底）
 *
 * SessionManager（领域层）通过本类完成所有磁盘操作，自身不直接接触 fs。
 */
import { readFile, writeFile, appendFile, mkdir, readdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConversationNode, ConversationTree, NodeContent } from '@qcqx/lattice-agent-protocol';

export interface SessionStorage {
  baseDir: string; // ~/.lattice/.cache/sessions/
  indexPath?: string; // 索引文件路径（可选，不传则不启用索引）
}

/** streaming 中间态文件内容（持久化正在生成的 assistant 回复） */
export interface StreamingState {
  requestId: string;
  parentId: string;
  role: 'assistant';
  startedAt: number;
  content: NodeContent[];
}

export class SessionRepository {
  /**
   * nodes.jsonl 写操作 per-tree 串行锁：append 与全量 rewrite 并发交错会损坏 JSONL。
   * 重复行（rewrite 已含节点后又 append 同节点）由加载时 Map 按 id 去重容忍。
   */
  private writeLocks = new Map<string, Promise<void>>();

  constructor(private readonly storage: SessionStorage) {}

  private withWriteLock<T>(treeId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLocks.get(treeId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.writeLocks.set(
      treeId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  get baseDir(): string {
    return this.storage.baseDir;
  }

  get indexPath(): string | undefined {
    return this.storage.indexPath;
  }

  private treeDir(treeId: string): string {
    this.assertSafeSegment(treeId, 'treeId');
    return join(this.storage.baseDir, treeId);
  }

  /**
   * 校验路径段合法（防路径穿越）
   * treeId / requestId 均来自客户端，拼接文件路径前必须确保不含路径分隔符与 ..
   */
  private assertSafeSegment(segment: string, label: string): void {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('..') ||
      /[\\/]/.test(segment)
    ) {
      throw new Error(`非法 ${label}: ${segment}`);
    }
  }

  // ── tree.json ──

  async readTree(treeId: string): Promise<ConversationTree | undefined> {
    try {
      const raw = await readFile(join(this.treeDir(treeId), 'tree.json'), 'utf-8');
      return JSON.parse(raw) as ConversationTree;
    } catch {
      return undefined;
    }
  }

  async writeTree(tree: ConversationTree): Promise<void> {
    const dir = this.treeDir(tree.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'tree.json'), JSON.stringify(tree, null, 2), 'utf-8');
  }

  /** 删除整个树目录（tree.json + nodes.jsonl + streaming） */
  async deleteTree(treeId: string): Promise<void> {
    await rm(this.treeDir(treeId), { recursive: true, force: true });
  }

  // ── nodes.jsonl ──

  async readNodes(treeId: string): Promise<ConversationNode[]> {
    try {
      const raw = await readFile(join(this.treeDir(treeId), 'nodes.jsonl'), 'utf-8');
      const nodes: ConversationNode[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        nodes.push(JSON.parse(line) as ConversationNode);
      }
      return nodes;
    } catch {
      return []; // nodes.jsonl 不存在 = 空树
    }
  }

  async appendNode(treeId: string, node: ConversationNode): Promise<void> {
    await this.withWriteLock(treeId, async () => {
      const dir = this.treeDir(treeId);
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'nodes.jsonl'), JSON.stringify(node) + '\n', 'utf-8');
    });
  }

  async writeNodes(treeId: string, nodes: ConversationNode[]): Promise<void> {
    await this.withWriteLock(treeId, async () => {
      const dir = this.treeDir(treeId);
      await mkdir(dir, { recursive: true });
      const content = nodes.map((n) => JSON.stringify(n)).join('\n') + '\n';
      await writeFile(join(dir, 'nodes.jsonl'), content, 'utf-8');
    });
  }

  /** 尾部读取最近 N 个节点（避免全量加载） */
  async readTailNodes(treeId: string, count: number): Promise<ConversationNode[]> {
    const lines = await this.readTailLines(join(this.treeDir(treeId), 'nodes.jsonl'), count);
    const nodes: ConversationNode[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      nodes.push(JSON.parse(line) as ConversationNode);
    }
    return nodes;
  }

  // ── streaming 中间态 ──

  async writeStreaming(treeId: string, state: StreamingState): Promise<void> {
    this.assertSafeSegment(state.requestId, 'requestId');
    const dir = join(this.treeDir(treeId), 'streaming');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${state.requestId}.json`), JSON.stringify(state), 'utf-8');
  }

  async clearStreaming(treeId: string, requestId: string): Promise<void> {
    this.assertSafeSegment(requestId, 'requestId');
    await rm(join(this.treeDir(treeId), 'streaming', `${requestId}.json`), { force: true });
  }

  async readStreaming(treeId: string): Promise<StreamingState[]> {
    const dir = join(this.treeDir(treeId), 'streaming');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const results: StreamingState[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        results.push(JSON.parse(await readFile(join(dir, f), 'utf-8')) as StreamingState);
      } catch {
        /* 损坏文件跳过 */
      }
    }
    return results;
  }

  // ── 目录遍历 ──

  /** 列出所有树目录名（无索引时兜底列举会话） */
  async listTreeDirs(): Promise<string[]> {
    try {
      const dirs = await readdir(this.storage.baseDir);
      return dirs.filter((d) => !d.startsWith('.') && d !== 'index.json');
    } catch {
      return [];
    }
  }

  // ── 内部：文件尾部读取 ──

  /**
   * 从文件尾部读取最后 N 行（避免全量 readFile）
   * 小文件直接全量读；大文件从末尾反向扫描换行符定位
   */
  private async readTailLines(filePath: string, count: number): Promise<string[]> {
    let fh;
    try {
      fh = await open(filePath, 'r');
    } catch {
      return [];
    }
    try {
      const { size } = await fh.stat();
      if (size === 0) return [];

      // 小文件（< 64KB）直接全量读取
      if (size < 65536) {
        const buf = Buffer.alloc(size);
        await fh.read(buf, 0, size, 0);
        const lines = buf
          .toString('utf-8')
          .split('\n')
          .filter((l) => l.trim());
        return lines.slice(-count);
      }

      // 大文件：从尾部反向读取
      const chunkSize = 8192;
      const lines: string[] = [];
      let remaining = '';
      let position = size;

      while (position > 0 && lines.length < count) {
        const readSize = Math.min(chunkSize, position);
        position -= readSize;
        const buf = Buffer.alloc(readSize);
        await fh.read(buf, 0, readSize, position);

        const chunk = buf.toString('utf-8') + remaining;
        const parts = chunk.split('\n');
        remaining = parts[0]; // 第一个可能是不完整的行

        for (let i = parts.length - 1; i >= 1; i--) {
          if (parts[i].trim()) {
            lines.unshift(parts[i]);
            if (lines.length >= count) break;
          }
        }
      }

      if (lines.length < count && remaining.trim()) {
        lines.unshift(remaining);
      }

      return lines.slice(-count);
    } finally {
      await fh.close();
    }
  }
}
