/**
 * ConversationController — 会话编排门面（传输无关）
 *
 * 拆分后的职责：**决策与簿记**（跟谁说、说什么、挂在树的哪个位置、谁先谁后），
 * 具体执行委派给三个协作者：
 *   - TreeRuntimeRegistry：per-tree 锁域（结构队列 / 分支流式队列 / 在途请求表）
 *   - TurnRunner：跑一轮 prompt 并落盘（经 pipeline 管线调用源）
 *   - TreeOps：树结构操作（fork / undo / delete / 线程源解析 / 分支会话同步）
 *
 * 设计要点：
 *   - 单一 SessionContext 聚合连接身份 + 当前树
 *   - 并发模型：结构变更按 session 串行；流式按分支串行、跨分支并行；
 *     undo/delete 立即执行（不等在途流式），竞态由「先中止子树请求 + 落盘前重读状态」两层化解
 *   - 中断态用 node.status='interrupted' 单一真相（不用 metadata.interrupted）
 */
import type { ConversationBranch, NodeContent, ContentBlock } from '@qcqx/lattice-agent-protocol';
import {
  isBranchableChild,
  isReadOnly,
  shouldSkipDescendantMark,
} from '@qcqx/lattice-agent-protocol';
import { composePrompt } from '../prompt/prompt-composer.js';
import { TreeRuntimeRegistry } from './tree-runtime.js';
import { TurnRunner } from './turn-runner.js';
import { TreeOps } from './tree-ops.js';
import { TurnGuard, type TurnCapabilityMap } from './turn-guard.js';
import type {
  ConversationControllerDeps,
  ConversationHooks,
  SendOpts,
  SessionContext,
  TreeRuntime,
  ForkOutcome,
} from './types.js';

export type {
  SessionContext,
  ConversationHooks,
  SendOpts,
  ConversationControllerDeps,
  TreeRuntime,
} from './types.js';

export class ConversationController {
  private sessions = new Map<string, SessionContext>();
  private readonly runtimes = new TreeRuntimeRegistry();
  private readonly tree: TreeOps;
  private readonly turns: TurnRunner;
  private readonly guard: TurnGuard;

  constructor(private readonly deps: ConversationControllerDeps) {
    this.tree = new TreeOps(deps, this.runtimes);
    this.guard = new TurnGuard(deps, this.tree);
    this.turns = new TurnRunner({
      deps,
      runtimes: this.runtimes,
      syncBranchSession: this.tree.syncBranchSession,
    });
  }

  /**
   * 全树 turn 能力表（server 随 wire 快照下发；派生数据不落盘）。
   * 与命令入口守卫同源 —— client 置灰的操作，接口侧同样拒绝。
   */
  turnCapabilities(treeId: string): TurnCapabilityMap {
    return this.guard.capabilitiesOfTree(treeId);
  }

  // ── Session 生命周期 ──

  createSession(sessionId: string, sourceId: string, treeId: string | null): SessionContext {
    const ctx: SessionContext = { sessionId, sourceId, treeId };
    this.sessions.set(sessionId, ctx);
    return ctx;
  }

  getSession(sessionId: string): SessionContext | undefined {
    return this.sessions.get(sessionId);
  }

  /** 通过 treeId 反查 session（tree.fork 等只有 treeId 的消息用） */
  private contextByTreeId(treeId: string): SessionContext | undefined {
    for (const ctx of this.sessions.values()) {
      if (ctx.treeId === treeId) return ctx;
    }
    return undefined;
  }

