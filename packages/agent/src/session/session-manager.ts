/**
 * Session Manager — 对话树领域层：CRUD、分支、merge、状态机
 *
 * 持久化全部委托给 SessionRepository（本类不直接接触 fs）。
 *
 * 分层加载（参考 Claude Code / Cursor 按需加载模式）：
 *   Level 0: loadTreeMeta — 只读 tree.json（元数据）
 *   Level 1: loadRecentNodes — 尾部读取最近 N 条节点
 *   Level 2: loadBranchNodes — 按分支筛选
 *   Level 3: loadTree — 全量加载（兜底）
 */
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
import { SessionRepository } from './session-repository.js';
import type { SessionStorage, StreamingState } from './session-repository.js';

export type { SessionStorage, StreamingState };

export class SessionManager {
  private trees = new Map<string, ConversationTree>();
  private nodes = new Map<string, Map<string, ConversationNode>>(); // treeId → nodeId → node
  private repo: SessionRepository;
  private indexManager: SessionIndexManager | null = null;

  constructor(storage: SessionStorage) {
    this.repo = new SessionRepository(storage);
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
    await this.repo.writeTree(tree);

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

  /** 删除对话树（内存缓存 + 索引条目 + 磁盘目录） */
  async deleteTree(treeId: string): Promise<void> {
    this.trees.delete(treeId);
    this.nodes.delete(treeId);
    if (this.indexManager) await this.indexManager.remove(treeId);
    await this.repo.deleteTree(treeId);
  }

  async loadTree(treeId: string): Promise<ConversationTree | undefined> {
    if (this.trees.has(treeId)) return this.trees.get(treeId);
    const tree = await this.repo.readTree(treeId);
    if (!tree) return undefined;
    this.trees.set(treeId, tree);

    const nodeMap = new Map<string, ConversationNode>();
    for (const node of await this.repo.readNodes(treeId)) nodeMap.set(node.id, node);
    this.nodes.set(treeId, nodeMap);
    return tree;
  }

  // ── 分层加载 ──

  /** Level 0: 只加载 tree.json 元数据（不读 nodes.jsonl） */
  async loadTreeMeta(treeId: string): Promise<ConversationTree | undefined> {
    if (this.trees.has(treeId)) return this.trees.get(treeId);
    const tree = await this.repo.readTree(treeId);
    if (!tree) return undefined;
    this.trees.set(treeId, tree);
    if (!this.nodes.has(treeId)) this.nodes.set(treeId, new Map());
    return tree;
  }

  /** Level 1: 加载最近 N 个节点（从 JSONL 尾部读取） */
  async loadRecentNodes(treeId: string, count = 50): Promise<ConversationNode[]> {
    const nodes = await this.repo.readTailNodes(treeId, count);
    if (!this.nodes.has(treeId)) this.nodes.set(treeId, new Map());
    const nodeMap = this.nodes.get(treeId)!;
    for (const node of nodes) nodeMap.set(node.id, node);
    return nodes;
  }

  /** Level 2: 加载指定分支的节点 */
  async loadBranchNodes(treeId: string, branchId: string): Promise<ConversationNode[]> {
    const cached = this.nodes.get(treeId);
    if (cached && cached.size > 0) {
      return [...cached.values()].filter((n) => n.branchId === branchId);
    }
    const nodes = await this.repo.readNodes(treeId);
    const nodeMap = new Map<string, ConversationNode>();
    const branchNodes: ConversationNode[] = [];
    for (const node of nodes) {
      nodeMap.set(node.id, node);
      if (node.branchId === branchId) branchNodes.push(node);
    }
    this.nodes.set(treeId, nodeMap);
    return branchNodes;
  }

  /** 列出所有会话（通过索引，不读 JSONL 正文）；索引不存在时自动重建 */
  async listSessions(): Promise<SessionIndexEntry[]> {
    if (!this.indexManager) {
      return this.listSessionsFromDir();
    }
    const sessions = await this.indexManager.listSessions();
    if (sessions.length === 0) {
      await this.indexManager.rebuild();
      return this.indexManager.listSessions();
    }
    return sessions;
  }

  /** 从祖先路径加载（只加载 HEAD 到 root 的路径节点） */
  async loadAncestorPath(treeId: string, nodeId: string): Promise<ConversationNode[]> {
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
      /** 节点状态（默认 active，中断时传 interrupted） */
      status?: ConversationNode['status'];
      /** 显式指定分支（自动 fork 场景），否则从父节点继承 */
      branchId?: string;
      /** 是否推进 head 到新节点（默认 true；流式期间父节点被撤销后的只读落盘传 false） */
      advanceHead?: boolean;
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
      status: opts.status,
      metadata: opts.metadata,
    };

    this.nodes.get(treeId)!.set(node.id, node);
    if (opts.advanceHead !== false) tree.headNodeId = node.id;
    this.touch(tree);

    await this.repo.appendNode(treeId, node);
    await this.repo.writeTree(tree);

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

  /** 更新节点字段（状态/内容/元数据）并持久化 */
  async updateNode(
    treeId: string,
    nodeId: string,
    updates: Partial<Pick<ConversationNode, 'content' | 'status' | 'metadata'>>,
  ): Promise<void> {
    const node = this.nodes.get(treeId)?.get(nodeId);
    if (!node) return;

    if (updates.content !== undefined) node.content = updates.content;
    if (updates.status !== undefined) node.status = updates.status;
    if (updates.metadata !== undefined) node.metadata = updates.metadata;

    await this.rewriteNodes(treeId);
    const tree = this.trees.get(treeId);
    if (tree) {
      this.touch(tree);
      await this.repo.writeTree(tree);
    }
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

  /** 获取节点的所有后代 ID（BFS，不含自身） */
  getDescendantIds(treeId: string, nodeId: string): string[] {
    const result: string[] = [];
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of this.getChildren(treeId, current)) {
        result.push(child.id);
        queue.push(child.id);
      }
    }
    return result;
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

  async fork(
    treeId: string,
    nodeId: string,
    name?: string,
    agentId?: string,
  ): Promise<ConversationBranch> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);

