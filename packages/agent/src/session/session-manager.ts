/**
 * Session Manager — 对话树 CRUD、分支、merge、JSONL 持久化
 * 兼容 Pi SessionManager 的 id/parentId JSONL 格式
 *
 * 分层加载（参考 Claude Code / Cursor 按需加载模式）：
 *   Level 0: loadTreeMeta — 只读 tree.json（元数据）
 *   Level 1: loadRecentNodes — 尾部读取最近 N 条节点
 *   Level 2: loadBranchNodes — 按分支筛选
 *   Level 3: loadTree — 全量加载（兜底）
 */
import { readFile, writeFile, appendFile, mkdir, readdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ConversationNode,
  ConversationBranch,
  ConversationTree,
  MergeMode,
  NodeRole,
  NodeContent,
} from '../types.js';
import { SessionIndexManager } from './session-index.js';
import type { SessionIndexEntry } from './session-index.js';

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

export class SessionManager {
  private trees = new Map<string, ConversationTree>();
  private nodes = new Map<string, Map<string, ConversationNode>>(); // treeId → nodeId → node
  private storage: SessionStorage;
  private indexManager: SessionIndexManager | null = null;

  constructor(storage: SessionStorage) {
    this.storage = storage;
    if (storage.indexPath) {
      this.indexManager = new SessionIndexManager({
        indexPath: storage.indexPath,
        baseDir: storage.baseDir,
      });
    }
  }

  /** 获取索引管理器（可能为 null） */
  getIndexManager(): SessionIndexManager | null {
    return this.indexManager;
  }

  // ── 树生命周期 ──

