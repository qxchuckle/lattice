/**
 * ConversationController — 会话编排核心（传输无关）
 *
 * 从 web/routes/agents.ts 下沉的业务编排：send / continue / retry / undo / delete / fork / abort。
 * web 层只负责 WS 消息 ↔ controller 方法 + hooks 回调的薄适配。
 *
 * 设计要点：
 *   - 单一 SessionContext 聚合原散落的 4 个 Map（source/tree/abort/queue）
 *   - 并发模型：树结构变更（fork/addNode/标记）按 session 串行（快操作，queue）；
 *     流式按分支串行、跨分支并行（streamQueues：同一源 session 不可并发 prompt，
 *     不同线程/分支互不阻塞）；undo/delete 立即执行（不等在途流式），
 *     先中止目标子树内的在途请求，落盘竞态由 SessionRepository per-tree 写锁兼容
 *   - 事件转换统一走 StreamAccumulator（消灭重复）
 *   - 中断态用 node.status='interrupted' 单一真相（不再用 metadata.interrupted）
 */
import type {
  SourceEvent,
  ConversationBranch,
  ISource,
  ISourceRegistry,
  NodeContent,
  PromptSegment,
  ContentBlock,
} from '@qcqx/lattice-agent-protocol';
import {
  StreamAccumulator,
  canApplyOperation,
  shouldSkipDescendantMark,
  isBranchableChild,
  isReadOnly,
} from '@qcqx/lattice-agent-protocol';
import type { SessionManager } from '../session/session-manager.js';
import { composePrompt } from '../prompt/prompt-composer.js';
import type { PromptComposerDeps } from '../prompt/prompt-composer.js';

/** 每个 WS session 的运行时状态（轻量：连接身份 + 当前树）；锁域在 TreeRuntime */
export interface SessionContext {
  sessionId: string;
  sourceId: string;
  treeId: string | null;
}

/**
 * per-tree 运行时锁域（多连接共享）：同一 treeId 的多个连接共用同一 TreeRuntime，
 * 保证同源 session 不并发 prompt；树创建前用 `session:<sid>` bootstrap key 兑底（单连接）。
 */
interface TreeRuntime {
  /** 进行中请求：requestId → AbortController */
  abortControllers: Map<string, AbortController>;
  /** 树结构变更串行锁（快操作：fork/addNode/标记，不含流式） */
  queue: Promise<void>;
  /** 分支级流式队列：branchId → 队尾 Promise（同分支串行，跨分支并行） */
  streamQueues: Map<string, Promise<void>>;
}

/** 传输层注入的回调（controller 不感知 WS） */
export interface ConversationHooks {
  onEvent: (event: SourceEvent, requestId: string) => void;
  onError: (message: string, requestId?: string) => void;
  onTreeUpdated: (treeId: string, headNodeId: string | null, requestId?: string) => void;
  /** 首条消息懒创建树后触发（传输层发 session.created） */
  onTreeCreated?: (treeId: string) => void;
  /** 命令被状态机/只读守卫拒绝（发起端据此回滚乐观态或重拉，避免静默发散） */
  onReject?: (requestId: string | undefined, reason: string) => void;
  /** 在途流被中止（撤销/删除子树时）：广播给订阅端停渲染 */
  onStreamAborted?: (treeId: string, requestId: string, reason: string) => void;
}

export interface SendOpts {
  parentNodeId?: string | null;
  branchId?: string;
  requestId: string;
  model?: string;
  /** 思考深度/上下文窗口（取值由模型 tuning 规格约束，透传源） */
  thinkingLevel?: string;
  contextWindow?: number;
  /** 指定源（仅新第一层线程生效；追问时沿祖先链解析线程源） */
  sourceId?: string;
  /** 结构化输入段（chip 编辑器）；提供时编排层展开，message 作 displayText 兜底 */
  segments?: PromptSegment[];
}

export interface ConversationControllerDeps {
  session: SessionManager;
  /** 仅依赖源注册表抽象（protocol），不绑定具体源包 */
  sources: { registry: ISourceRegistry };
  /** 结构化输入展开依赖（本地命令模板/引用解析；缺省：命令透传 slash 文本、引用保留显示文本） */
  promptDeps?: PromptComposerDeps;
  /** 按线程源生成 system prompt 追加段（skills 可用清单等，渐进披露）；undefined/空串 = 不追加 */
  systemPromptAppendix?: (sourceId: string) => Promise<string | undefined>;
}

