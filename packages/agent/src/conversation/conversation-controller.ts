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
import type {
  ConversationBranch,
  NodeContent,
  ContentBlock,
  QueuedMessage,
  QueueUpdateAction,
} from '@qcqx/lattice-agent-protocol';
import {
  isBranchableChild,
  isReadOnly,
  shouldSkipDescendantMark,
} from '@qcqx/lattice-agent-protocol';
import { randomUUID } from 'node:crypto';
import { composePrompt } from '../prompt/prompt-composer.js';
import { TreeRuntimeRegistry } from './tree-runtime.js';
import { TurnRunner } from './turn-runner.js';
import { TreeOps } from './tree-ops.js';
import { TurnGuard, type TurnCapabilityMap } from './turn-guard.js';
import { advanceSessionState, isTerminalSessionState } from './session-state.js';
import type {
  ConversationControllerDeps,
  ConversationHooks,
  SendOpts,
  SessionContext,
  TreeRuntime,
  ForkOutcome,
  EnqueueOpts,
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
  /** 队列 dispatch 专用 hooks（传输层连接建立时注册；null = 纯 agent 场景不 dispatch） */
  private queueHooks: ConversationHooks | null = null;
  /** 传输层注入的订阅者检查（某树是否还有订阅者）；无订阅者时不 dispatch，避免全断连后无人观看空烧 token。缺省（纯 agent）不限制 */
  private hasSubscribers: ((treeId: string) => boolean) | null = null;
  /** 已 dispatch 未落定的排队消息：requestId（= 消息 ID）→ treeId，供 turn 落定时清 pendingDispatching 标记 */
  private readonly dispatchOwner = new Map<string, string>();
  /**
   * 开放 turn 登记：userNodeId → treeId。doSend 建 user 节点时登记（早于流注册，覆盖 doSend→streamSource 间隙），
   * turn 落定（onTreeUpdated）或终结报错（preflight 失败等无 onTreeUpdated）时注销。
   * tryDispatch 据此判断锚定链 leaf 的 turn 是否仍会产生 assistant：在登记者让位防 user→user，
   * 已落定者（含零内容正常完成/只读 skipped）放行。比“无 assistant 子节点”判据更精确（后者对零内容落定二义）。
   */
  private readonly openTurns = new Map<string, string>();

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
    const ctx: SessionContext = { sessionId, sourceId, treeId, state: 'idle' };
    // 挂接已有树（重连/多端）：树已就绪，直达 active（idle --tree-created--> active）
    if (treeId) ctx.state = advanceSessionState(ctx.state, 'tree-created');
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
    // 终态推进（幂等：destroyed 无出边，重复 destroy 保持原态）；
    // 已排队/在途任务持有的 ctx 引用据此拒绝后续动作（见 rejectIfDestroyed）
    ctx.state = advanceSessionState(ctx.state, 'destroy');
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
    this.withSession(sessionId, (ctx) => {
      if (this.rejectIfDestroyed(ctx, opts.requestId, hooks)) return;
      this.runtimes
        .enqueue(ctx, () => this.doSend(ctx, message, opts, this.withQueueHooks(hooks)))
        .catch((err: unknown) => this.reportTaskError(err, opts.requestId, hooks));
    });
  }

  continue(sessionId: string, nodeId: string, requestId: string, hooks: ConversationHooks): void {
    this.withSession(sessionId, (ctx) => {
      if (this.rejectIfDestroyed(ctx, requestId, hooks)) return;
      this.runtimes
        .enqueue(ctx, () => this.doContinue(ctx, nodeId, requestId, this.withQueueHooks(hooks)))
        .catch((err: unknown) => this.reportTaskError(err, requestId, hooks));
    });
  }

  retry(sessionId: string, nodeId: string, requestId: string, hooks: ConversationHooks): void {
    this.withSession(sessionId, (ctx) => {
      if (this.rejectIfDestroyed(ctx, requestId, hooks)) return;
      this.runtimes
        .enqueue(ctx, () => this.doRetry(ctx, nodeId, requestId, this.withQueueHooks(hooks)))
        .catch((err: unknown) => this.reportTaskError(err, requestId, hooks));
    });
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

  // ── 消息排队（per-tree，传输无关；server 单写权威，client 只镜像） ──

  /**
   * 入队：streaming 期间用户提交的消息进入排队（追加到末尾）。
   * order 用单调递增计数器（不回收），避免删除/重排后 order 碰撞。
   */
  enqueue(treeId: string, opts: EnqueueOpts): QueuedMessage {
    const rt = this.runtimes.ofTree(treeId);
    const msg: QueuedMessage = {
      id: randomUUID(),
      content: opts.content,
      segments: opts.segments,
      order: rt.pendingOrderCounter++,
      createdAt: Date.now(),
      createdBy: opts.createdBy ?? '',
      mode: opts.mode ?? 'queue',
      anchorTurnId: opts.anchorTurnId,
      model: opts.model,
      thinkingLevel: opts.thinkingLevel,
      contextWindow: opts.contextWindow,
      sourceId: opts.sourceId,
    };
    rt.pendingMessages.push(msg);
    this.emitQueueChanged(treeId);
    return msg;
  }

  /** 队列操作（重排/删除/编辑/模式切换）；结构变更后重编 order 保持稠密 */
  queueUpdate(treeId: string, messageId: string, update: QueueUpdateAction): void {
    const rt = this.runtimes.ofTree(treeId);
    const idx = rt.pendingMessages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    switch (update.action) {
      case 'reorder': {
        const [msg] = rt.pendingMessages.splice(idx, 1);
        const target = Math.min(update.newIndex, rt.pendingMessages.length);
        rt.pendingMessages.splice(target, 0, msg);
        this.renumberPending(rt);
        break;
      }
      case 'remove':
        rt.pendingMessages.splice(idx, 1);
        this.renumberPending(rt);
        break;
      case 'edit': {
        const msg = rt.pendingMessages[idx];
        msg.content = update.content;
        msg.segments = update.segments;
        break;
      }
      case 'mode':
        rt.pendingMessages[idx].mode = update.mode;
        break;
    }
    this.emitQueueChanged(treeId);
  }

  /** 查询队列状态（传输层广播/快照用）；按 order 排序返回副本 */
  getQueueState(treeId: string): { messages: QueuedMessage[]; dispatching: string | null } {
    const rt = this.runtimes.ofTree(treeId);
    return {
      messages: [...rt.pendingMessages].sort((a, b) => a.order - b.order),
      dispatching: rt.pendingDispatching,
    };
  }

  /** 传输层注册队列 dispatch 专用 hooks（连接建立时）；null = 注销 */
  setQueueHooks(hooks: ConversationHooks | null): void {
    this.queueHooks = hooks;
  }

  /** 传输层注入订阅者检查（某树是否还有订阅者）：全断连时不 dispatch，避免无人观看空烧 token；null = 不限制 */
  setSubscriberCheck(fn: ((treeId: string) => boolean) | null): void {
    this.hasSubscribers = fn;
  }

  /**
   * 引导（P3a Soft Steer，通用兌底、零源层改动）：中止当前流，排队消息插队到最前立即 dispatch。
   *
   * 源拥有自己的 agentic loop，Host 无法在 tool call 间隙注入（ISource.prompt 单次调用），
   * 唯一中途控制是 AbortSignal → 故“引导” = abort 当前回复（落 interrupted，可续写）+ 重开一轮。
   * 被中止的 turn 落定后 onTreeUpdated 会再触发 tryDispatch；两种情形都收敛到 steer 消息被发出：
   *   - 当前是普通 turn（pendingDispatching=null）→ 此处 tryDispatch 直接发出；
   *   - 当前是已 dispatch turn（pendingDispatching 置位）→ 等其落定 settle 后续发。
   */
  steer(treeId: string, messageId: string): void {
    const rt = this.runtimes.ofTree(treeId);
    const idx = rt.pendingMessages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const [msg] = rt.pendingMessages.splice(idx, 1);

    // 插队到最前（最高优先级）并重编 order；steer 经 dispatch 路径作为新 turn 发出
    msg.mode = 'queue';
    rt.pendingMessages.unshift(msg);
    this.renumberPending(rt);
    this.emitQueueChanged(treeId);

    // 有在途流：中止之（落 interrupted）。不能立即 dispatch——被中止 turn 的 assistant
    // 节点在落定时才持久化，先 dispatch 会解析不到链路 leaf（误挂 anchor user 节点）。
    // 故依赖「中止 → 落定（先落盘 assistant）→ onTreeUpdated → tryDispatch」链发出 steer 消息。
    // 无在途流：直接 dispatch（steer 已在队首）。
    if (rt.abortControllers.size > 0) {
      this.abortAnchorBranch(treeId, msg.anchorTurnId);
    } else {
      this.tryDispatch(treeId);
    }
  }

  /**
   * 中止锚定链路所在分支的在途流（steer 只中断“当前回复”）。
   * 跨分支并行流式时不连累无关分支：按 anchor 链路 leaf 的 branchId 匹配在途请求（requestId = user 节点 ID）。
   * 识别不出分支 → 兑底中止整树（P3a 通用兑底）；分支已识别但无在途流（锚定链空闲）→ 不中止他分支，直接尝试 dispatch。
   */
  private abortAnchorBranch(treeId: string, anchorTurnId: string): void {
    const rt = this.runtimes.ofTree(treeId);
    const leafId = this.resolveDispatchParent(treeId, anchorTurnId);
    const branchId = leafId ? this.deps.session.getNode(treeId, leafId)?.branchId : undefined;
    if (branchId === undefined) {
      this.runtimes.abortTree(treeId);
      return;
    }
    const onBranch = [...rt.abortControllers.keys()].filter((rid) => {
      const node = this.deps.session.getNode(treeId, rid);
      return node?.branchId === branchId;
    });
    if (onBranch.length > 0) {
      for (const rid of onBranch) this.runtimes.abortRequest(rt, rid);
    } else {
      // 锚定分支无在途流（链路空闲）：无需中止，直接 dispatch（pendingDispatching 置位时自然 no-op，待落定续发）
      this.tryDispatch(treeId);
    }
  }

  /**
   * 已 dispatch 请求归属的树（传输层广播 dispatched turn 事件时由 requestId 反查 treeId）。
   * 仅在该 turn 落定前有值（settleDispatched 后移除）。
   */
  dispatchTreeOf(requestId: string): string | undefined {
    return this.dispatchOwner.get(requestId);
  }

  /** 清理队列（树删除时调用，连同锁域一起释放） */
  cleanupQueue(treeId: string): void {
    this.runtimes.cleanup(treeId);
    // 同步清该树的 dispatch 归属与开放 turn 条目：避免删除后在途 turn 落定时复活锁域/误续发/泄漏
    for (const [rid, tid] of this.dispatchOwner) {
      if (tid === treeId) this.dispatchOwner.delete(rid);
    }
    for (const [uid, tid] of this.openTurns) {
      if (tid === treeId) this.openTurns.delete(uid);
    }
  }

  /**
   * 尝试 dispatch 下一条：turn 落定后取 order 最小的排队消息走正常 send 路径。
   * pendingDispatching 防重入：已 dispatch 的 turn 未落定前不发下一条（队列串行化）。
   * 传输无关：不关心谁在监听、怎么广播；队列变更经 EventBus 通知。
   */
  tryDispatch(treeId: string): void {
    // 非创建式查找：tryDispatch 仅在 turn 落定/重连后续发，锁域必已存在；
    // 用 peek 避免树删除后（cleanupQueue）在途 turn 落定复活空锁域
    const rt = this.runtimes.peek(treeId);
    if (!rt || rt.pendingMessages.length === 0 || rt.pendingDispatching) return;
    const hooks = this.queueHooks;
    if (!hooks) return; // 无传输层（纯 agent 测试）→ 不 dispatch
    // 无订阅者（全部断连）→ 不 dispatch，避免无人观看空烧 token；重连后由 tree.subscribe 触发恢复
    if (this.hasSubscribers && !this.hasSubscribers(treeId)) return;
    const ctx = this.contextByTreeId(treeId);
    if (!ctx) return; // 无会话连接 → 无法发送

    const next = [...rt.pendingMessages].sort((a, b) => a.order - b.order)[0];
    // 动态父节点：沿锚定链路走到当前 leaf（dispatch 时解析，非入队时）
    const parentId = this.resolveDispatchParent(treeId, next.anchorTurnId);
    // 锚定链 leaf 的 turn 仍开放（在途/刚入 doSend，仍将产生 assistant）→ 强行 dispatch 会挂 user→user；
    // 让位（pendingDispatching 保持空），待该 turn 落定注销 openTurn 后的 onTreeUpdated 再续发。
    // 已落定（零内容正常完成/只读 skipped/中止/出错）者已注销 → 放行交 doSend 正常路径/守卫。
    if (parentId && this.openTurns.has(parentId)) return;

    // 标记 dispatching + 移出队列（send 是 fire-and-forget 不抛同步错，可安全先移除）
    rt.pendingDispatching = next.id;
    rt.pendingMessages = rt.pendingMessages.filter((m) => m.id !== next.id);
    this.dispatchOwner.set(next.id, treeId);
    this.emitQueueChanged(treeId);

    // 复用队列消息 ID 作 requestId：turn 落定时据此清 pendingDispatching 标记
    this.send(
      ctx.sessionId,
      next.content,
      {
        parentNodeId: parentId,
        requestId: next.id,
        segments: next.segments,
        model: next.model,
        thinkingLevel: next.thinkingLevel,
        contextWindow: next.contextWindow,
        sourceId: next.sourceId,
      },
      hooks,
    );
  }

  // ── 内部实现 ──

  /** 未知 session 直接忽略（连接已断开的迟到消息），避免每处重复判空 */
  private withSession(sessionId: string, run: (ctx: SessionContext) => void): void {
    const ctx = this.sessions.get(sessionId);
    if (ctx) run(ctx);
  }

  /**
   * 终态守卫：destroyed 会话拒绝新命令（拒绝方式与 turn-guard 一致：onReject 回滚乐观态）。
   * 纵深防御两个时点：入口（map 已删时 withSession 已拦）+ 排队任务执行时
   *（send 入队后、执行前被 destroy 的竞态：doSend 持有的 ctx 引用仍能读到终态）。
   */
  private rejectIfDestroyed(
    ctx: SessionContext,
    requestId: string | undefined,
    hooks: ConversationHooks,
  ): boolean {
    if (!isTerminalSessionState(ctx.state)) return false;
    hooks.onReject?.(requestId, 'session 已销毁，拒绝新命令');
    return true;
  }

  /** 结构队列任务失败上报（enqueue 不再吞错；入口 fire-and-forget，错误统一转 hooks.onError） */
  private reportTaskError(
    err: unknown,
    requestId: string | undefined,
    hooks: ConversationHooks,
  ): void {
    // 先通知再释放：onError 时 dispatchOwner 仍在，传输层可据此反查 treeId 广播。
    // doSend 抛错是终结路径（不会再有 onTreeUpdated）→ settle 后续发下一条，避免队列卡死
    hooks.onError(err instanceof Error ? err.message : String(err), requestId);
    this.settleAndResume(requestId);
  }

  /**
   * 包装传输层 hooks：turn 落定（树更新/错误/拒绝）后驱动队列 dispatch 链。
   * agent 层闭环——传输层只提供 hooks，不参与 dispatch 决策。
   */
  private withQueueHooks(hooks: ConversationHooks): ConversationHooks {
    return {
      ...hooks,
      onTreeUpdated: (treeId, headNodeId, requestId) => {
        hooks.onTreeUpdated(treeId, headNodeId, requestId);
        // turn 落定（含零内容正常完成/readonly-skipped/中止）→ 注销开放 turn（此后不会再产生 assistant）
        if (requestId) this.openTurns.delete(requestId);
        this.settleDispatched(requestId);
        this.tryDispatch(treeId);
      },
      onError: (message, requestId) => {
        hooks.onError(message, requestId);
        // 注销开放 turn：仅终结错误（无在途流）；流内错误（仍在途）后有 onTreeUpdated 接续，不提前注销
        if (requestId && !this.runtimes.isStreaming(requestId)) this.openTurns.delete(requestId);
        // 释放 dispatch 锁并续发：流内错误（dispatched turn 仍在途）跳过避免提前提续；终结错误 settle + 续发
        if (requestId && this.isDispatchStreaming(requestId)) return;
        this.settleAndResume(requestId);
      },
      onReject: (requestId, reason) => {
        hooks.onReject?.(requestId, reason);
        this.settleAndResume(requestId); // reject 是终结路径：settle + 续发
      },
    };
  }

  /**
   * requestId 对应的请求是否仍在途流式中（abortController 已注册未落定）。
   * 仅对已 dispatch 的请求有意义（dispatchOwner 反查 treeId）。
   */
  private isDispatchStreaming(requestId: string): boolean {
    const treeId = this.dispatchOwner.get(requestId);
    if (!treeId) return false;
    const rt = this.runtimes.peek(treeId);
    return rt?.abortControllers.has(requestId) ?? false;
  }

  /**
   * 已 dispatch 的 turn 落定：清 pendingDispatching 标记（队列得以继续 dispatch）。
   * 返回归属 treeId（供终结错误路径续发）；非 dispatch 请求返回 undefined。
   * 用非创建式 peek：已清理的锁域（树删除）不被复活。
   */
  private settleDispatched(requestId: string | undefined): string | undefined {
    if (!requestId) return undefined;
    const treeId = this.dispatchOwner.get(requestId);
    if (!treeId) return undefined;
    this.dispatchOwner.delete(requestId);
    const rt = this.runtimes.peek(treeId);
    if (rt && rt.pendingDispatching === requestId) rt.pendingDispatching = null;
    return treeId;
  }

  /** turn 终结落定（错误/拒绝路径，可能无 onTreeUpdated）：释放 dispatch 标记并续发下一条，避免队列卡死 */
  private settleAndResume(requestId: string | undefined): void {
    const treeId = this.settleDispatched(requestId);
    if (treeId) this.tryDispatch(treeId);
  }

  /**
   * 解析排队消息的实际父节点：沿 anchorTurn 向下走到当前链路的最后一个活跃节点。
   * dispatch 时调用（非入队时），确保挂在最新 leaf 后面。
   * anchorTurnId 是 user 节点 ID → 先找其活跃 assistant 子节点，再交替向下 user/assistant。
   */
  private resolveDispatchParent(treeId: string, anchorTurnId: string): string | null {
    if (!anchorTurnId) return null;
    const nodes = this.deps.session.getNodes(treeId);
    let current = anchorTurnId;
    for (;;) {
      const assistantChild = nodes.find(
        (n) => n.parentId === current && n.role === 'assistant' && !isReadOnly(n.status),
      );
      if (!assistantChild) break;
      const userChild = nodes.find(
        (n) => n.parentId === assistantChild.id && n.role === 'user' && !isReadOnly(n.status),
      );
      if (!userChild) {
        current = assistantChild.id;
        break;
      }
      current = userChild.id;
    }
    return current;
  }

  /** 重编排队消息 order（稠密无缝，与数组位置一致） */
  private renumberPending(rt: TreeRuntime): void {
    rt.pendingMessages.forEach((m, i) => {
      m.order = i;
    });
  }

  /** 队列变更通知（EventBus，与 permission:request 同模式）：传输层订阅后广播 queue.state */
  private emitQueueChanged(treeId: string): void {
    this.deps.events?.emit('queue:changed', { treeId });
  }

  private async doSend(
    ctx: SessionContext,
    message: string,
    opts: SendOpts,
    hooks: ConversationHooks,
  ): Promise<void> {
    // 排队期间会话被销毁：不再懒建树/请求模型（终态守卫，与入口同源）
    if (this.rejectIfDestroyed(ctx, opts.requestId, hooks)) return;
    // 懒创建对话树（第一条消息时才创建）：idle → initializing → active 显式推进
    if (!ctx.treeId) {
      ctx.state = advanceSessionState(ctx.state, 'tree-init');
      let created;
      try {
        created = await this.deps.session.createTree({});
      } catch (err) {
        // 创建失败回退 idle（下次 send 可重新懒建）；错误经 enqueue promise 传播给 caller
        ctx.state = advanceSessionState(ctx.state, 'tree-init-failed');
        throw err;
      }
      ctx.treeId = created.id;
      ctx.state = advanceSessionState(ctx.state, 'tree-created');
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

    // 只读终态防护（纵深防御）：已撤销/已删除的节点下不可追问/分支。
    // 节点不存在（tree.delete 物理删除）视同不可写：否则 addNode 会挂出 UI 不可达的孤儿节点（消息静默丢失）
    if (actualParentId) {
      const guardNode = this.deps.session.getNode(treeId, actualParentId);
      if (!guardNode || isReadOnly(guardNode.status)) {
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
        } catch (err) {
          // 铁律：不静默降级——fork 失败回退到当前分支继续对话，但必须告知（上下文将共用原会话）
          hooks.onEvent(
            {
              type: 'notice',
              level: 'warning',
              message: `自动分支失败（${err instanceof Error ? err.message : String(err)}），已回退到当前分支继续对话`,
              ts: Date.now(),
            },
            opts.requestId,
          );
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

    // 登记开放 turn（早于流注册）：该 user 节点的 turn 仍将产生 assistant，
    // 供 tryDispatch 让位判定（防跨分支并行流式下挂出 user→user）；落定/终结报错时注销
    this.openTurns.set(userNode.id, treeId);

    // 流式调度到分支队列（不占结构队列）：不同线程/分支的回答并行推送
    this.runtimes.scheduleStream(ctx, branch?.id, () =>
      this.turns
        .runTurn(
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
        )
        .catch((err: unknown) => {
          // 意外兑底：runTurn 内预期外同步异常（磁盘故障等）被 scheduleStream 吞掉后不发任何 hook，
          // 会泄漏 openTurn / 卡死 pendingDispatching。转入 onError 路径（wrapped hooks 会注销开放 turn + settle 续发，幂等）
          hooks.onError(err instanceof Error ? err.message : String(err), opts.requestId);
        }),
    );
  }

  private async doContinue(
    ctx: SessionContext,
    nodeId: string,
    requestId: string,
    hooks: ConversationHooks,
  ): Promise<void> {
    if (this.rejectIfDestroyed(ctx, requestId, hooks)) return;
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
    if (this.rejectIfDestroyed(ctx, requestId, hooks)) return;
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
