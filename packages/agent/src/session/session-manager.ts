/**
 * Session Manager — 对话树 CRUD、分支、merge、JSONL 持久化
 * 兼容 Pi SessionManager 的 id/parentId JSONL 格式
 */
import { readFile, writeFile, appendFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ConversationNode,
  ConversationBranch,
  ConversationTree,
  MergeMode,
  NodeRole,
  MessageContent,
} from '../types.js';

export interface SessionStorage {
  baseDir: string; // ~/.lattice/users/<u>/sessions/
}

export class SessionManager {
  private trees = new Map<string, ConversationTree>();
  private nodes = new Map<string, Map<string, ConversationNode>>(); // treeId → nodeId → node
  private storage: SessionStorage;

  constructor(storage: SessionStorage) {
    this.storage = storage;
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

      // 加载节点
      const nodesRaw = await readFile(join(dir, 'nodes.jsonl'), 'utf-8');
      const nodeMap = new Map<string, ConversationNode>();
      for (const line of nodesRaw.split('\n')) {
        if (!line.trim()) continue;
        const node: ConversationNode = JSON.parse(line);
        nodeMap.set(node.id, node);
      }
      this.nodes.set(treeId, nodeMap);
      return tree;
    } catch {
      return undefined;
    }
  }

  // ── 节点操作 ──

  async addNode(
    treeId: string,
    opts: {
      parentId: string | null;
      role: NodeRole;
      content: MessageContent[];
      agentId?: string;
      metadata?: ConversationNode['metadata'];
    },
  ): Promise<ConversationNode> {
    const tree = this.trees.get(treeId);
    if (!tree) throw new Error(`Tree not found: ${treeId}`);

    const node: ConversationNode = {
      id: randomUUID(),
      parentId: opts.parentId,
      branchId: this.resolveBranch(tree, opts.parentId),
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
      const deletedNode = nodeIds.includes(tree.headNodeId)
        ? undefined
        : undefined;
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

    let content: MessageContent[];
    if (mode === 'squash') {
      content = [{ type: 'text', text: `[从分支 "${branch.name}" 合并]\n${summary ?? ''}` }];
    } else if (mode === 'reference') {
      const branchNodes = this.getNodes(treeId).filter((n) => n.branchId === branchId);
      content = [{ type: 'text', text: `📎 参考分支 "${branch.name}"（${branchNodes.length} 轮对话）` }];
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
}