export class ConversationController {
  private sessions = new Map<string, SessionContext>();
  /** per-tree 运行时锁域（key = treeId 或 `session:<sid>` bootstrap） */
  private runtimes = new Map<string, TreeRuntime>();

  constructor(private readonly deps: ConversationControllerDeps) {}

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

  // ── 串行锁（per-tree 运行时锁域） ──

  /** 锁域 key：树存在用 treeId（多连接共享），未创建用 session bootstrap */
  private runtimeKey(ctx: SessionContext): string {
    return ctx.treeId ?? `session:${ctx.sessionId}`;
  }

  /** 取/建该 session 当前锁域（per-tree；懒建树前退化为 per-session bootstrap） */
  private rtOf(ctx: SessionContext): TreeRuntime {
    const key = this.runtimeKey(ctx);
    let rt = this.runtimes.get(key);
    if (!rt) {
      rt = { abortControllers: new Map(), queue: Promise.resolve(), streamQueues: new Map() };
      this.runtimes.set(key, rt);
    }
    return rt;
  }

  /** 测试/传输层访问该 session 的运行时锁域 */
  getRuntime(sessionId: string): TreeRuntime | undefined {
    const ctx = this.sessions.get(sessionId);
    return ctx ? this.rtOf(ctx) : undefined;
  }