  async createTree(opts?: { taskId?: string; title?: string }): Promise<ConversationTree> {
    const id = randomUUID();
    const now = Date.now();
    const defaultBranch: ConversationBranch = {
      id: randomUUID(),
      name: 'default',
      forkPointId: '',
      isDefault: true,
      createdAt: now,
    };

    const tree: ConversationTree = {
      id,
      taskId: opts?.taskId,
      title: opts?.title,
      branches: [defaultBranch],
      headNodeId: null,
      defaultBranchId: defaultBranch.id,
      createdAt: now,
      updatedAt: now,
    };

    this.trees.set(id, tree);
    this.nodes.set(id, new Map());
    await this.persistTree(tree);

    // 索引维护
    if (this.indexManager) {
      await this.indexManager.upsert({
        treeId: id,
        title: opts?.title,
        taskId: opts?.taskId,
        nodeCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    return tree;
  }

  getTree(treeId: string): ConversationTree | undefined {
    return this.trees.get(treeId);
  }

  async loadTree(treeId: string): Promise<ConversationTree | undefined> {
    if (this.trees.has(treeId)) return this.trees.get(treeId);
    try {
      const dir = join(this.storage.baseDir, treeId);
      const metaRaw = await readFile(join(dir, 'tree.json'), 'utf-8');
      const tree: ConversationTree = JSON.parse(metaRaw);
      this.trees.set(treeId, tree);

      // 加载节点（nodes.jsonl 可能不存在 = 空树）
      const nodeMap = new Map<string, ConversationNode>();
      try {
        const nodesRaw = await readFile(join(dir, 'nodes.jsonl'), 'utf-8');
        for (const line of nodesRaw.split('\n')) {
          if (!line.trim()) continue;
          const node: ConversationNode = JSON.parse(line);
          nodeMap.set(node.id, node);
        }
      } catch {
        /* nodes.jsonl 不存在 = 空树 */
      }
      this.nodes.set(treeId, nodeMap);
      return tree;
    } catch {
      return undefined;
    }
  }

  // ── 分层加载 ──

  /**
   * Level 0: 只加载 tree.json 元数据（不读 nodes.jsonl）
   * 适用于列表展示、分支切换等只需结构信息的场景
   */
  async loadTreeMeta(treeId: string): Promise<ConversationTree | undefined> {
    if (this.trees.has(treeId)) return this.trees.get(treeId);
    try {
      const dir = join(this.storage.baseDir, treeId);
      const metaRaw = await readFile(join(dir, 'tree.json'), 'utf-8');
      const tree: ConversationTree = JSON.parse(metaRaw);
      this.trees.set(treeId, tree);
      // 不加载节点，确保 nodes map 存在但为空
      if (!this.nodes.has(treeId)) this.nodes.set(treeId, new Map());
      return tree;
    } catch {
      return undefined;
    }
  }

  /**
   * Level 1: 加载最近 N 个节点（从 JSONL 尾部读取，避免全量加载）
   * 适用于恢复对话、展示最近几轮的场景
   */
  async loadRecentNodes(treeId: string, count = 50): Promise<ConversationNode[]> {
    const dir = join(this.storage.baseDir, treeId);
    const filePath = join(dir, 'nodes.jsonl');

    try {
      const lines = await this.readTailLines(filePath, count);
      const nodes: ConversationNode[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        const node: ConversationNode = JSON.parse(line);
        nodes.push(node);
      }

      // 同时填充内存缓存
      if (!this.nodes.has(treeId)) this.nodes.set(treeId, new Map());
      const nodeMap = this.nodes.get(treeId)!;
      for (const node of nodes) nodeMap.set(node.id, node);

      return nodes;
    } catch {
      return [];
    }
  }

  /**
   * Level 2: 加载指定分支的节点
   * 适用于分支切换后只展示当前分支对话的场景
   */
  async loadBranchNodes(treeId: string, branchId: string): Promise<ConversationNode[]> {
    // 如果已全量加载，直接筛选
    const cached = this.nodes.get(treeId);
    if (cached && cached.size > 0) {
      return [...cached.values()].filter((n) => n.branchId === branchId);
    }

    // 否则全量读取后筛选（分支筛选无法用尾部读取优化）
    const dir = join(this.storage.baseDir, treeId);
    try {
      const nodesRaw = await readFile(join(dir, 'nodes.jsonl'), 'utf-8');
      const nodes: ConversationNode[] = [];
      const nodeMap = new Map<string, ConversationNode>();
      for (const line of nodesRaw.split('\n')) {
        if (!line.trim()) continue;
        const node: ConversationNode = JSON.parse(line);
        nodeMap.set(node.id, node);
        if (node.branchId === branchId) nodes.push(node);
      }
      this.nodes.set(treeId, nodeMap);
      return nodes;
    } catch {
      return [];
    }
  }

  /**
   * 列出所有会话（通过索引，不读 JSONL 正文）
   * 索引不存在时自动从目录重建
   */
  async listSessions(): Promise<SessionIndexEntry[]> {
    if (!this.indexManager) {
      // 无索引时退化为目录遍历
      return this.listSessionsFromDir();
    }
    const sessions = await this.indexManager.listSessions();
    if (sessions.length === 0) {
      // 索引为空可能是首次使用或损坏，尝试重建
      await this.indexManager.rebuild();
      return this.indexManager.listSessions();
    }
    return sessions;
  }

  /** 从祖先路径加载（只加载 HEAD 到 root 的路径节点） */
  async loadAncestorPath(treeId: string, nodeId: string): Promise<ConversationNode[]> {
    // 需要先有节点数据
    if (!this.nodes.has(treeId) || this.nodes.get(treeId)!.size === 0) {
      await this.loadTree(treeId);
    }
    return this.getAncestorPath(treeId, nodeId);
  }

  // ── 节点操作 ──

  async addNode(
    treeId: string,
    opts: {
      id?: string;
      parentId: string | null;
      role: NodeRole;
      content: NodeContent[];
      agentId?: string;
      metadata?: ConversationNode['metadata'];
      /** 显式指定分支（自动 fork 场景），否则从父节点继承 */
      branchId?: string;
    },
  ): Promise<ConversationNode> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);

    const node: ConversationNode = {
      id: opts.id ?? randomUUID(),
      parentId: opts.parentId,
      branchId: opts.branchId ?? this.resolveBranch(tree, opts.parentId),
      role: opts.role,
      content: opts.content,
      timestamp: Date.now(),
      agentId: opts.agentId,
      metadata: opts.metadata,
    };

    this.nodes.get(treeId)!.set(node.id, node);
    tree.headNodeId = node.id;
    tree.updatedAt = Date.now();

    await this.appendNode(treeId, node);
    await this.persistTree(tree);

    // 索引维护
    if (this.indexManager) {
      await this.indexManager.touch(treeId, {
        lastRole: node.role,
        nodeCount: this.nodes.get(treeId)!.size,
      });
    }

    return node;
  }

  getNode(treeId: string, nodeId: string): ConversationNode | undefined {
    return this.nodes.get(treeId)?.get(nodeId);
  }

  getNodes(treeId: string): ConversationNode[] {
    return [...(this.nodes.get(treeId)?.values() ?? [])];
  }

  getChildren(treeId: string, nodeId: string): ConversationNode[] {
    return this.getNodes(treeId).filter((n) => n.parentId === nodeId);
  }

  isLeaf(treeId: string, nodeId: string): boolean {
    return this.getChildren(treeId, nodeId).length === 0;
  }

  /** 获取从根到指定节点的祖先路径 */
  getAncestorPath(treeId: string, nodeId: string): ConversationNode[] {
    const path: ConversationNode[] = [];
    let current = this.getNode(treeId, nodeId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.getNode(treeId, current.parentId) : undefined;
    }
    return path;
  }

  // ── 分支操作 ──

  async fork(treeId: string, nodeId: string, name?: string): Promise<ConversationBranch> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);

