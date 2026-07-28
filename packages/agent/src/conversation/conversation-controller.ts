/**
 * ConversationController — 会话编排核心（传输无关）
 *
 * 从 web/routes/agents.ts 下沉的业务编排：send / continue / retry / undo / delete / fork / abort。
 * web 层只负责 WS 消息 ↔ controller 方法 + hooks 回调的薄适配。
 *
 * 设计要点：
 *   - 单一 SessionContext 聚合原散落的 4 个 Map（source/tree/abort/queue）
 *   - send/continue/retry 按 session 串行（队列锁），undo/delete 立即执行
 *   - 事件转换统一走 StreamAccumulator（消灭重复）
 *   - 中断态用 node.status='interrupted' 单一真相（不再用 metadata.interrupted）
 */
import type {
  SourceEvent,
  ConversationBranch,
  ISource,
  ISourceRegistry,
  NodeContent,
} from '@qcqx/lattice-agent-protocol';
import {
  StreamAccumulator,
  canApplyOperation,
  shouldSkipDescendantMark,
  isBranchableChild,
  isReadOnly,
} from '@qcqx/lattice-agent-protocol';
import type { SessionManager } from '../session/session-manager.js';

/** 每个 WS session 的运行时状态（聚合原 4 个 Map） */
export interface SessionContext {
  sessionId: string;
  sourceId: string;
  treeId: string | null;
  /** 进行中请求：requestId → AbortController */
  abortControllers: Map<string, AbortController>;
  /** send 串行锁 */
  queue: Promise<void>;
}

/** 传输层注入的回调（controller 不感知 WS） */
export interface ConversationHooks {
  onEvent: (event: SourceEvent, requestId: string) => void;
  onError: (message: string, requestId?: string) => void;
  onTreeUpdated: (treeId: string, headNodeId: string | null, requestId?: string) => void;
  /** 首条消息懒创建树后触发（传输层发 session.created） */
  onTreeCreated?: (treeId: string) => void;
}

export interface SendOpts {
  parentNodeId?: string | null;
  branchId?: string;
  requestId: string;
  model?: string;
}

export interface ConversationControllerDeps {
  session: SessionManager;
  /** 仅依赖源注册表抽象（protocol），不绑定具体源包 */
  sources: { registry: ISourceRegistry };
}

export class ConversationController {
  private sessions = new Map<string, SessionContext>();

  constructor(private readonly deps: ConversationControllerDeps) {}

  // ── Session 生命周期 ──

  createSession(sessionId: string, sourceId: string, treeId: string | null): SessionContext {
    const ctx: SessionContext = {
      sessionId,
      sourceId,
      treeId,
      abortControllers: new Map(),
      queue: Promise.resolve(),
    };
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
    const source = this.deps.sources.registry.getSource(ctx.sourceId);
    await source?.destroySession(sessionId);
    // 清理关联的 streaming 文件（避免误判为中断）
    if (ctx.treeId) {
      const interrupted = await this.deps.session.getInterruptedStreams(ctx.treeId);
      for (const s of interrupted) {
        await this.deps.session.clearStreaming(ctx.treeId, s.requestId);
      }
    }
    this.sessions.delete(sessionId);
  }

  // ── 串行锁 ──

