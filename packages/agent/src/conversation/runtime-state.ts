/**
 * runtime-state — TreeRuntime 生命周期状态机（per-tree 锁域的运行阶段真相）
 *
 * 范式对齐 node-state.ts / stream-lifecycle.ts：
 * 显式转换表 + advance 纯函数 + 终态守卫，零依赖纯函数。
 *
 * 与真实并发原语一一对应的建模决策：
 * - 结构队列（queue）与分支流式队列（streamQueues）是**两条独立的并发原语**，
 *   可同时活跃（排队结构变更的同时另一分支在流式推送），单一标量状态无法忠实表达，
 *   故采用两个正交子维度 queue × stream（组合态即 TreeRuntimeState）。
 * - 不建 shutdown/aborted 状态：TreeRuntimeRegistry 没有销毁生命周期（runtime 常驻），
 *   abort 走 AbortController signal（任务仍会正常 settle，队列照常推进），
 *   中止不改变任何队列所处阶段——为不存在的流程造状态违反忠实建模。
 *   因此本机**没有终态**，isTerminalTreeRuntimeState 从转换表派生（恒 false），
 *   保留守卫接口以便转换表演进时测试可锁定「终态 ⟺ 无出边」。
 *
 * failed 语义（错误可观测性优先）：
 * - 最近一次任务/流出错且尚无新工作入队时驻留 failed，配合 TreeRuntime.lastError
 *   提供「无痕吞错」的显式替身；新工作入队（enqueue-task/stream-start）拉回活跃态。
 * - failed 不阻断队列推进（并发不变量「错误不卡队列」由 tree-runtime 的链保护保证），
 *   它只是观测标记，不是流程闸门。
 */

/** 结构队列子状态：空闲 / 有任务在排 / 最近任务出错（drain 后驻留直到新任务） */
export type QueueState = 'idle' | 'queueing' | 'failed';

/** 流式队列子状态：空闲 / 至少一条分支流活跃 / 最近流出错（驻留直到新流） */
export type StreamState = 'idle' | 'streaming' | 'failed';

/** TreeRuntime 组合状态：两个正交维度（结构队列 × 流式队列） */
export interface TreeRuntimeState {
  readonly queue: QueueState;
  readonly stream: StreamState;
}

/**
 * 生命周期转换信号：
 * - enqueue-task：结构任务入队（enqueue 入口）
 * - task-done：结构队列排空（队尾任务成功 settle 且无后继）
 * - task-error：结构任务 reject（错误同时经返回的 promise 传播给 caller）
 * - stream-start：流任务入队（scheduleStream 入口）
 * - stream-done：全部分支流队列排空（streamQueues 清空）
 * - stream-error：流任务 reject（记录到 lastError，scheduleStream 返回 void 不上抛）
 */
export type TreeRuntimeSignal =
  | 'enqueue-task'
  | 'task-done'
  | 'task-error'
  | 'stream-start'
  | 'stream-done'
  | 'stream-error';

/** queue 维度转换表（failed 是观测驻留态：drain 不清除，新任务入队才拉回） */
const QUEUE_TRANSITIONS = {
  idle: { 'enqueue-task': 'queueing' },
  queueing: { 'task-done': 'idle', 'task-error': 'failed' },
  failed: { 'enqueue-task': 'queueing' },
} as const satisfies Record<QueueState, Partial<Record<TreeRuntimeSignal, QueueState>>>;

/** stream 维度转换表（与 queue 维度同构） */
const STREAM_TRANSITIONS = {
  idle: { 'stream-start': 'streaming' },
  streaming: { 'stream-done': 'idle', 'stream-error': 'failed' },
  failed: { 'stream-start': 'streaming' },
} as const satisfies Record<StreamState, Partial<Record<TreeRuntimeSignal, StreamState>>>;

/**
 * 转换表：显式状态机，集中所有合法转换（两个正交维度各自独立推进）。
 * 非法转换保持当前状态（与 node-state.ts / stream-lifecycle.ts 策略一致，不抛错）。
 */
export const TREE_RUNTIME_TRANSITIONS = {
  queue: QUEUE_TRANSITIONS,
  stream: STREAM_TRANSITIONS,
} as const;

/** queue 维度信号集（用于 advance 路由；其余信号归 stream 维度） */
const QUEUE_SIGNALS: readonly TreeRuntimeSignal[] = ['enqueue-task', 'task-done', 'task-error'];

/** 初始状态：两维度均空闲 */
export function initialTreeRuntimeState(): TreeRuntimeState {
  return { queue: 'idle', stream: 'idle' };
}

/**
 * 应用一个信号，返回下一状态；信号按维度路由（queue 信号不动 stream 维度，反之亦然）。
 * 无合法转换时保持原态（返回原对象，引用可比）。
 */
export function advanceTreeRuntime(
  current: TreeRuntimeState,
  signal: TreeRuntimeSignal,
): TreeRuntimeState {
  if (QUEUE_SIGNALS.includes(signal)) {
    const next: QueueState | undefined = (
      QUEUE_TRANSITIONS[current.queue] as Partial<Record<TreeRuntimeSignal, QueueState>>
    )[signal];
    if (next === undefined || next === current.queue) return current;
    return { queue: next, stream: current.stream };
  }
  const next: StreamState | undefined = (
    STREAM_TRANSITIONS[current.stream] as Partial<Record<TreeRuntimeSignal, StreamState>>
  )[signal];
  if (next === undefined || next === current.stream) return current;
  return { queue: current.queue, stream: next };
}

/**
 * 是否终态（两维度均无出边）。从转换表派生而非硬编码：
 * 当前所有状态都有出边（runtime 常驻无销毁流程），故恒 false；
 * 若未来引入 shutdown 流程，加表即自动生效，测试锁定「终态 ⟺ 无出边」。
 */
export function isTerminalTreeRuntimeState(state: TreeRuntimeState): boolean {
  const queueHasExit = Object.keys(QUEUE_TRANSITIONS[state.queue]).length > 0;
  const streamHasExit = Object.keys(STREAM_TRANSITIONS[state.stream]).length > 0;
  return !queueHasExit && !streamHasExit;
}

/** 派生语义：任一维度处于 failed（配合 TreeRuntime.lastError 观测最近错误）。 */
export function hasRuntimeFailure(state: TreeRuntimeState): boolean {
  return state.queue === 'failed' || state.stream === 'failed';
}
