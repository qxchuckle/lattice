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

export class TreeRuntimeRegistry {
  private readonly runtimes = new Map<string, TreeRuntime>();

  /** 锁域 key：树存在用 treeId（多连接共享），未创建用 session bootstrap */
  private keyOf(ctx: SessionContext): string {
    return ctx.treeId ?? `session:${ctx.sessionId}`;
  }

  /** 取/建该 session 当前锁域（per-tree；懒建树前退化为 per-session bootstrap） */
  of(ctx: SessionContext): TreeRuntime {
    const key = this.keyOf(ctx);
    let rt = this.runtimes.get(key);
    if (!rt) {
      rt = { abortControllers: new Map(), queue: Promise.resolve(), streamQueues: new Map() };
      this.runtimes.set(key, rt);
    }
    return rt;
  }

  /**
   * 将任务串入结构队列（树结构变更串行，避免 fork/addNode 交错）。
   * 仅包含快操作：流式部分由 scheduleStream 调度到分支队列，不占用本队列。
   */
  enqueue(ctx: SessionContext, task: () => Promise<void>): Promise<void> {
    const rt = this.of(ctx);
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
  scheduleStream(
    ctx: SessionContext,
    branchId: string | undefined,
    task: () => Promise<void>,
  ): void {
    const rt = this.of(ctx);
    const key = branchId ?? '__default__';
    const prev = rt.streamQueues.get(key) ?? Promise.resolve();
    const run = prev.then(task).catch(() => {});
    rt.streamQueues.set(key, run);
    void run.finally(() => {
      if (rt.streamQueues.get(key) === run) rt.streamQueues.delete(key);
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
