/**
 * TreeRuntimeRegistry — per-tree 运行时锁域
 *
 * 三种并发语义集中在此，不散落到编排流程里：
 * - 结构队列（queue）：树结构变更串行（fork/addNode/标记），快操作
 * - 分支流式队列（streamQueues）：同分支串行、跨分支并行（同源 session 不可并发 prompt）
 * - 在途请求表（abortControllers）：requestId → AbortController，signal 是唯一取消真相
 *
 * 锁域 key：树存在用 treeId（多连接共享同一树的锁），树未创建时退化为 `session:<sid>`。
 */
import type { SessionContext, TreeRuntime } from './types.js';
import { advanceTreeRuntime, initialTreeRuntimeState } from './runtime-state.js';

const noop = (): void => {};

export class TreeRuntimeRegistry {
  private readonly runtimes = new Map<string, TreeRuntime>();

  /** 锁域 key：树存在用 treeId（多连接共享），未创建用 session bootstrap */
  private keyOf(ctx: SessionContext): string {
    return ctx.treeId ?? `session:${ctx.sessionId}`;
  }

  /** 创建空锁域（of/ofTree 共用，字段初始化单一来源） */
  private create(): TreeRuntime {
    return {
      abortControllers: new Map(),
      queue: Promise.resolve(),
      streamQueues: new Map(),
      state: initialTreeRuntimeState(),
      pendingMessages: [],
      pendingDispatching: null,
      pendingOrderCounter: 0,
    };
  }

  /** 取/建该 session 当前锁域（per-tree；懒建树前退化为 per-session bootstrap） */
  of(ctx: SessionContext): TreeRuntime {
    const key = this.keyOf(ctx);
    let rt = this.runtimes.get(key);
    if (!rt) {
      rt = this.create();
      this.runtimes.set(key, rt);
    }
    return rt;
  }

  /**
   * 直接按 treeId 取/建锁域（消息排队操作用：队列操作只有 treeId，无 SessionContext）。
   * 与 of(ctx) 共享同一 Map——树创建后 keyOf(ctx) 就是 treeId，两者命中同一实例。
   */
  ofTree(treeId: string): TreeRuntime {
    let rt = this.runtimes.get(treeId);
    if (!rt) {
      rt = this.create();
      this.runtimes.set(treeId, rt);
    }
    return rt;
  }

  /** 移除锁域（树删除时调用，释放排队消息与在途请求表） */
  cleanup(treeId: string): void {
    this.runtimes.delete(treeId);
  }

  /** 非创建式查找：锁域不存在返回 undefined（settle/steer 用，避免复活已清理的锁域） */
  peek(treeId: string): TreeRuntime | undefined {
    return this.runtimes.get(treeId);
  }

  /** 某请求是否注册了在途流（abortController 存在）：跨锁域扫描，供区分流内错误与终结错误 */
  isStreaming(requestId: string): boolean {
    for (const rt of this.runtimes.values()) {
      if (rt.abortControllers.has(requestId)) return true;
    }
    return false;
  }

  /**
   * 将任务串入结构队列（树结构变更串行，避免 fork/addNode 交错）。
   * 仅包含快操作：流式部分由 scheduleStream 调度到分支队列，不占用本队列。
   *
   * 错误契约：返回的 promise 原样传播任务错误（caller 必须 await/catch）；
   * 内部队列链另行吞错保护，保证错误不卡队列（后续任务照常执行）。
   */
  enqueue(ctx: SessionContext, task: () => Promise<void>): Promise<void> {
    const rt = this.of(ctx);
    rt.state = advanceTreeRuntime(rt.state, 'enqueue-task');
    const run = rt.queue.then(task);
    // 链上另行吞错：队列推进不受单个任务失败影响；错误经 run 传给 caller
    const chained = run.then(noop, noop);
    rt.queue = chained;
    void run.then(
      () => {
        if (rt.queue === chained) {
          rt.state = advanceTreeRuntime(rt.state, 'task-done');
          rt.queue = Promise.resolve();
        }
      },
      (err: unknown) => {
        // failed 驻留到下次 enqueue（观测标记，不阻断后续任务）
        rt.lastError = err;
        rt.state = advanceTreeRuntime(rt.state, 'task-error');
        if (rt.queue === chained) rt.queue = Promise.resolve();
      },
    );
    return run;
  }

  /**
   * 流式任务按分支串行、跨分支并行：同一源 session（= 分支）不能并发 prompt，
   * 不同线程/分支的回答同时推送，互不阻塞。锁域 per-tree，多连接共享。
   *
   * 错误契约：返回 void（fire-and-forget），流任务错误不再无痕吞掉——
   * 记录到 rt.lastError 并推进 stream 维度到 failed（队列仍照常推进）。
   */
  scheduleStream(
    ctx: SessionContext,
    branchId: string | undefined,
    task: () => Promise<void>,
  ): void {
    const rt = this.of(ctx);
    const key = branchId ?? '__default__';
    const prev = rt.streamQueues.get(key) ?? Promise.resolve();
    rt.state = advanceTreeRuntime(rt.state, 'stream-start');
    const run = prev.then(task).then(noop, (err: unknown) => {
      rt.lastError = err;
      rt.state = advanceTreeRuntime(rt.state, 'stream-error');
    });
    rt.streamQueues.set(key, run);
    void run.finally(() => {
      // 旧队尾被覆盖后不再是队尾，完成时不动 map；只有当前队尾才清理条目
      if (rt.streamQueues.get(key) === run) {
        rt.streamQueues.delete(key);
        // 全部分支排空才算 stream 维度归位（failed 驻留：非法转换保持原态）
        if (rt.streamQueues.size === 0) {
          rt.state = advanceTreeRuntime(rt.state, 'stream-done');
        }
      }
    });
  }

  /** 中止单个请求（存在则中止并摘除，返回是否命中） */
  abortRequest(rt: TreeRuntime, requestId: string): boolean {
    const ctrl = rt.abortControllers.get(requestId);
    if (!ctrl) return false;
    ctrl.abort();
    rt.abortControllers.delete(requestId);
    return true;
  }

  /** 中止该锁域全部在途请求（signal 已接线到源，abort 即终止源侧生成） */
  abortAll(ctx: SessionContext): void {
    const rt = this.of(ctx);
    for (const rid of [...rt.abortControllers.keys()]) this.abortRequest(rt, rid);
  }

  /** 按 requestId 跨锁域中止（socket 断开时用） */
  abortByRequestId(requestId: string): void {
    for (const rt of this.runtimes.values()) {
      if (this.abortRequest(rt, requestId)) return;
    }
  }

  /** 中止某树全部在途流（订阅者归零宽限到期时调用，避免无人观看仍烧 token） */
  abortTree(treeId: string): void {
    const rt = this.runtimes.get(treeId);
    if (!rt) return;
    for (const rid of [...rt.abortControllers.keys()]) this.abortRequest(rt, rid);
  }
}
