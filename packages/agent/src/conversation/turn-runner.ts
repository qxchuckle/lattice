/**
 * TurnRunner — 跑完一轮并落盘（流式执行的唯一落点）
 *
 * 职责边界：controller 决策「跟谁说、说什么、挂在哪」，本类负责「跑一轮 + 落盘 assistant」：
 * - 经 pipeline 管线调用源（能力适配/守卫/注入全在管线内，本类不读 capabilities）
 * - 每 delta 写 streaming 文件（崩溃恢复）
 * - 只读竞态防护：排队期/流式期 user 节点被撤销或删除时，不请求模型 / 以同状态落盘
 * - 中断（signal）算正常结局：落 interrupted 节点而非报错
 */
import type { ISource, ConversationBranch, ContentBlock } from '@qcqx/lattice-agent-protocol';
import { StreamAccumulator, isReadOnly } from '@qcqx/lattice-agent-protocol';
import { runPrompt as runPipelinePrompt } from '@qcqx/lattice-agent-pipeline';
import type { ConversationControllerDeps, ConversationHooks, SessionContext } from './types.js';
import type { TreeRuntimeRegistry } from './tree-runtime.js';

/** 一轮请求的模型参数（落盘于节点 metadata，retry/continue 复用） */
interface TurnModelOpts {
  model?: string;
  thinkingLevel?: string;
  contextWindow?: number;
}

export interface RunTurnOpts extends TurnModelOpts {
  blocks: ContentBlock[];
  userNodeId: string;
  branch: ConversationBranch | undefined;
  sourceSessionId: string | null;
  requestId: string;
  /** 线程源（不传回退 session 默认源） */
  sourceId?: string;
}

export interface RunContinuationOpts extends TurnModelOpts {
  source: ISource;
  /** 被续写的 assistant 节点 ID */
  targetNodeId: string;
  branch: ConversationBranch | undefined;
  requestId: string;
  /** 树当前 head（节点已只读时用于闭合请求生命周期） */
  fallbackHeadNodeId: string | null;
}

export interface TurnRunnerDeps {
  deps: ConversationControllerDeps;
  runtimes: TreeRuntimeRegistry;
  /** done 返回的源 sessionId 同步到分支（树操作职责，注入以免双向依赖） */
  syncBranchSession: (
    treeId: string,
    branch: ConversationBranch | undefined,
    sessionId: string | undefined,
    sourceId?: string,
  ) => Promise<void>;
}

export class TurnRunner {
  constructor(private readonly ctxDeps: TurnRunnerDeps) {}

  private get deps(): ConversationControllerDeps {
    return this.ctxDeps.deps;
  }

  /** 跑一轮新回复：调用源 → 落盘 assistant 节点 → 通知树更新 */
  async runTurn(ctx: SessionContext, opts: RunTurnOpts, hooks: ConversationHooks): Promise<void> {
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
      { model: opts.model, thinkingLevel: opts.thinkingLevel, contextWindow: opts.contextWindow },
    );

    // 捕获新 sessionId（新建时源返回，续写时不变）+ 同步分支源标记
    await this.ctxDeps.syncBranchSession(treeId, opts.branch, accumulator.sessionId, sourceId);

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
   * 续写已有 assistant 节点（"Continue" 是 API 协议需要，树中不展示）。
   * 内容追加到原节点而非新建，故与 runTurn 的落盘路径不同。
   */
  async runContinuation(
    ctx: SessionContext,
    opts: RunContinuationOpts,
    hooks: ConversationHooks,
  ): Promise<void> {
    const treeId = ctx.treeId;
    if (!treeId) return;

    // 排队期间节点可能被撤销/删除：不再请求模型，仅通知一次闭合请求生命周期
    const current = this.deps.session.getNode(treeId, opts.targetNodeId);
    if (!current || isReadOnly(current.status)) {
      hooks.onTreeUpdated(treeId, opts.fallbackHeadNodeId, opts.requestId);
      return;
    }
    // 排队后取最新源 session（同分支前序流可能刚更新 sourceSessionId）
    const sourceSessionId = opts.branch?.sourceSessionId ?? null;

    const { accumulator, interrupted } = await this.streamSource(
      ctx,
      opts.source,
      sourceSessionId,
      [{ type: 'text', text: 'Continue' }],
      opts.requestId,
      undefined,
      hooks,
      {
        model: opts.model,
        thinkingLevel: opts.thinkingLevel,
        contextWindow: opts.contextWindow,
      },
    );

    if (accumulator.content.length > 0) {
      // 落盘前重读：流式期间被撤销/删除则不追加内容、不覆盖只读状态
      const latest = this.deps.session.getNode(treeId, opts.targetNodeId);
      if (latest && !isReadOnly(latest.status)) {
        const existingContent = latest.content ?? [];
        await this.deps.session.updateNode(treeId, opts.targetNodeId, {
          content: [...existingContent, ...accumulator.content],
          metadata: { ...latest.metadata, ...accumulator.nodeMetadata },
          status: interrupted ? 'interrupted' : 'active',
        });
      }
    }
    await this.ctxDeps.syncBranchSession(treeId, opts.branch, accumulator.sessionId);
    hooks.onTreeUpdated(treeId, opts.targetNodeId, opts.requestId);
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
    promptOpts: TurnModelOpts,
  ): Promise<{ accumulator: StreamAccumulator; interrupted: boolean }> {
    const accumulator = new StreamAccumulator();
    const abortController = new AbortController();
    const rtStream = this.ctxDeps.runtimes.of(ctx);
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

    // 身份：catch 分支也需 sourceName（能力消费已下沉到 pipeline 管线）
    const sourceName = source.describe().info.displayName;
    // 管线：哨兵归一化 / skills 注入 / 任务上下文注入 / 图片降级 / 工具语义回填 / 能力守卫全在其中
    const middlewares = this.deps.profiles.get(source.id)?.middlewares ?? [];
    // 线程身份与任务关联：注入类 middleware 据此取上下文（无任务关联时不注入）
    const taskId = treeId ? this.deps.session.getTree(treeId)?.taskId : undefined;

    try {
      const stream = await runPipelinePrompt({
        source,
        payload: {
          sessionId: sourceSessionId,
          message: blocks,
          opts: {
            signal: abortController.signal,
            model: promptOpts.model,
            thinkingLevel: promptOpts.thinkingLevel,
            contextWindow: promptOpts.contextWindow,
            onPermissionRequest: this.deps.onPermissionRequest,
          },
        },
        middlewares,
        ctx: { threadId: treeId ?? undefined, metadata: { taskId } },
      });
      for await (const rawEvent of stream) {
        // ts 由源边缘（defineSource 工厂）统一打点；第三方源实现未打点时兜底补齐
        const event = rawEvent.ts === undefined ? { ...rawEvent, ts: Date.now() } : rawEvent;
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
          source: { id: source.id, name: sourceName },
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