  /**
   * 将任务串入 session 队列（同一 session 的写操作串行，避免 updateNode/addNode 交错导致落盘竞态）。
   * 返回 Promise 供需要同步等待完成的操作（undo/delete）使用。
   */
  private enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return Promise.resolve();
    const run = ctx.queue.then(task).catch(() => {});
    ctx.queue = run;
    void run.finally(() => {
      if (ctx.queue === run) ctx.queue = Promise.resolve();
    });
    return run;
  }

  // ── 对话操作 ──

  send(sessionId: string, message: string, opts: SendOpts, hooks: ConversationHooks): void {
    this.enqueue(sessionId, () => this.doSend(sessionId, message, opts, hooks));
  }

  continue(sessionId: string, nodeId: string, requestId: string, hooks: ConversationHooks): void {
    this.enqueue(sessionId, () => this.doContinue(sessionId, nodeId, requestId, hooks));
  }

  retry(sessionId: string, nodeId: string, requestId: string, hooks: ConversationHooks): void {
    this.enqueue(sessionId, () => this.doRetry(sessionId, nodeId, requestId, hooks));
  }

  /** 撤销：目标节点及后代标记 undone（只读灰色），源 fork 截断到父节点；串行执行避免与在途流式竞态 */
  undo(sessionId: string, nodeId: string, hooks: ConversationHooks): Promise<void> {
    return this.enqueue(sessionId, () => this.markNodes(sessionId, nodeId, 'undone', hooks));
  }

  /** 删除：撤销 + 隐藏（树中不展示）；串行执行避免与在途流式竞态 */
  delete(sessionId: string, nodeId: string, hooks: ConversationHooks): Promise<void> {
    return this.enqueue(sessionId, () => this.markNodes(sessionId, nodeId, 'hidden', hooks));
  }

  abort(sessionId: string, requestId?: string): void {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;
    if (requestId) {
      const ctrl = ctx.abortControllers.get(requestId);
      if (ctrl) {
        ctrl.abort();
        ctx.abortControllers.delete(requestId);
      }
      return;
    }
    // 中止整个 session：abort 各分支的源 session
    const source = this.deps.sources.registry.getSource(ctx.sourceId);
    const tree = ctx.treeId ? this.deps.session.getTree(ctx.treeId) : undefined;
    for (const b of tree?.branches ?? []) {
      if (b.sourceSessionId) source?.abort(b.sourceSessionId);
    }
  }

  /** 按 requestId 中止（socket 断开时用，跨 session 查找） */
  abortByRequestId(requestId: string): void {
    for (const ctx of this.sessions.values()) {
      const ctrl = ctx.abortControllers.get(requestId);
      if (ctrl) {
        ctrl.abort();
        ctx.abortControllers.delete(requestId);
        return;
      }
    }
  }

  // ── 树操作 ──

  /** fork 分支（含源级 fork 截断） */
  async fork(
    treeId: string,
    nodeId: string,
    name?: string,
  ): Promise<ConversationBranch | undefined> {
    const branch = await this.deps.session.fork(treeId, nodeId, name);
    const ctx = this.contextByTreeId(treeId);
    const source = ctx ? this.deps.sources.registry.getSource(ctx.sourceId) : undefined;
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
      } catch {
        /* fork 失败时新分支从空白开始 */
      }
    }
    return branch;
  }

  // ── 内部实现 ──

  private async doSend(
    sessionId: string,
    message: string,
    opts: SendOpts,
    hooks: ConversationHooks,
  ): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;
    const source = this.deps.sources.registry.getSource(ctx.sourceId);
    if (!source) {
      hooks.onError('Session source not found');
      return;
    }

    // 懒创建对话树（第一条消息时才创建）
    if (!ctx.treeId) {
      const tree = await this.deps.session.createTree({});
      ctx.treeId = tree.id;
      hooks.onTreeCreated?.(tree.id);
    }
    const treeId = ctx.treeId!;
    const tree = this.deps.session.getTree(treeId);

    // 解析实际父节点（若 parentNodeId 是 user 节点，链接到它的 assistant 子节点）
    let actualParentId: string | null = null;
    if (opts.parentNodeId) {
      const assistantChild = this.deps.session
        .getNodes(treeId)
        .find((n) => n.parentId === opts.parentNodeId && n.role === 'assistant');
      actualParentId = assistantChild?.id ?? opts.parentNodeId;
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

    // 首条消息设置树标题
    const t = this.deps.session.getTree(treeId);
    if (t && !t.title) {
      t.title = message.slice(0, 30) + (message.length > 30 ? '...' : '');
    }

    // 持久化 user 节点（prompt 前，确保用户消息永不丢失）
    const userNode = await this.deps.session.addNode(treeId, {
      id: opts.requestId,
      parentId: actualParentId,
      role: 'user',
      content: [{ type: 'text', text: message }],
      branchId: autoForked || opts.branchId ? branch?.id : undefined,
    });

    await this.runPrompt(
      ctx,
      {
        message,
        userNodeId: userNode.id,
        branch,
        sourceSessionId,
        requestId: opts.requestId,
        model: opts.model,
      },
      hooks,
    );
  }

  private async doContinue(
    sessionId: string,
    nodeId: string,
    requestId: string,
    hooks: ConversationHooks,
  ): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx || !ctx.treeId) return;
    const source = this.deps.sources.registry.getSource(ctx.sourceId);
    if (!source) {
      hooks.onError('Source not found');
      return;
    }
    const treeId = ctx.treeId;
    const tree = this.deps.session.getTree(treeId);
    if (!tree) return;

    // client 发的是 turnId（user 节点 id），找到它的 assistant 子节点来续写
    // （retry 后可能有多个 assistant 子节点，优先选 active 的）
    // 只续写可操作（非 undone/hidden）的 assistant；若全是只读节点则不续写（防护）
    let node = this.deps.session.getNode(treeId, nodeId);
    if (node && node.role === 'user') {
      node = this.deps.session
        .getNodes(treeId)
        .filter((n) => n.parentId === node!.id && n.role === 'assistant')
        .find((n) => !isReadOnly(n.status));
    }
    if (!node || node.role !== 'assistant') return;

    const branch = tree.branches.find((b) => b.id === (node.branchId ?? tree.defaultBranchId));
    const sourceSessionId = branch?.sourceSessionId ?? null;

    // 续写（"Continue" 是 API 协议需要，树中不展示）
    const acc = await this.streamSource(
      ctx,
      source,
      sourceSessionId,
      'Continue',
      requestId,
      undefined,
      hooks,
    );
    const interrupted = acc.interrupted;

    if (acc.accumulator.content.length > 0) {
      const existingContent = node.content ?? [];
      await this.deps.session.updateNode(treeId, node.id, {
        content: [...existingContent, ...acc.accumulator.content],
        metadata: { ...node.metadata, ...acc.accumulator.nodeMetadata },
        status: interrupted ? 'interrupted' : 'active',
      });
    }
    await this.syncBranchSession(treeId, branch, acc.accumulator.sessionId);
    hooks.onTreeUpdated(treeId, node.id, requestId);
  }

  private async doRetry(
    sessionId: string,
    nodeId: string,
    requestId: string,
    hooks: ConversationHooks,
  ): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx || !ctx.treeId) return;
    const source = this.deps.sources.registry.getSource(ctx.sourceId);
    if (!source) {
      hooks.onError('Source not found');
      return;
    }
    const treeId = ctx.treeId;
    const tree = this.deps.session.getTree(treeId);
    if (!tree) return;

    const userNode = this.deps.session.getNode(treeId, nodeId);
    if (!userNode || userNode.role !== 'user') return;
    // 只读终态防护：已撤销/已删除的 user 节点不可重试
    if (!canApplyOperation('retry', userNode.status)) return;

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
      } catch {
        /* fork 失败降级：复用原 session */
      }
    } else if (branch) {
      branch.sourceSessionId = undefined;
      retrySessionId = null;
    }

    // 4. 复用原 user 节点重新 prompt（只新建 assistant 子节点）
    const originalMessage = userNode.content
      .filter((c): c is Extract<NodeContent, { type: 'text' }> => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    await this.runPrompt(
      ctx,
      {
        message: originalMessage,
        userNodeId: userNode.id,
        branch,
        sourceSessionId: retrySessionId,
        requestId,
      },
      hooks,
    );
  }

  /** undo/delete 共用：fork 截断到父节点 + 标记目标及后代 */
  private async markNodes(
    sessionId: string,
    nodeId: string,
    targetStatus: 'undone' | 'hidden',
    hooks: ConversationHooks,
  ): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx || !ctx.treeId) return;
    const treeId = ctx.treeId;
    const tree = this.deps.session.getTree(treeId);
    if (!tree) return;
    const node = this.deps.session.getNode(treeId, nodeId);
    if (!node) return;
    // 只读终态防护（状态机守卫）：undo 不作用于已 undone/hidden；delete 不作用于已 hidden（undone→hidden 合法）
    if (!canApplyOperation(targetStatus === 'undone' ? 'undo' : 'delete', node.status)) return;

    const parentNode = node.parentId ? this.deps.session.getNode(treeId, node.parentId) : null;
    const branch = tree.branches.find((b) => b.id === (node.branchId ?? tree.defaultBranchId));
    const sourceSessionId = branch?.sourceSessionId ?? null;

    // 1. Fork 截断到父节点的消息
    if (sourceSessionId && parentNode) {
      const source = this.deps.sources.registry.getSource(ctx.sourceId);
      const parentSourceMsgId = parentNode.metadata?.sourceMessageId;
      if (source) {
        try {
          const newSessionId = await source.forkSession(sourceSessionId, parentSourceMsgId);
          if (branch && newSessionId !== sourceSessionId) {
            await this.deps.session.setBranchSession(treeId, branch.id, newSessionId);
          }
        } catch {
          /* fork 失败不影响树层操作 */
        }
      }
    } else if (branch && sourceSessionId && !parentNode) {
      // 撤销首个节点（无父节点）：清空 sourceSessionId，下次 prompt 新建 session
      branch.sourceSessionId = undefined;
    }

    // 2. 标记目标节点 + 所有后代
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
   * 将 done 返回的源 sessionId 同步到分支（持久化 + 内存，send/continue 共用）
   */
  private async syncBranchSession(
    treeId: string,
    branch: ConversationBranch | undefined,
    sessionId: string | undefined,
  ): Promise<void> {
    if (sessionId && branch && branch.sourceSessionId !== sessionId) {
      await this.deps.session.setBranchSession(treeId, branch.id, sessionId);
      branch.sourceSessionId = sessionId;
    }
  }

  /**
   * 通用流式 prompt + assistant 节点持久化（send/retry 共用）
   */
  private async runPrompt(
    ctx: SessionContext,
    opts: {
      message: string;
      userNodeId: string;
      branch: ConversationBranch | undefined;
      sourceSessionId: string | null;
      requestId: string;
      model?: string;
    },
    hooks: ConversationHooks,
  ): Promise<void> {
    const treeId = ctx.treeId;
    if (!treeId) return;
    const source = this.deps.sources.registry.getSource(ctx.sourceId);
    if (!source) {
      hooks.onError('Source not found', opts.requestId);
      return;
    }

    const { accumulator, interrupted } = await this.streamSource(
      ctx,
      source,
      opts.sourceSessionId,
      opts.message,
      opts.requestId,
      opts.userNodeId,
      hooks,
      opts.model,
    );

    // 捕获新 sessionId（新建时源返回，续写时不变）
    await this.syncBranchSession(treeId, opts.branch, accumulator.sessionId);

    // 持久化 assistant 节点
    // 中断时即使无内容（如首 token 前中止）也要落盘 interrupted 节点，
    // 否则 reload 后会因缺少 assistant 节点被误判为 done 空节点，丢失中断态与继续按钮
    let headNodeId: string | null = opts.userNodeId;
    if (accumulator.content.length > 0 || interrupted) {
      const node = await this.deps.session.addNode(treeId, {
        parentId: opts.userNodeId,
        role: 'assistant',
        content:
          accumulator.content.length > 0 ? accumulator.content : [{ type: 'text', text: '' }],
        agentId: ctx.sourceId,
        metadata: accumulator.nodeMetadata,
        ...(interrupted ? { status: 'interrupted' as const } : {}),
      });
      headNodeId = node.id;
    }
    hooks.onTreeUpdated(treeId, headNodeId, opts.requestId);
  }

  /**
   * 流式调用源 + 每 delta 写 streaming 文件（崩溃恢复用）
   * 返回累加器与中断标志；正常结束（含优雅中止）后清理 streaming 文件
   */
  private async streamSource(
    ctx: SessionContext,
    source: ISource,
    sourceSessionId: string | null,
    message: string,
    requestId: string,
    persistParentId: string | undefined,
    hooks: ConversationHooks,
    model?: string,
  ): Promise<{ accumulator: StreamAccumulator; interrupted: boolean }> {
    const accumulator = new StreamAccumulator();
    const abortController = new AbortController();
    ctx.abortControllers.set(requestId, abortController);
    const streamStartedAt = Date.now();
    const treeId = ctx.treeId;

    const persistStreaming = async () => {
      if (!treeId || !persistParentId) return;
      await this.deps.session.writeStreaming(treeId, {
        requestId,
        parentId: persistParentId,
        role: 'assistant',
        startedAt: streamStartedAt,
        content: accumulator.content,
      });
    };

    try {
      for await (const event of source.prompt(sourceSessionId, [{ type: 'text', text: message }], {
        signal: abortController.signal,
        model,
      })) {
        accumulator.apply(event);
        await persistStreaming();
        hooks.onEvent(event, requestId);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // 仅真实错误（非用户中止）记入内容并通知客户端：
      //   落盘 error 内容块 → reload 后投影为 error，与 live（session.error 设 'error'）一致；
      //   用户中止保持 interrupted（客户端已乐观设置，不发 error 避免覆盖）。
      if (!abortController.signal.aborted) {
        accumulator.apply({
          type: 'error',
          message: errMsg,
          code: 'unknown',
          retryable: false,
          source: { id: source.id, name: source.displayName },
        });
        hooks.onError(errMsg, requestId);
      }
      await persistStreaming();
    } finally {
      ctx.abortControllers.delete(requestId);
    }

    const interrupted = abortController.signal.aborted || !accumulator.done;

    // 正常结束（含优雅中止）清理 streaming 文件；崩溃时不会走到这里，文件保留供恢复
    if (treeId && persistParentId) {
      await this.deps.session.clearStreaming(treeId, requestId);
    }

    return { accumulator, interrupted };
  }
}