  /**
   * 将任务串入结构队列（树结构变更串行，避免 fork/addNode 交错）。
   * 仅包含快操作：流式部分由 scheduleStream 调度到分支队列，不占用本队列。
   */
  private enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return Promise.resolve();
    const rt = this.rtOf(ctx);
    const run = rt.queue.then(task).catch(() => {});
    rt.queue = run;
    void run.finally(() => {
      if (rt.queue === run) rt.queue = Promise.resolve();
    });
    return run;
  }

  /**
   * 流式任务按分支串行、跨分支并行：同一源 session（= 分支）不能并发 prompt，
   * 不同线程/分支的回答同时推送，互不阻塞。锁域 per-tree，多连接共享。
   */
  private scheduleStream(
    ctx: SessionContext,
    branchId: string | undefined,
    task: () => Promise<void>,
  ): void {
    const rt = this.rtOf(ctx);
    const key = branchId ?? '__default__';
    const prev = rt.streamQueues.get(key) ?? Promise.resolve();
    const run = prev.then(task).catch(() => {});
    rt.streamQueues.set(key, run);
    void run.finally(() => {
      if (rt.streamQueues.get(key) === run) rt.streamQueues.delete(key);
    });
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

  /**
   * 撤销：目标节点及后代标记 undone（只读灰色），源 fork 截断到父节点。
   * 立即执行不排队：若走 session 队列会被在途流式卡住直到生成结束（UI 表现为点了没反应）。
   * 与在途流式的竞态由两层化解：markNodes 先中止子树内请求 + runPrompt 落盘前重读父节点状态。
   */
  undo(sessionId: string, nodeId: string, hooks: ConversationHooks): Promise<void> {
    return this.markNodes(sessionId, nodeId, 'undone', hooks);
  }

  /** 删除：撤销 + 隐藏（树中不展示）；同 undo 立即执行不排队 */
  delete(sessionId: string, nodeId: string, hooks: ConversationHooks): Promise<void> {
    return this.markNodes(sessionId, nodeId, 'hidden', hooks);
  }

  abort(sessionId: string, requestId?: string): void {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;
    if (requestId) {
      const rt = this.rtOf(ctx);
      const ctrl = rt.abortControllers.get(requestId);
      if (ctrl) {
        ctrl.abort();
        rt.abortControllers.delete(requestId);
      }
      return;
    }
    // 中止整个 session：abort 各分支的源 session（树可混源，按分支源解析）
    const tree = ctx.treeId ? this.deps.session.getTree(ctx.treeId) : undefined;
    for (const b of tree?.branches ?? []) {
      if (!b.sourceSessionId) continue;
      const source = this.deps.sources.registry.getSource(b.agentId ?? ctx.sourceId);
      source?.abort(b.sourceSessionId);
    }
  }

  /** 按 requestId 中止（socket 断开时用，跨 session 查找） */
  abortByRequestId(requestId: string): void {
    for (const rt of this.runtimes.values()) {
      const ctrl = rt.abortControllers.get(requestId);
      if (ctrl) {
        ctrl.abort();
        rt.abortControllers.delete(requestId);
        return;
      }
    }
  }

  /** 中止某树全部在途流（订阅者归零宽限到期时由传输层调用，避免无人观看仍烧 token） */
  abortTreeStreams(treeId: string): void {
    const rt = this.runtimes.get(treeId);
    if (!rt) return;
    for (const [rid, ctrl] of rt.abortControllers) {
      ctrl.abort();
      rt.abortControllers.delete(rid);
    }
  }

  // ── 树操作 ──

  /** fork 分支（含源级 fork 截断）；源按 fork 节点所在线程解析（树可混源） */
  async fork(
    treeId: string,
    nodeId: string,
    name?: string,
  ): Promise<ConversationBranch | undefined> {
    const ctx = this.contextByTreeId(treeId);
    const threadSourceId = this.resolveNodeSourceId(treeId, nodeId) ?? ctx?.sourceId;
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
      } catch {
        /* fork 失败时新分支从空白开始 */
      }
    }
    return branch;
  }

  // ── 内部实现 ──

  /**
   * 解析节点所在线程的源：自身 agentId → assistant 子节点 agentId → 沿祖先链向上。
   * 源是第一层线程属性：后代继承，不可中途切换。
   */
  private resolveNodeSourceId(treeId: string, nodeId: string): string | undefined {
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

  private async doSend(
    sessionId: string,
    message: string,
    opts: SendOpts,
    hooks: ConversationHooks,
  ): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;

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
      ? (this.resolveNodeSourceId(treeId, actualParentId) ?? opts.sourceId ?? ctx.sourceId)
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
    // ContentBlock text/image 与 NodeContent 同构（composer 不产 file 块）
    const userNode = await this.deps.session.addNode(treeId, {
      id: opts.requestId,
      parentId: actualParentId,
      role: 'user',
      content: promptBlocks.filter((b) => b.type !== 'file') as NodeContent[],
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
    this.scheduleStream(ctx, branch?.id, () =>
      this.runPrompt(
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
    sessionId: string,
    nodeId: string,
    requestId: string,
    hooks: ConversationHooks,
  ): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx || !ctx.treeId) return;
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
    if (!node || node.role !== 'assistant') {
      hooks.onReject?.(requestId, '无可续写的活跃节点');
      return;
    }

    // 源按节点所在线程解析（树可混源）
    const source = this.deps.sources.registry.getSource(
      this.resolveNodeSourceId(treeId, node.id) ?? ctx.sourceId,
    );
    if (!source) {
      hooks.onError('Source not found');
      return;
    }

    const branch = tree.branches.find((b) => b.id === (node.branchId ?? tree.defaultBranchId));
    const targetId = node.id;

    // 续写流调度到分支队列（跨分支并行，不占结构队列）
    this.scheduleStream(ctx, branch?.id, async () => {
      // 排队期间节点可能被撤销/删除：不再请求模型，仅通知一次闭合请求生命周期
      const current = this.deps.session.getNode(treeId, targetId);
      if (!current || isReadOnly(current.status)) {
        hooks.onTreeUpdated(treeId, tree.headNodeId ?? null, requestId);
        return;
      }
      // 排队后取最新源 session（同分支前序流可能刚更新 sourceSessionId）
      const sourceSessionId = branch?.sourceSessionId ?? null;

      // 续写（"Continue" 是 API 协议需要，树中不展示）；复用原节点模型/参数
      const acc = await this.streamSource(
        ctx,
        source,
        sourceSessionId,
        [{ type: 'text', text: 'Continue' }],
        requestId,
        undefined,
        hooks,
        {
          model: current.metadata?.model,
          thinkingLevel: current.metadata?.thinkingLevel,
          contextWindow: current.metadata?.contextWindow,
        },
      );
      const interrupted = acc.interrupted;

      if (acc.accumulator.content.length > 0) {
        // 落盘前重读：流式期间被撤销/删除则不追加内容、不覆盖只读状态
        const latest = this.deps.session.getNode(treeId, targetId);
        if (latest && !isReadOnly(latest.status)) {
          const existingContent = latest.content ?? [];
          await this.deps.session.updateNode(treeId, targetId, {
            content: [...existingContent, ...acc.accumulator.content],
            metadata: { ...latest.metadata, ...acc.accumulator.nodeMetadata },
            status: interrupted ? 'interrupted' : 'active',
          });
        }
      }
      await this.syncBranchSession(treeId, branch, acc.accumulator.sessionId);
      hooks.onTreeUpdated(treeId, targetId, requestId);
    });
  }

  private async doRetry(
    sessionId: string,
    nodeId: string,
    requestId: string,
    hooks: ConversationHooks,
  ): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx || !ctx.treeId) return;
    const treeId = ctx.treeId;
    const tree = this.deps.session.getTree(treeId);
    if (!tree) return;

    const userNode = this.deps.session.getNode(treeId, nodeId);
    if (!userNode || userNode.role !== 'user') return;
    // 只读终态防护：已撤销/已删除的 user 节点不可重试
    if (!canApplyOperation('retry', userNode.status)) {
      hooks.onReject?.(requestId, '节点已撤销/删除，不可重试');
      return;
    }

    // 源按节点所在线程解析（树可混源）；模型复用原节点模型
    const retrySourceId = this.resolveNodeSourceId(treeId, userNode.id) ?? ctx.sourceId;
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
      } catch {
        /* fork 失败降级：复用原 session */
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

    this.scheduleStream(ctx, branch?.id, () =>
      this.runPrompt(
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
    if (!canApplyOperation(targetStatus === 'undone' ? 'undo' : 'delete', node.status)) {
      hooks.onReject?.(undefined, '节点已处于只读终态，操作无效');
      return;
    }

    const parentNode = node.parentId ? this.deps.session.getNode(treeId, node.parentId) : null;
    const branch = tree.branches.find((b) => b.id === (node.branchId ?? tree.defaultBranchId));
    const sourceSessionId = branch?.sourceSessionId ?? null;

    // 0. 中止目标子树内的在途请求（requestId == user 节点 id，send/retry/continue 皆复用 turnId）：
    //    避免流结束后往已只读的 user 节点下挂 active assistant，也避免白烧 token
    const subtreeIds = [nodeId, ...this.deps.session.getDescendantIds(treeId, nodeId)];
    const rtMark = this.rtOf(ctx);
    for (const id of subtreeIds) {
      const ctrl = rtMark.abortControllers.get(id);
      if (ctrl) {
        ctrl.abort();
        rtMark.abortControllers.delete(id);
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
        } catch {
          /* fork 失败不影响树层操作 */
        }
      }
    } else if (branch && sourceSessionId && !parentNode) {
      // 撤销首个节点（无父节点）：清空 sourceSessionId，下次 prompt 新建 session
      branch.sourceSessionId = undefined;
    }

    // 2. 标记目标节点 + 所有后代（此处重新计算后代，不复用 subtreeIds：被中止的流可能在此期间
    //    刚落盘了 assistant 节点，需一并标记；目标节点排在首位先标，之后才落盘的 assistant
    //    由 runPrompt 的只读重读防护以同状态落盘，两层合拢无窗口）
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
  private async syncBranchSession(
    treeId: string,
    branch: ConversationBranch | undefined,
    sessionId: string | undefined,
    sourceId?: string,
  ): Promise<void> {
    if (branch && sourceId && branch.agentId !== sourceId) {
      branch.agentId = sourceId;
    }
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
      blocks: ContentBlock[];
      userNodeId: string;
      branch: ConversationBranch | undefined;
      sourceSessionId: string | null;
      requestId: string;
      model?: string;
      thinkingLevel?: string;
      contextWindow?: number;
      /** 线程源（不传回退 session 默认源） */
      sourceId?: string;
    },
    hooks: ConversationHooks,
  ): Promise<void> {
    const treeId = ctx.treeId;
    if (!treeId) return;

    // 分支队列排队期间 user 节点可能已被撤销/删除：不再请求模型（前端已不接收，
    // 后端不应白烧 token），仅通知一次闭合请求生命周期
    const userNodeAtStart = this.deps.session.getNode(treeId, opts.userNodeId);
    if (userNodeAtStart && isReadOnly(userNodeAtStart.status)) {
      hooks.onTreeUpdated(
        treeId,
        this.deps.session.getTree(treeId)?.headNodeId ?? null,
        opts.requestId,
      );
      return;
    }

    const sourceId = opts.sourceId ?? ctx.sourceId;
    const source = this.deps.sources.registry.getSource(sourceId);
    if (!source) {
      hooks.onError('Source not found', opts.requestId);
      return;
    }

    // 排队后重解析源 session：同分支前序流可能刚捕获/更新了 sourceSessionId，
    // 用设置时的旧值会丢失上下文连续性
    const sourceSessionId = opts.branch
      ? (opts.branch.sourceSessionId ?? null)
      : opts.sourceSessionId;

    const { accumulator, interrupted } = await this.streamSource(
      ctx,
      source,
      sourceSessionId,
      opts.blocks,
      opts.requestId,
      opts.userNodeId,
      hooks,
      {
        model: opts.model,
        thinkingLevel: opts.thinkingLevel,
        contextWindow: opts.contextWindow,
        systemPromptAppendix: await this.deps.systemPromptAppendix?.(sourceId),
      },
    );

    // 捕获新 sessionId（新建时源返回，续写时不变）+ 同步分支源标记
    await this.syncBranchSession(treeId, opts.branch, accumulator.sessionId, sourceId);

    // 持久化 assistant 节点
    // 中断时即使无内容（如首 token 前中止）也要落盘 interrupted 节点，
    // 否则 reload 后会因缺少 assistant 节点被误判为 done 空节点，丢失中断态与继续按钮
    // 只读竞态防护：流式期间 user 节点可能已被撤销/删除（undo/delete 立即执行不排队），
    // assistant 以同样的只读状态落盘保持子树一致，且不推进 head（head 已被 markNodes 回退）
    const userNode = this.deps.session.getNode(treeId, opts.userNodeId);
    const readOnlyStatus = userNode && isReadOnly(userNode.status) ? userNode.status : undefined;

    let headNodeId: string | null = opts.userNodeId;
    if (accumulator.content.length > 0 || interrupted) {
      const node = await this.deps.session.addNode(treeId, {
        parentId: opts.userNodeId,
        role: 'assistant',
        content:
          accumulator.content.length > 0 ? accumulator.content : [{ type: 'text', text: '' }],
        agentId: sourceId,
        metadata: {
          ...accumulator.nodeMetadata,
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
          ...(opts.contextWindow ? { contextWindow: opts.contextWindow } : {}),
        },
        ...(readOnlyStatus
          ? { status: readOnlyStatus, advanceHead: false }
          : interrupted
            ? { status: 'interrupted' as const }
            : {}),
      });
      headNodeId = node.id;
    }
    if (readOnlyStatus) {
      // head/客户端刷新已由 markNodes 处理；仍通知一次以复位 client 的请求生命周期标记
      hooks.onTreeUpdated(
        treeId,
        this.deps.session.getTree(treeId)?.headNodeId ?? null,
        opts.requestId,
      );
      return;
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
    blocks: ContentBlock[],
    requestId: string,
    persistParentId: string | undefined,
    hooks: ConversationHooks,
    promptOpts?: {
      model?: string;
      thinkingLevel?: string;
      contextWindow?: number;
      /** system prompt 追加段（skills 清单等）；空 = 不传，源用自己的默认 prompt */
      systemPromptAppendix?: string;
    },
  ): Promise<{ accumulator: StreamAccumulator; interrupted: boolean }> {
    const accumulator = new StreamAccumulator();
    const abortController = new AbortController();
    const rtStream = this.rtOf(ctx);
    rtStream.abortControllers.set(requestId, abortController);
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
      // 'none' 是"关闭思考"哨兵值（落盘保留以供 retry/continue 复用），
      // 进入源前归一化为不传——所有源看到的要么是有效等级要么完全缺省（协议约定）
      const thinkingLevel =
        promptOpts?.thinkingLevel === 'none' ? undefined : promptOpts?.thinkingLevel;
      // 工具语义表：源层声明的 name → semantic（壳层按语义渲染，不认工具名）
      const semanticMap = new Map(source.getBuiltinTools().map((t) => [t.name, t.category]));
      for await (const rawEvent of source.prompt(sourceSessionId, blocks, {
        signal: abortController.signal,
        model: promptOpts?.model,
        thinkingLevel,
        contextWindow: promptOpts?.contextWindow,
        ...(promptOpts?.systemPromptAppendix
          ? {
              systemPrompt: {
                mode: 'append' as const,
                additional: promptOpts.systemPromptAppendix,
              },
            }
          : {}),
      })) {
        // 时间统一由编排层打点（源层不打点）：内容块吸收 ts，保证 live/reload/多端同一套时间
        const event = { ...rawEvent, ts: Date.now() };
        if (event.type === 'tool_call' && !event.semantic) {
          event.semantic = semanticMap.get(event.name) ?? 'other';
        }
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
      rtStream.abortControllers.delete(requestId);
    }

    const interrupted = abortController.signal.aborted || !accumulator.done;

    // 正常结束（含优雅中止）清理 streaming 文件；崩溃时不会走到这里，文件保留供恢复
    if (treeId && persistParentId) {
      await this.deps.session.clearStreaming(treeId, requestId);
    }

    return { accumulator, interrupted };
  }
}
