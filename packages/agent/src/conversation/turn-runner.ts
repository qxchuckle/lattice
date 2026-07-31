/**
 * TurnRunner — 跑完一轮并落盘（流式执行的唯一落点）
 *
 * 职责边界：controller 决策「跟谁说、说什么、挂在哪」，本类负责「跑一轮 + 落盘 assistant」：
 * - 经 pipeline 管线调用源（能力适配/守卫/注入全在管线内，本类不读 capabilities）
 * - 每 delta 写 streaming 文件（崩溃恢复）
 * - 只读竞态防护：排队期/流式期 user 节点被撤销或删除时，不请求模型 / 以同状态落盘
 * - 中断（signal）算正常结局：落 interrupted 节点而非报错
 */
import type {
  ISource,
  ConversationBranch,
  ContentBlock,
  SourceEvent,
} from '@qcqx/lattice-agent-protocol';
import {
  StreamAccumulator,
  isReadOnly,
  resolveSettledNodeStatus,
} from '@qcqx/lattice-agent-protocol';
import { runPrompt as runPipelinePrompt } from '@qcqx/lattice-agent-pipeline';
import {
  auditTime,
  concatMap,
  from,
  lastValueFrom,
  catchError,
  EMPTY,
  map,
  tap,
  share,
} from 'rxjs';
import type { ConversationControllerDeps, ConversationHooks, SessionContext } from './types.js';
import type { TreeRuntimeRegistry } from './tree-runtime.js';
import type { StreamLifecycleState } from './stream-lifecycle.js';
import { advanceStreamLifecycle } from './stream-lifecycle.js';

/**
 * 流式持久化节流窗口（ms）。
 * 高频 delta 合并为最多每此间隔一次全量快照写盘（崩溃恢复用）。
 * 旧行为：每条 delta 一次 writeFile 且 await 阻塞转发 → 2000 token = 2000 次写、
 * 每次序列化全量内容（O(n²) 写放大），且磁盘延迟直接叠加到用户看到的流式延迟上。
 */
