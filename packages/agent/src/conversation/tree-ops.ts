/**
 * TreeOps — 对话树结构操作（fork / undo / delete / 线程源解析 / 分支会话同步）
 *
 * 与 TurnRunner 的分工：本类只动树与源会话的**结构**，不跑流式。
 * 结构操作共同的铁律：源侧 fork 失败不阻断树层操作（树是宿主真相，源会话可重建）。
 */
import type { ConversationBranch } from '@qcqx/lattice-agent-protocol';
import { canApplyOperation, shouldSkipDescendantMark } from '@qcqx/lattice-agent-protocol';
import type {
  ConversationControllerDeps,
  ConversationHooks,
  SessionContext,
  ForkOutcome,
} from './types.js';
import type { TreeRuntimeRegistry } from './tree-runtime.js';

export class TreeOps {
  constructor(
    private readonly deps: ConversationControllerDeps,
    private readonly runtimes: TreeRuntimeRegistry,
  ) {}

  /**
   * 解析节点所在线程的源：自身 agentId → assistant 子节点 agentId → 沿祖先链向上。
   * 源是第一层线程属性：后代继承，不可中途切换。
   */
  resolveNodeSourceId(treeId: string, nodeId: string): string | undefined {
    const nodes = this.deps.session.getNodes(treeId);
    let current = this.deps.session.getNode(treeId, nodeId);
    while (current) {
      if (current.agentId) return current.agentId;
      const cur = current;
      const assistantChild = nodes.find(
        (n) => n.parentId === cur.id && n.role === 'assistant' && n.agentId,
      );
      if (assistantChild?.agentId) return assistantChild.agentId;
      current = current.parentId ? this.deps.session.getNode(treeId, current.parentId) : undefined;
    }
    return undefined;
  }

  /**
   * fork 分支（含源级 fork 截断）；源按 fork 节点所在线程解析（树可混源）。
   *
   * 返回结构化结果而非裸分支：源侧 fork 可能失败（会话过期/锁点不存在/能力不支持），
   * 此时新分支从空白开始——属于降级，必须向上告知（铁律：不静默降级）。
   */
  async fork(
    treeId: string,
    nodeId: string,
    name: string | undefined,
    fallbackSourceId: string | undefined,
  ): Promise<ForkOutcome | undefined> {
    const threadSourceId = this.resolveNodeSourceId(treeId, nodeId) ?? fallbackSourceId;
    const branch = await this.deps.session.fork(treeId, nodeId, name, threadSourceId);
    const source = threadSourceId
      ? this.deps.sources.registry.getSource(threadSourceId)
      : undefined;
    const tree = this.deps.session.getTree(treeId);
    const forkNode = this.deps.session.getNode(treeId, nodeId);
    const parentBranch = tree?.branches.find(
      (b) => b.id === (forkNode?.branchId ?? tree?.defaultBranchId),
    );
    const parentSessionId = parentBranch?.sourceSessionId;
    const atMessage = forkNode?.metadata?.sourceMessageId;

    if (source && parentSessionId) {
      try {
        const forkedSessionId = await source.forkSession(parentSessionId, atMessage);
        await this.deps.session.setBranchSession(treeId, branch.id, forkedSessionId);
      } catch (err) {
        // 铁律：不静默降级。源 fork 失败 → 新分支从空白开始（无历史上下文），
        // 用户必须知道，否则会因为 AI “完全不记得前文”而困惑。
        return {
          branch,
          contextCarried: false,
          notice: `新分支未能继承对话上下文（源侧 fork 失败：${err instanceof Error ? err.message : String(err)}），将从空白开始`,
        };
      }
    }
    return { branch, contextCarried: source !== undefined && parentSessionId !== undefined };
  }