    const branch: ConversationBranch = {
      id: randomUUID(),
      name: name ?? `branch-${tree.branches.length}`,
      forkPointId: nodeId,
      isDefault: false,
      createdAt: Date.now(),
    };

    tree.branches.push(branch);
    tree.updatedAt = Date.now();
    await this.persistTree(tree);
    return branch;
  }

  async setDefaultBranch(treeId: string, branchId: string): Promise<void> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);
    for (const b of tree.branches) b.isDefault = b.id === branchId;
    tree.defaultBranchId = branchId;
    tree.updatedAt = Date.now();
    await this.persistTree(tree);
  }

  /** 设置分支的源 session ID 并持久化（重启后恢复上下文用） */
  async setBranchSession(treeId: string, branchId: string, sourceSessionId: string): Promise<void> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);
    const branch = tree.branches.find((b) => b.id === branchId);
    if (!branch) throw new Error(`Branch not found: ${branchId}`);
    branch.sourceSessionId = sourceSessionId;
    tree.updatedAt = Date.now();
    await this.persistTree(tree);
  }

  /** 删除一个分支并持久化（用于 fork 失败后清理孤儿分支）；默认分支不可删除，幂等 */
  async removeBranch(treeId: string, branchId: string): Promise<void> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);
    const branch = tree.branches.find((b) => b.id === branchId);
    if (!branch) return; // 幂等：分支不存在视为已删除
    if (branch.isDefault) throw new Error(`Cannot remove default branch: ${branchId}`);
    tree.branches = tree.branches.filter((b) => b.id !== branchId);
    tree.updatedAt = Date.now();
    await this.persistTree(tree);
  }

  async switchHead(treeId: string, nodeId: string): Promise<void> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);
    if (!this.nodes.get(treeId)?.has(nodeId)) throw new Error(`Node not found: ${nodeId}`);
    tree.headNodeId = nodeId;
    tree.updatedAt = Date.now();
    await this.persistTree(tree);
  }

  // ── 删除 ──

  async deleteNodes(treeId: string, nodeIds: string[]): Promise<void> {
    const tree = this.trees.get(treeId);
    const nodeMap = this.nodes.get(treeId);
    if (!tree || !nodeMap) throw new Error(`Tree not found: ${treeId}`);

    // 校验：不能删根节点
    const roots = this.getNodes(treeId).filter((n) => n.parentId === null);
    for (const id of nodeIds) {
      if (roots.some((r) => r.id === id)) throw new Error('Cannot delete root node');
    }

    // 收集要删除的节点（包含子树）
    const toDelete = new Set<string>();
    const collectSubtree = (id: string) => {
      toDelete.add(id);
      for (const child of this.getChildren(treeId, id)) collectSubtree(child.id);
    };
    for (const id of nodeIds) collectSubtree(id);

    for (const id of toDelete) nodeMap.delete(id);

    // 如果 HEAD 被删，回退到父节点
    if (tree.headNodeId && toDelete.has(tree.headNodeId)) {
      const deletedNode = nodeIds.includes(tree.headNodeId) ? undefined : undefined;
      // 找到第一个被删节点的父
      const firstDeleted = this.getNode(treeId, nodeIds[0]);
      tree.headNodeId = firstDeleted?.parentId ?? null;
    }

    // 清理空分支
    tree.branches = tree.branches.filter(
      (b) => b.isDefault || this.getNodes(treeId).some((n) => n.branchId === b.id),
    );

    tree.updatedAt = Date.now();
    await this.persistTree(tree);
    // 注意：JSONL 是 append-only，删除通过 tree.json 中的 "deletedIds" 标记
    // 或者重写 nodes.jsonl（小规模场景可接受）
    await this.rewriteNodes(treeId);
  }

  /** 校验批量删除是否合法（从叶子开始的连续路径） */
  canBatchDelete(treeId: string, selectedIds: string[]): boolean {
    const hasLeaf = selectedIds.some((id) => this.isLeaf(treeId, id));
    if (!hasLeaf) return false;

    for (const id of selectedIds) {
      const children = this.getChildren(treeId, id);
      if (children.length > 0) {
        const allSelected = children.every((c) => selectedIds.includes(c.id));
        if (!allSelected) return false;
      }
    }

    const roots = this.getNodes(treeId).filter((n) => n.parentId === null);
    if (selectedIds.some((id) => roots.some((r) => r.id === id))) return false;

    return true;
  }

  // ── Merge ──

  async merge(
    treeId: string,
    branchId: string,
    targetNodeId: string,
    mode: MergeMode,
    summary?: string,
  ): Promise<ConversationNode> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);

    const branch = tree.branches.find((b) => b.id === branchId);
    if (!branch) throw new Error(`Branch not found: ${branchId}`);

    let content: NodeContent[];
    if (mode === 'squash') {
      content = [{ type: 'text', text: `[从分支 "${branch.name}" 合并]\n${summary ?? ''}` }];
    } else if (mode === 'reference') {
      const branchNodes = this.getNodes(treeId).filter((n) => n.branchId === branchId);
      content = [
        { type: 'text', text: `📎 参考分支 "${branch.name}"（${branchNodes.length} 轮对话）` },
      ];
    } else {
      content = [{ type: 'text', text: `[cherry-pick from "${branch.name}"]` }];
    }

    const mergeNode = await this.addNode(treeId, {
      parentId: targetNodeId,
      role: 'merge-summary',
      content,
    });

    branch.mergedAt = Date.now();
    await this.persistTree(tree);
    return mergeNode;
  }

  // ── Streaming 中间态持久化 ──

  /**
   * 写入/覆写 streaming 中间态文件
   * 每个 content block 完成时调用，记录当前已生成的内容
   */
  async writeStreaming(treeId: string, state: StreamingState): Promise<void> {
    const dir = join(this.storage.baseDir, treeId, 'streaming');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${state.requestId}.json`), JSON.stringify(state), 'utf-8');
  }

  /** 删除 streaming 文件（流正常结束后调用） */
  async clearStreaming(treeId: string, requestId: string): Promise<void> {
    const filePath = join(this.storage.baseDir, treeId, 'streaming', `${requestId}.json`);
    await rm(filePath, { force: true });
  }

  /** 扫描中断的 streaming 文件（加载时检测未完成回复） */
  async getInterruptedStreams(treeId: string): Promise<StreamingState[]> {
    const dir = join(this.storage.baseDir, treeId, 'streaming');
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
        const raw = await readFile(join(dir, f), 'utf-8');
        results.push(JSON.parse(raw) as StreamingState);
      } catch {
        // 损坏文件跳过
      }
    }
    return results;
  }

  // ── 内部方法 ──

  private resolveBranch(tree: ConversationTree, parentId: string | null): string {
    if (!parentId) return tree.defaultBranchId;
    const parentNode = this.nodes.get(tree.id)?.get(parentId);
    return parentNode?.branchId ?? tree.defaultBranchId;
  }

  private async persistTree(tree: ConversationTree): Promise<void> {
    const dir = join(this.storage.baseDir, tree.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'tree.json'), JSON.stringify(tree, null, 2), 'utf-8');
  }

  private async appendNode(treeId: string, node: ConversationNode): Promise<void> {
    const dir = join(this.storage.baseDir, treeId);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'nodes.jsonl'), JSON.stringify(node) + '\n', 'utf-8');
  }

  private async rewriteNodes(treeId: string): Promise<void> {
    const dir = join(this.storage.baseDir, treeId);
    const nodes = this.getNodes(treeId);
    const content = nodes.map((n) => JSON.stringify(n)).join('\n') + '\n';
    await writeFile(join(dir, 'nodes.jsonl'), content, 'utf-8');
  }

  /**
   * 从文件尾部读取最后 N 行（避免全量 readFile）
   * 使用 fs.read 从文件末尾反向扫描换行符定位
   */
  private async readTailLines(filePath: string, count: number): Promise<string[]> {
    const fh = await open(filePath, 'r');
    try {
      const { size } = await fh.stat();
      if (size === 0) return [];

      // 对于小文件（< 64KB），直接全量读取更简单
      if (size < 65536) {
        const buf = Buffer.alloc(size);
        await fh.read(buf, 0, size, 0);
        const content = buf.toString('utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
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

        // 从后往前收集完整行
        for (let i = parts.length - 1; i >= 1; i--) {
          if (parts[i].trim()) {
            lines.unshift(parts[i]);
            if (lines.length >= count) break;
          }
        }
      }

      // 处理文件开头的剩余部分
      if (lines.length < count && remaining.trim()) {
        lines.unshift(remaining);
      }

      return lines.slice(-count);
    } finally {
      await fh.close();
    }
  }

  /** 无索引时退化为目录遍历列出会话 */
  private async listSessionsFromDir(): Promise<SessionIndexEntry[]> {
    const entries: SessionIndexEntry[] = [];
    let dirs: string[];
    try {
      dirs = await readdir(this.storage.baseDir);
    } catch {
      return [];
    }

    for (const dir of dirs) {
      if (dir.startsWith('.') || dir === 'index.json') continue;
      try {
        const raw = await readFile(join(this.storage.baseDir, dir, 'tree.json'), 'utf-8');
        const tree = JSON.parse(raw) as ConversationTree;
        entries.push({
          treeId: tree.id,
          title: tree.title,
          taskId: tree.taskId,
          nodeCount: 0, // 不读 JSONL，未知
          createdAt: tree.createdAt,
          updatedAt: tree.updatedAt,
        });
      } catch {
        // 跳过无效目录
      }
    }

    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