  async destroySession(sessionId: string): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;
    // 连接级清理：仅移除 session 绑定。树资源（源会话句柄/streaming 文件）归属树而非连接，
    // 多端共享同一树时不能因某连接离开而拆除（会清掉他端在途流的恢复凭据）；
    // 树资源回收只在显式删除整棵树（SessionManager.deleteTree）时发生。
    this.sessions.delete(sessionId);
  }

  /** 测试/传输层访问该 session 的运行时锁域 */
  getRuntime(sessionId: string): TreeRuntime | undefined {
    const ctx = this.sessions.get(sessionId);
    return ctx ? this.runtimes.of(ctx) : undefined;
  }

  // ── 对话操作 ──

  send(sessionId: string, message: string, opts: SendOpts, hooks: ConversationHooks): void {
    this.withSession(sessionId, (ctx) =>
      this.runtimes.enqueue(ctx, () => this.doSend(ctx, message, opts, hooks)),
    );
  }

  continue(sessionId: string, nodeId: string, requestId: string, hooks: ConversationHooks): void {
    this.withSession(sessionId, (ctx) =>
      this.runtimes.enqueue(ctx, () => this.doContinue(ctx, nodeId, requestId, hooks)),
    );
  }

  retry(sessionId: string, nodeId: string, requestId: string, hooks: ConversationHooks): void {
    this.withSession(sessionId, (ctx) =>
      this.runtimes.enqueue(ctx, () => this.doRetry(ctx, nodeId, requestId, hooks)),
    );
  }

  /**
   * 撤销：目标节点及后代标记 undone（只读灰色），源 fork 截断到父节点。
   * 立即执行不排队：若走 session 队列会被在途流式卡住直到生成结束（UI 表现为点了没反应）。
   * 与在途流式的竞态由两层化解：markNodes 先中止子树内请求 + 落盘前重读父节点状态。
   */
  async undo(sessionId: string, nodeId: string, hooks: ConversationHooks): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;
    await this.tree.markNodes(ctx, nodeId, 'undone', hooks);
  }

  /** 删除：撤销 + 隐藏（树中不展示）；同 undo 立即执行不排队 */
  async delete(sessionId: string, nodeId: string, hooks: ConversationHooks): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;
    await this.tree.markNodes(ctx, nodeId, 'hidden', hooks);
  }

  abort(sessionId: string, requestId?: string): void {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;
    if (requestId) {
      this.runtimes.abortRequest(this.runtimes.of(ctx), requestId);
      return;
    }
    // 中止整个 session：signal 是唯一取消真相——中止本树全部在途请求
    this.runtimes.abortAll(ctx);
  }

  /** 按 requestId 中止（socket 断开时用，跨 session 查找） */
  abortByRequestId(requestId: string): void {
    this.runtimes.abortByRequestId(requestId);
  }

  /** 中止某树全部在途流（订阅者归零宽限到期时由传输层调用，避免无人观看仍烧 token） */
  abortTreeStreams(treeId: string): void {
    this.runtimes.abortTree(treeId);
  }

  // ── 树操作 ──

  /**
   * fork 分支（含源级 fork 截断）；源按 fork 节点所在线程解析（树可混源）。
   * 返回 ForkOutcome：分支已建，但源侧上下文是否继承另看 `contextCarried`。
   * 壳层应将 `notice` 展示给用户（铁律：不静默降级）。
   */
  fork(treeId: string, nodeId: string, name?: string): Promise<ForkOutcome | undefined> {
    return this.tree.fork(treeId, nodeId, name, this.contextByTreeId(treeId)?.sourceId);
  }

  // ── 内部实现 ──

  /** 未知 session 直接忽略（连接已断开的迟到消息），避免每处重复判空 */
  private withSession(sessionId: string, run: (ctx: SessionContext) => void): void {
    const ctx = this.sessions.get(sessionId);
    if (ctx) run(ctx);
  }

  private async doSend(
    ctx: SessionContext,
    message: string,
    opts: SendOpts,
    hooks: ConversationHooks,
  ): Promise<void> {
    // 懒创建对话树（第一条消息时才创建）
    if (!ctx.treeId) {
      const created = await this.deps.session.createTree({});
      ctx.treeId = created.id;
      hooks.onTreeCreated?.(created.id);
    }
    const treeId = ctx.treeId;
    const tree = this.deps.session.getTree(treeId);

    // 解析实际父节点（若 parentNodeId 是 user 节点，链接到它的 assistant 子节点）
    let actualParentId: string | null = null;
    if (opts.parentNodeId) {
      const assistantChild = this.deps.session
        .getNodes(treeId)
        .find((n) => n.parentId === opts.parentNodeId && n.role === 'assistant');
      actualParentId = assistantChild?.id ?? opts.parentNodeId;
    }

    // 只读终态防护（纵深防御）：已撤销/已删除的节点下不可追问/分支
    if (actualParentId) {
      const guardNode = this.deps.session.getNode(treeId, actualParentId);
      if (guardNode && isReadOnly(guardNode.status)) {
        hooks.onError('目标节点已撤销/删除，不能在其下继续对话', opts.requestId);
        return;
      }
    }

    // 线程源解析：新第一层线程用消息指定的源；追问沿祖先链继承线程源（不可中途换源）
    const resolvedSourceId = actualParentId
      ? (this.tree.resolveNodeSourceId(treeId, actualParentId) ?? opts.sourceId ?? ctx.sourceId)
      : (opts.sourceId ?? ctx.sourceId);
    const source = this.deps.sources.registry.getSource(resolvedSourceId);
    if (!source) {
      hooks.onError(`Source not found: ${resolvedSourceId}`, opts.requestId);
      return;
    }

    // 结构化输入展开（编排层唯一展开点：源只收纯内容）：
    // promptBlocks 落盘 + 传源（retry/continue 重发当时展开结果，保证可重现；text+image 保序）；
    // displayText 供树标题；原始 segments 存节点 metadata 供 UI 回显 chip
    let promptBlocks: ContentBlock[] = [{ type: 'text', text: message }];
    let displayText = message;
    if (opts.segments?.length) {
      const composed = await composePrompt(opts.segments, this.deps.promptDeps);
      promptBlocks = composed.blocks;
      displayText = composed.displayText || message;
    }

    // 定位分支：显式 branchId > 父节点分支 > 默认分支
    const actualParent = actualParentId
      ? this.deps.session.getNode(treeId, actualParentId)
      : undefined;
    const resolvedBranchId =
      opts.branchId ??
      actualParent?.branchId ??
      (opts.parentNodeId
        ? this.deps.session.getNode(treeId, opts.parentNodeId)?.branchId
        : undefined);
    let branch = tree?.branches.find((b) => b.id === (resolvedBranchId ?? tree?.defaultBranchId));
    let sourceSessionId = branch?.sourceSessionId ?? null;

    // 第一层线程隔离：虚拟根每次发消息 = 一段全新源对话。
    // 已有活跃第一层线程占用默认分支时，新第一层节点新建独立分支（独立源 session，可换源）
    let newThreadBranch = false;
    if (tree && !actualParentId && !opts.branchId) {
      const hasRootThread = this.deps.session
        .getNodes(treeId)
        .some((n) => n.parentId === null && n.role === 'user' && isBranchableChild(n.status));
      if (hasRootThread) {
        branch = await this.deps.session.fork(treeId, '', undefined, resolvedSourceId);
        sourceSessionId = null;
        newThreadBranch = true;
      }
    }

    // 自动 fork：未显式指定分支 + 实际父节点已有「活跃」 user 子节点 → 兄弟分支
    // （已撤销/已删除的子节点不计入——那些回复路径已移除，重新提问复用当前分支即可）
    let autoForked = false;
    if (tree && actualParent && !opts.branchId && sourceSessionId) {
      const hasUserChild = this.deps.session
        .getNodes(tree.id)
        .some(
          (n) => n.parentId === actualParent.id && n.role === 'user' && isBranchableChild(n.status),
        );
      if (hasUserChild) {
        const atMessage = actualParent.metadata?.sourceMessageId;
        let newBranch: ConversationBranch | undefined;
        try {
          newBranch = await this.deps.session.fork(tree.id, actualParent.id);
          const forkedSessionId = await source.forkSession(sourceSessionId, atMessage);
          await this.deps.session.setBranchSession(tree.id, newBranch.id, forkedSessionId);
          branch = newBranch;
          sourceSessionId = forkedSessionId;
          autoForked = true;
        } catch {
          if (newBranch) {
            await this.deps.session.removeBranch(tree.id, newBranch.id).catch(() => {});
          }
        }
      }
    }

    // 首条消息设置树标题（用户可见形式，非展开后模板全文）
    const t = this.deps.session.getTree(treeId);
    if (t && !t.title) {
      t.title = displayText.slice(0, 30) + (displayText.length > 30 ? '...' : '');
    }

    // 追问未显式指定思考深度/上下文档位时继承线程上一轮（assistant 落盘参数）；模型继承由 client 完成
    const resolvedThinking = opts.thinkingLevel ?? actualParent?.metadata?.thinkingLevel;
    const resolvedContextWindow = opts.contextWindow ?? actualParent?.metadata?.contextWindow;

    // 持久化 user 节点（prompt 前，确保用户消息永不丢失）；记录线程源 + 本次模型/参数
    // 类型谓词收窄：排除 file 后剩下的 text/image 与 NodeContent 同构，编译器可直接验证（免 as）
    const isPersistableBlock = (b: ContentBlock): b is Exclude<ContentBlock, { type: 'file' }> =>
      b.type !== 'file';
    const userNode = await this.deps.session.addNode(treeId, {
      id: opts.requestId,
      parentId: actualParentId,
      role: 'user',
      content: promptBlocks.filter(isPersistableBlock),
      agentId: resolvedSourceId,
      metadata:
        opts.model || resolvedThinking || resolvedContextWindow || opts.segments?.length
          ? {
              ...(opts.model ? { model: opts.model } : {}),
              ...(resolvedThinking ? { thinkingLevel: resolvedThinking } : {}),
              ...(resolvedContextWindow ? { contextWindow: resolvedContextWindow } : {}),
              ...(opts.segments?.length ? { promptSegments: opts.segments } : {}),
            }
          : undefined,
      branchId: autoForked || opts.branchId || newThreadBranch ? branch?.id : undefined,
    });

    // 流式调度到分支队列（不占结构队列）：不同线程/分支的回答并行推送
    this.runtimes.scheduleStream(ctx, branch?.id, () =>
      this.turns.runTurn(
        ctx,
        {
          blocks: promptBlocks,
          userNodeId: userNode.id,
          branch,
          sourceSessionId,
          requestId: opts.requestId,
          model: opts.model,
          thinkingLevel: resolvedThinking,
          contextWindow: resolvedContextWindow,
          sourceId: resolvedSourceId,
        },
        hooks,
      ),
    );
  }

  private async doContinue(
    ctx: SessionContext,
    nodeId: string,
    requestId: string,
    hooks: ConversationHooks,
  ): Promise<void> {
    const treeId = ctx.treeId;
    if (!treeId) return;
    const tree = this.deps.session.getTree(treeId);
    if (!tree) return;

    // 统一守卫：与下发给 UI 的能力同源（接口行为 ≡ 视图）。
    // client 发的是 turnId（user 节点 id）；能力投影已含“可续写的 assistant 存在且中断”语义
    const verdict = this.guard.check(treeId, nodeId, 'continue');
    if (!verdict.ok) {
      hooks.onReject?.(requestId, verdict.reason);
      return;
    }

    // 定位待续写的 assistant 子节点（retry 后可能多个，取非只读的活跃者）
    let node = this.deps.session.getNode(treeId, nodeId);
    if (node && node.role === 'user') {
      const userNodeId = node.id;
      node = this.deps.session
        .getNodes(treeId)
        .filter((n) => n.parentId === userNodeId && n.role === 'assistant')
        .find((n) => !isReadOnly(n.status));
    }
    if (!node || node.role !== 'assistant') {
      hooks.onReject?.(requestId, '无可续写的活跃节点');
      return;
    }

    // 源按节点所在线程解析（树可混源）
    const source = this.deps.sources.registry.getSource(
      this.tree.resolveNodeSourceId(treeId, node.id) ?? ctx.sourceId,
    );
    if (!source) {
      hooks.onError('Source not found');
      return;
    }

    const branch = tree.branches.find((b) => b.id === (node.branchId ?? tree.defaultBranchId));
    const target = node;

    // 续写流调度到分支队列（跨分支并行，不占结构队列）；复用原节点模型/参数
    this.runtimes.scheduleStream(ctx, branch?.id, () =>
      this.turns.runContinuation(
        ctx,
        {
          source,
          targetNodeId: target.id,
          branch,
          requestId,
          fallbackHeadNodeId: tree.headNodeId ?? null,
          model: target.metadata?.model,
          thinkingLevel: target.metadata?.thinkingLevel,
          contextWindow: target.metadata?.contextWindow,
        },
        hooks,
      ),
    );
  }

  private async doRetry(
    ctx: SessionContext,
    nodeId: string,
    requestId: string,
    hooks: ConversationHooks,
  ): Promise<void> {
    const treeId = ctx.treeId;
    if (!treeId) return;
    const tree = this.deps.session.getTree(treeId);
    if (!tree) return;

    const userNode = this.deps.session.getNode(treeId, nodeId);
    if (!userNode || userNode.role !== 'user') return;
    // 统一守卫：只读终态与源 fork 能力两个约束合在一处判（与 UI 置灰同源）
    const verdict = this.guard.check(treeId, nodeId, 'retry');
    if (!verdict.ok) {
      hooks.onReject?.(requestId, verdict.reason);
      return;
    }

    // 源按节点所在线程解析（树可混源）；模型复用原节点模型
    const retrySourceId = this.tree.resolveNodeSourceId(treeId, userNode.id) ?? ctx.sourceId;
    const source = this.deps.sources.registry.getSource(retrySourceId);
    if (!source) {
      hooks.onError('Source not found');
      return;
    }

    // 分支（首轮 user 节点无 branchId，回退默认分支）
    const branch = tree.branches.find((b) => b.id === (userNode.branchId ?? tree.defaultBranchId));
    const sourceSessionId = branch?.sourceSessionId ?? null;

    // 1. 标记所有后代为 undone（跳过已删除 hidden 的后代，不复活——与 undo 一致）
    for (const descId of this.deps.session.getDescendantIds(treeId, nodeId)) {
      if (shouldSkipDescendantMark('undone', this.deps.session.getNode(treeId, descId)?.status)) {
        continue;
      }
      await this.deps.session.updateNode(treeId, descId, { status: 'undone' });
    }

    // 2. fork 点 = 父节点（上一个 assistant）的 sourceMessageId（排除当前 user 消息及回复）
    let forkUpToMsgId: string | undefined;
    if (userNode.parentId) {
      const parentNode = this.deps.session.getNode(treeId, userNode.parentId);
      forkUpToMsgId = parentNode?.metadata?.sourceMessageId;
    }

    // 3. Fork 截断（首轮/无源 session 时清空走新建）
    let retrySessionId = sourceSessionId;
    if (forkUpToMsgId && sourceSessionId) {
      try {
        const newSessionId = await source.forkSession(sourceSessionId, forkUpToMsgId);
        if (branch && newSessionId !== sourceSessionId) {
          await this.deps.session.setBranchSession(treeId, branch.id, newSessionId);
          branch.sourceSessionId = newSessionId;
          retrySessionId = newSessionId;
        }
      } catch (err) {
        // 铁律：不静默降级。fork 截断失败 → 源侧仍带着**旧的失败回复**上下文，
        // 重新生成会被它污染（模型看得到自己上一次的回答）。继续执行但必须告知。
        hooks.onEvent(
          {
            type: 'notice',
            level: 'warning',
            message: `重试未能清除源侧旧回复（${err instanceof Error ? err.message : String(err)}），新回复可能受上次结果影响`,
            ts: Date.now(),
          },
          requestId,
        );
      }
    } else if (branch) {
      branch.sourceSessionId = undefined;
      retrySessionId = null;
    }

    // 4. 复用原 user 节点重新 prompt（只新建 assistant 子节点）；流式调度到分支队列
    // 重发当时展开结果：text + image 全部内容块（图片重试不丢）
    const originalBlocks = userNode.content.filter(
      (c): c is Extract<NodeContent, { type: 'text' | 'image' }> =>
        c.type === 'text' || c.type === 'image',
    );

    this.runtimes.scheduleStream(ctx, branch?.id, () =>
      this.turns.runTurn(
        ctx,
        {
          blocks: originalBlocks,
          userNodeId: userNode.id,
          branch,
          sourceSessionId: retrySessionId,
          requestId,
          model: userNode.metadata?.model,
          thinkingLevel: userNode.metadata?.thinkingLevel,
          contextWindow: userNode.metadata?.contextWindow,
          sourceId: retrySourceId,
        },
        hooks,
      ),
    );
  }
}