const STREAM_PERSIST_THROTTLE_MS = 100;

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

    // 生命周期状态机：idle → preflight（前置检查），各提前返回路径落到显式终态
    let lifecycle = advanceStreamLifecycle('idle', 'begin');

    // 分支队列排队期间 user 节点可能已被撤销/删除：不再请求模型（前端已不接收，
    // 后端不应白烧 token），仅通知一次闭合请求生命周期
    const userNodeAtStart = this.deps.session.getNode(treeId, opts.userNodeId);
    if (userNodeAtStart && isReadOnly(userNodeAtStart.status)) {
      lifecycle = advanceStreamLifecycle(lifecycle, 'skip-readonly');
    }
    if (lifecycle === 'readonly-skipped') {
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
      lifecycle = advanceStreamLifecycle(lifecycle, 'fail');
    }
    if (lifecycle === 'failed' || !source) {
      hooks.onError('Source not found', opts.requestId);
      return;
    }

    // 排队后重解析源 session：同分支前序流可能刚捕获/更新了 sourceSessionId，
    // 用设置时的旧值会丢失上下文连续性
    const persistedSessionId = opts.branch
      ? (opts.branch.sourceSessionId ?? null)
      : opts.sourceSessionId;

    // 能力守卫：源不支持 resume 时不传旧 sessionId。
    // 否则源要么报错、要么静默新建（宿主却以为续上了）——两种都是错。
    // 宿主影响可控：对话树是宿主真相，源侧上下文丢失不丢用户内容。
    const canResume = this.deps.profiles.get(source.id)?.capabilities.session.resume !== false;
    const sourceSessionId = canResume ? persistedSessionId : null;

    const {
      accumulator,
      lifecycle: settled,
      hasError,
    } = await this.streamSource(
      ctx,
      source,
      sourceSessionId,
      opts.blocks,
      opts.requestId,
      opts.userNodeId,
      hooks,
      { model: opts.model, thinkingLevel: opts.thinkingLevel, contextWindow: opts.contextWindow },
      lifecycle,
    );
    // 终态判定走共享状态机（server/client 一致）：用户中止 > 源错误 > 源侧未完成 > 正常
    const settledStatus = resolveSettledNodeStatus({
      userAborted: settled === 'aborted',
      hasError,
      sourceIncomplete: settled === 'source-incomplete',
    });

    // 捕获新 sessionId（新建时源返回，续写时不变）+ 同步分支源标记
    await this.ctxDeps.syncBranchSession(treeId, opts.branch, accumulator.sessionId, sourceId);

    // 持久化 assistant 节点
    // 非正常终态（interrupted/error）即使无内容（如首 token 前中止）也要落盘对应状态节点，
    // 否则 reload 后会因缺少 assistant 节点被误判为 done 空节点，丢失终态与继续按钮
    // 只读竞态防护：流式期间 user 节点可能已被撤销/删除（undo/delete 立即执行不排队），
    // assistant 以同样的只读状态落盘保持子树一致，且不推进 head（head 已被 markNodes 回退）
    const userNode = this.deps.session.getNode(treeId, opts.userNodeId);
    const readOnlyStatus = userNode && isReadOnly(userNode.status) ? userNode.status : undefined;

    let headNodeId: string | null = opts.userNodeId;
    if (accumulator.content.length > 0 || settledStatus !== 'active') {
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
          : settledStatus !== 'active'
            ? { status: settledStatus }
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

    // 生命周期状态机：idle → preflight（前置检查）
    let lifecycle = advanceStreamLifecycle('idle', 'begin');

    // 排队期间节点可能被撤销/删除：不再请求模型，仅通知一次闭合请求生命周期
    const current = this.deps.session.getNode(treeId, opts.targetNodeId);
    if (!current || isReadOnly(current.status)) {
      lifecycle = advanceStreamLifecycle(lifecycle, 'skip-readonly');
    }
    if (lifecycle === 'readonly-skipped') {
      hooks.onTreeUpdated(treeId, opts.fallbackHeadNodeId, opts.requestId);
      return;
    }
    // 排队后取最新源 session（同分支前序流可能刚更新 sourceSessionId）
    const sourceSessionId = opts.branch?.sourceSessionId ?? null;

    const {
      accumulator,
      lifecycle: settled,
      hasError,
    } = await this.streamSource(
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
      lifecycle,
    );
    // 终态判定与 runTurn 同源（共享纯函数）：live 与 reload 投影一致
    const settledStatus = resolveSettledNodeStatus({
      userAborted: settled === 'aborted',
      hasError,
      sourceIncomplete: settled === 'source-incomplete',
    });

    if (accumulator.content.length > 0) {
      // 落盘前重读：流式期间被撤销/删除则不追加内容、不覆盖只读状态
      const latest = this.deps.session.getNode(treeId, opts.targetNodeId);
      if (latest && !isReadOnly(latest.status)) {
        const existingContent = latest.content ?? [];
        await this.deps.session.updateNode(treeId, opts.targetNodeId, {
          content: [...existingContent, ...accumulator.content],
          metadata: { ...latest.metadata, ...accumulator.nodeMetadata },
          status: settledStatus,
        });
      }
    }
    await this.ctxDeps.syncBranchSession(treeId, opts.branch, accumulator.sessionId);
    hooks.onTreeUpdated(treeId, opts.targetNodeId, opts.requestId);
  }

  /**
   * 流式调用源 + 每 delta 写 streaming 文件（崩溃恢复用）
   * 返回累加器、生命周期终态（completed / aborted / source-incomplete）与
   * hasError（本轮是否出现 error 事件/管线错误），调用方经
   * resolveSettledNodeStatus 派生节点终态；
   * 正常结束（含优雅中止）后清理 streaming 文件
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
    lifecycleIn: StreamLifecycleState,
  ): Promise<{
    accumulator: StreamAccumulator;
    lifecycle: StreamLifecycleState;
    hasError: boolean;
  }> {
    // preflight → streaming：前置检查已由调用方完成
    let lifecycle = advanceStreamLifecycle(lifecycleIn, 'stream');
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

    // 持久化支路排干句柄（建流成功后才有；runPipelinePrompt 入向失败时保持 undefined）
    let persistDrained: Promise<unknown> | undefined;

    // ── 管线各环节的命名回调（闭包访问 accumulator / hooks / requestId）──

    // ts 由源边缘统一打点；第三方源未打点时兜底补齐
    const enhanceEventTimestamp = (raw: SourceEvent): SourceEvent =>
      raw.ts === undefined ? { ...raw, ts: Date.now() } : raw;

    // 转发/累积：同步即时（不被磁盘 IO 阻塞，避免用户看到的流式卡顿）
    // 源 error 事件在此消费（源错误走事件通道后流正常 complete，不进下方 catch）：
    // - 补发 onError 闭合客户端请求生命周期（用户中止不发，保持 interrupted 不被覆盖）
    // - 熔断唯一触发点：source_unavailable 只由工厂在源设施边界（connect 最终失败等）
    //   生成（retryable 恒为 false）；prompt 运行时失败包为 unknown，天然不触发。
    //   消费的是工厂赋予的语义 code（非重新分类）；恢复路径：rehandshake 成功 → markAvailable
    let hasError = false;
    const applyEventToState = (event: SourceEvent): void => {
      accumulator.apply(event);
      hooks.onEvent(event, requestId);
      if (event.type === 'error') {
        hasError = true;
        if (!abortController.signal.aborted) hooks.onError(event.message, requestId);
        if (event.code === 'source_unavailable') {
          this.deps.sources.registry.markUnavailable(source.id, event.message);
        }
      }
    };

    // 铁律：不静默降级——写盘失败意味着崩溃恢复凭据不可用（进程挂了就丢在途回复），
    // 必须告知；但逐次告知会刷屏，故只在**首次**失败时发 warning notice。
    let persistFailureNotified = false;
    const handlePersistError = (err: unknown) => {
      if (!persistFailureNotified) {
        persistFailureNotified = true;
        hooks.onEvent(
          {
            type: 'notice',
            level: 'warning',
            message: `流式中间态写盘失败（${err instanceof Error ? err.message : String(err)}），若进程异常退出将无法恢复本次在途回复`,
            ts: Date.now(),
          },
          requestId,
        );
      }
      return EMPTY; // 不断流：单次写失败不影响已转发的对话内容
    };

    try {
      // 事件主干：pipeline runPrompt 直接返回 Observable<SourceEvent>（整条链全程 Observable，无需再 from() 桥接）。
      // share() 后分两支路共享同一次上游：
      //   ① 转发/累积：tap 同步即时；
      //   ② 持久化：auditTime 节流（只写最新全量快照）+ concatMap 串行写（不并发交错，写失败不断流）。
      // 入向 middleware 失败 / 中间件错误 → Observable error → 下方 catch；源错误走 error 事件（不双重）。
      const event$ = runPipelinePrompt({
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
      }).pipe(map(enhanceEventTimestamp), tap(applyEventToState), share());

      // 持久化支路：先同步订阅，与主干共享同一次上游拉取；catch 兵底使 finally await 不会抛出。
      persistDrained = lastValueFrom(
        event$.pipe(
          auditTime(STREAM_PERSIST_THROTTLE_MS),
          concatMap(() => from(persistStreaming()).pipe(catchError(handlePersistError))),
        ),
        { defaultValue: null },
      ).catch(() => null);

      // 主干消费：驱动上游拉取并等待流结束
      await lastValueFrom(event$, { defaultValue: null });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // 仅真实错误（非用户中止）记入内容并通知客户端：
      //   落盘 error 内容块 + 节点 error 状态 → reload 后投影为 error，与 live 一致；
      //   用户中止保持 interrupted（客户端已乐观设置，不发 error 避免覆盖）。
      //   此处只接管线/入向 middleware 错误（源错误走 error 事件通道，不双发）。
      if (!abortController.signal.aborted) {
        hasError = true;
        accumulator.apply({
          type: 'error',
          message: errMsg,
          code: 'unknown',
          retryable: false,
          source: { id: source.id, name: sourceName },
        });
        hooks.onError(errMsg, requestId);
      }
    } finally {
      rtStream.abortControllers.delete(requestId);
      // 排干在途写：上游完成会级联完成持久化支路（concatMap 等在途 write 收尾）；
      // 未建流（入向失败）时 persistDrained 为 undefined，跳过。
      if (persistDrained) await persistDrained;
      // streaming → 终态：用户中止 > 源侧未完成 > 正常结束（原布尔混合判断的显式化）
      lifecycle = advanceStreamLifecycle(
        lifecycle,
        abortController.signal.aborted
          ? 'abort'
          : accumulator.done
            ? 'complete'
            : 'source-incomplete',
      );
      // 无条件补写最终全量态：auditTime 会丢弃 complete 时窗口内未发的尾值，
      // 崩溃恢复需要最新内容（正常结束路径下 clearStreaming 前若崩溃，文件须是完整快照）。
      // 幂等：persistStreaming 写的是全量快照，若尾值未被丢弃则重复写入相同内容，安全。
      // 兜底与支路一致：写失败不打断对话落盘，仅（首次）告知。
      await persistStreaming().catch(handlePersistError);
    }

    // 正常结束（含优雅中止）清理 streaming 文件；崩溃时不会走到这里，文件保留供恢复
    if (treeId && persistParentId) {
      await this.deps.session.clearStreaming(treeId, requestId);
    }

    return { accumulator, lifecycle, hasError };
  }
}