  /** undo/delete 共用：fork 截断到父节点 + 标记目标及后代 */
  async markNodes(
    ctx: SessionContext,
    nodeId: string,
    targetStatus: 'undone' | 'hidden',
    hooks: ConversationHooks,
  ): Promise<void> {
    const treeId = ctx.treeId;
    if (!treeId) return;
    const tree = this.deps.session.getTree(treeId);
    if (!tree) return;
    const node = this.deps.session.getNode(treeId, nodeId);
    if (!node) return;
    // 只读终态防护（状态机守卫）：undo 不作用于已 undone/hidden；delete 不作用于已 hidden（undone→hidden 合法）
    if (!canApplyOperation(targetStatus === 'undone' ? 'undo' : 'delete', node.status)) {
      hooks.onReject?.(undefined, '节点已处于只读终态，操作无效');
      return;
    }

    const parentNode = node.parentId ? this.deps.session.getNode(treeId, node.parentId) : null;
    const branch = this.deps.session.branchOf(tree, node);
    const sourceSessionId = branch?.sourceSessionId ?? null;

    // 0. 中止目标子树内的在途请求（requestId == user 节点 id，send/retry/continue 皆复用 turnId）：
    //    避免流结束后往已只读的 user 节点下挂 active assistant，也避免白烧 token
    const subtreeIds = [nodeId, ...this.deps.session.getDescendantIds(treeId, nodeId)];
    const rtMark = this.runtimes.of(ctx);
    for (const id of subtreeIds) {
      if (this.runtimes.abortRequest(rtMark, id)) {
        hooks.onStreamAborted?.(treeId, id, targetStatus === 'undone' ? 'undo' : 'delete');
      }
    }

    // 1. Fork 截断到父节点的消息（源按节点所在线程解析）
    if (sourceSessionId && parentNode) {
      const source = this.deps.sources.registry.getSource(
        this.resolveNodeSourceId(treeId, nodeId) ?? ctx.sourceId,
      );
      const parentSourceMsgId = parentNode.metadata?.sourceMessageId;
      if (source) {
        try {
          const newSessionId = await source.forkSession(sourceSessionId, parentSourceMsgId);
          if (branch && newSessionId !== sourceSessionId) {
            await this.deps.session.setBranchSession(treeId, branch.id, newSessionId);
          }
        } catch (err) {
          // 铁律：不静默降级。树层操作不受影响（树是宿主真相），
          // 但源侧仍记得被撤销/删除的内容——下次对话 AI 可能提到已消失的节点，
          // 用户会因此困惑，必须告知。
          hooks.onEvent(
            {
              type: 'notice',
              level: 'warning',
              message: `${targetStatus === 'undone' ? '撤销' : '删除'}后未能同步源侧上下文（${err instanceof Error ? err.message : String(err)}），后续对话中 AI 可能仍记得这部分内容`,
              ts: Date.now(),
            },
            '',
          );
        }
      }
    } else if (branch && sourceSessionId && !parentNode) {
      // 撤销首个节点（无父节点）：清空 sourceSessionId，下次 prompt 新建 session
      branch.sourceSessionId = undefined;
    }

    // 2. 标记目标节点 + 所有后代（此处重新计算后代，不复用 subtreeIds：被中止的流可能在此期间
    //    刚落盘了 assistant 节点，需一并标记；目标节点排在首位先标，之后才落盘的 assistant
    //    由 TurnRunner 的只读重读防护以同状态落盘，两层合拢无窗口）
    //    注意：undo 不应使已删除（hidden）的后代重新浮现——删除是比撤销更强的移除，
    //    撤销父节点不能复活之前被删除的子节点（hidden 优先于 undone）
    for (const id of [nodeId, ...this.deps.session.getDescendantIds(treeId, nodeId)]) {
      const current = this.deps.session.getNode(treeId, id);
      if (shouldSkipDescendantMark(targetStatus, current?.status)) continue;
      await this.deps.session.updateNode(treeId, id, { status: targetStatus });
    }

    // 3. 回退 headNodeId 到父节点
    if (parentNode) {
      await this.deps.session.switchHead(treeId, parentNode.id).catch(() => {});
    }
    hooks.onTreeUpdated(treeId, parentNode?.id ?? null);
  }

  /**
   * 将 done 返回的源 sessionId 同步到分支（持久化 + 内存，send/continue 共用）；
   * sourceId 提供时同步分支源标记（branch.agentId，abort/fork 按分支源解析用）
   */
  syncBranchSession = async (
    treeId: string,
    branch: ConversationBranch | undefined,
    sessionId: string | undefined,
    sourceId?: string,
  ): Promise<void> => {
    if (branch && sourceId && branch.agentId !== sourceId) {
      branch.agentId = sourceId;
    }
    if (sessionId && branch && branch.sourceSessionId !== sessionId) {
      await this.deps.session.setBranchSession(treeId, branch.id, sessionId);
      branch.sourceSessionId = sessionId;
    }
  };
}
