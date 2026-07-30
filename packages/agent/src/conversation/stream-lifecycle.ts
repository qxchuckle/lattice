/**
 * stream-lifecycle — TurnRunner 流式生命周期状态机（单轮请求的阶段真相）
 *
 * 范式对齐 agent-protocol/src/source/node-state.ts 的 ViewStatus 状态机：
 * 显式转换表 + advance 纯函数 + 终止态守卫，零依赖纯函数。
 *
 * 与 ViewStatus 的分工：ViewStatus 是**节点视图**的跨层真相（server/client 共用），
 * 本机是 TurnRunner **单次执行**的内部阶段追踪——一次 runTurn/runContinuation
 * 从 idle 走到某个终态即结束，不存在被 start 拉回的循环，故单独建机不复用 ViewStatus。
 *
 * 状态语义（对应 turn-runner 中原先的隐式布尔/提前返回）：
 * - idle              未开始
 * - preflight         前置检查（只读竞态防护 / 源解析），排队期结束后进入
 * - streaming         流式进行中（转发/累积 + 持久化支路共享此阶段）
 * - completed         终态：源正常发出 done
 * - aborted           终态：用户中止（abort signal），原 `abortController.signal.aborted`
 * - source-incomplete 终态：源侧未完成（流结束但无 done 事件，含源报错），原 `!accumulator.done`
 * - readonly-skipped  终态：排队期间目标节点已被撤销/删除，只读提前返回（不请求模型）
 * - failed            终态：前置检查失败（如源不存在），未建流即结束
 *
 * 对外 `interrupted` 语义由终态派生：aborted | source-incomplete → interrupted
 * （替代原先 `signal.aborted || !accumulator.done` 的布尔混合判断）。
 *
 * 持久化失败（persistFailureNotified）不建模为状态：它是「只通知一次」的
 * 通知闸，与流所处阶段正交（写失败不断流、不改变生命周期走向），保留为局部标志。
 */

/** 流式生命周期状态 */
export type StreamLifecycleState =
  | 'idle'
  | 'preflight'
  | 'streaming'
  | 'completed'
  | 'aborted'
  | 'source-incomplete'
  | 'readonly-skipped'
  | 'failed';

/**
 * 生命周期转换信号：
 * - begin：进入前置检查（runTurn/runContinuation 入口）
 * - skip-readonly：前置发现目标节点只读 → 提前返回
 * - fail：前置检查失败（源不存在等）
 * - stream：前置通过，建流开始
 * - complete：源正常结束（收到 done）
 * - abort：用户中止
 * - source-incomplete：流结束但源未发 done（含源报错）
 */
export type StreamLifecycleSignal =
  | 'begin'
  | 'skip-readonly'
  | 'fail'
  | 'stream'
  | 'complete'
  | 'abort'
  | 'source-incomplete';

/**
 * 转换表：显式状态机，集中所有合法转换。
 * 终态（completed/aborted/source-incomplete/readonly-skipped/failed）不接受任何信号；
 * 非法转换保持当前状态（与 node-state.ts 的处理策略一致，不抛错、不产生非法态）。
 */
const STREAM_LIFECYCLE_TRANSITIONS = {
  idle: { begin: 'preflight' },
  preflight: { 'skip-readonly': 'readonly-skipped', fail: 'failed', stream: 'streaming' },
  streaming: {
    complete: 'completed',
    abort: 'aborted',
    'source-incomplete': 'source-incomplete',
  },
  completed: {},
  aborted: {},
  'source-incomplete': {},
  'readonly-skipped': {},
  failed: {},
} as const satisfies Record<
  StreamLifecycleState,
  Partial<Record<StreamLifecycleSignal, StreamLifecycleState>>
>;

/** 终态集合（satisfies 穷举校验元素合法性） */
const TERMINAL_STREAM_STATES = [
  'completed',
  'aborted',
  'source-incomplete',
  'readonly-skipped',
  'failed',
] as const satisfies readonly StreamLifecycleState[];

/** 应用一个信号，返回下一状态；无合法转换时保持原态（含终止态守卫）。 */
export function advanceStreamLifecycle(
  current: StreamLifecycleState,
  signal: StreamLifecycleSignal,
): StreamLifecycleState {
  const next: StreamLifecycleState | undefined = (
    STREAM_LIFECYCLE_TRANSITIONS[current] as Partial<
      Record<StreamLifecycleSignal, StreamLifecycleState>
    >
  )[signal];
  return next ?? current;
}

/** 是否终态（生命周期已结束，不再接受任何转换）。 */
export function isTerminalStreamState(state: StreamLifecycleState): boolean {
  return (TERMINAL_STREAM_STATES as readonly StreamLifecycleState[]).includes(state);
}

/**
 * 从终态派生对外 `interrupted` 语义（落盘 interrupted 节点 / 续写状态回写用）：
 * 用户中止与源侧未完成对外同为「中断」，但状态机内部保留区分以便观测与测试。
 */
export function isInterruptedStreamState(state: StreamLifecycleState): boolean {
  return state === 'aborted' || state === 'source-incomplete';
}