    const branch: ConversationBranch = {
      id: randomUUID(),
      name: name ?? `branch-${tree.branches.length}`,
      forkPointId: nodeId,
      isDefault: false,
      createdAt: Date.now(),
      ...(agentId ? { agentId } : {}),
    };

    tree.branches.push(branch);
    this.touch(tree);
    await this.repo.writeTree(tree);
    return branch;
  }

  async setDefaultBranch(treeId: string, branchId: string): Promise<void> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);
    for (const b of tree.branches) b.isDefault = b.id === branchId;
    tree.defaultBranchId = branchId;
    this.touch(tree);
    await this.repo.writeTree(tree);
  }

  /** 设置分支的源 session ID 并持久化（重启后恢复上下文用） */
  async setBranchSession(treeId: string, branchId: string, sourceSessionId: string): Promise<void> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);
    const branch = tree.branches.find((b) => b.id === branchId);
    if (!branch) throw new Error(`Branch not found: ${branchId}`);
    branch.sourceSessionId = sourceSessionId;
    this.touch(tree);
    await this.repo.writeTree(tree);
  }

  /** 删除一个分支并持久化（用于 fork 失败后清理孤儿分支）；默认分支不可删除，幂等 */
  async removeBranch(treeId: string, branchId: string): Promise<void> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);
    const branch = tree.branches.find((b) => b.id === branchId);
    if (!branch) return; // 幂等：分支不存在视为已删除
    if (branch.isDefault) throw new Error(`Cannot remove default branch: ${branchId}`);
    tree.branches = tree.branches.filter((b) => b.id !== branchId);
    this.touch(tree);
    await this.repo.writeTree(tree);
  }

  async switchHead(treeId: string, nodeId: string): Promise<void> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);
    if (!this.nodes.get(treeId)?.has(nodeId)) throw new Error(`Node not found: ${nodeId}`);
    tree.headNodeId = nodeId;
    this.touch(tree);
    await this.repo.writeTree(tree);
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
    for (const id of nodeIds) {
      toDelete.add(id);
      for (const desc of this.getDescendantIds(treeId, id)) toDelete.add(desc);
    }
    for (const id of toDelete) nodeMap.delete(id);

    // 如果 HEAD 被删，回退到第一个被删节点的父节点
    if (tree.headNodeId && toDelete.has(tree.headNodeId)) {
      const firstDeleted = this.getNode(treeId, nodeIds[0]);
      tree.headNodeId = firstDeleted?.parentId ?? null;
    }

    // 清理空分支
    tree.branches = tree.branches.filter(
      (b) => b.isDefault || this.getNodes(treeId).some((n) => n.branchId === b.id),
    );

    this.touch(tree);
    await this.repo.writeTree(tree);
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
    await this.repo.writeTree(tree);
    return mergeNode;
  }

  // ── Streaming 中间态（委托 Repository） ──

  async writeStreaming(treeId: string, state: StreamingState): Promise<void> {
    await this.repo.writeStreaming(treeId, state);
  }

  async clearStreaming(treeId: string, requestId: string): Promise<void> {
    await this.repo.clearStreaming(treeId, requestId);
  }

  /** 扫描中断的 streaming 文件（加载时检测未完成回复） */
  async getInterruptedStreams(treeId: string): Promise<StreamingState[]> {
    return this.repo.readStreaming(treeId);
  }

  // ── 内部方法 ──

  /** 统一触碰树：bump 单调 rev + updatedAt（所有持久化 mutation 唯一入口） */
  private touch(tree: ConversationTree): void {
    tree.rev = (tree.rev ?? 0) + 1;
    tree.updatedAt = Date.now();
  }

  private resolveBranch(tree: ConversationTree, parentId: string | null): string {
    if (!parentId) return tree.defaultBranchId;
    const parentNode = this.nodes.get(tree.id)?.get(parentId);
    return parentNode?.branchId ?? tree.defaultBranchId;
  }

  private async rewriteNodes(treeId: string): Promise<void> {
    await this.repo.writeNodes(treeId, this.getNodes(treeId));
  }

  /** 无索引时退化为目录遍历列出会话 */
  private async listSessionsFromDir(): Promise<SessionIndexEntry[]> {
    const entries: SessionIndexEntry[] = [];
    for (const dir of await this.repo.listTreeDirs()) {
      const tree = await this.repo.readTree(dir);
      if (!tree) continue;
      entries.push({
        treeId: tree.id,
        title: tree.title,
        taskId: tree.taskId,
        nodeCount: 0, // 不读 JSONL，未知
        createdAt: tree.createdAt,
        updatedAt: tree.updatedAt,
      });
    }
    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
