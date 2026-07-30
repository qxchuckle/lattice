/**
 * session-state — 会话生命周期状态机（SessionContext 阶段真相）
 *
 * 范式对齐 node-state.ts / stream-lifecycle.ts / runtime-state.ts：
 * 显式转换表 + advance 纯函数 + 终态守卫，零依赖纯函数。
 *
 * 状态语义（对应 controller 中原先靠 `ctx.treeId: string | null` 的隐式表达）：
 * - idle          已建连接，树未创建（首条消息前）
 * - initializing  首条消息懒创建树进行中（原先无此中间态，仅靠结构队列排队保证安全）
 * - active        树已就绪（懒创建成功 / createSession 直接挂接已有树）
 * - destroyed     终态：连接已销毁（destroySession），拒绝一切新命令
 *
 * 不建 suspended/destroying 状态：destroySession 是同步删 Map 条目（无异步拆除流程），
 * 会话也没有挂起/恢复流程——为不存在的代码路径造状态违反忠实建模。
 *
 * idle --tree-created--> active 的直达边对应真实路径：createSession 传入已有 treeId
 * （重连/多端进入同一棵树），树已存在无需经过 initializing。
 */

/** 会话生命周期状态 */
export type SessionState = 'idle' | 'initializing' | 'active' | 'destroyed';

/**
 * 生命周期转换信号：
 * - tree-init：首条消息触发树懒创建（doSend 进入 createTree）
 * - tree-created：树就绪（懒创建成功 / 挂接已有树）
 * - tree-init-failed：树创建失败 → 回退 idle（错误经 enqueue promise 传播给 caller）
 * - destroy：连接销毁（destroySession，幂等）
 */
export type SessionSignal = 'tree-init' | 'tree-created' | 'tree-init-failed' | 'destroy';

/**
 * 转换表：显式状态机，集中所有合法转换。
 * 终态 destroyed 不接受任何信号（重复 destroy 保持原态 → 幂等）；
 * 非法转换保持当前状态（与 node-state.ts 策略一致，不抛错、不产生非法态）。
 */
const SESSION_TRANSITIONS = {
  idle: { 'tree-init': 'initializing', 'tree-created': 'active', destroy: 'destroyed' },
  initializing: { 'tree-created': 'active', 'tree-init-failed': 'idle', destroy: 'destroyed' },
  active: { destroy: 'destroyed' },
  destroyed: {},
} as const satisfies Record<SessionState, Partial<Record<SessionSignal, SessionState>>>;

export { SESSION_TRANSITIONS };

/** 终态集合（satisfies 穷举校验元素合法性） */
const TERMINAL_SESSION_STATES = ['destroyed'] as const satisfies readonly SessionState[];

/** 应用一个信号，返回下一状态；无合法转换时保持原态（含终态守卫）。 */
export function advanceSessionState(current: SessionState, signal: SessionSignal): SessionState {
  const next: SessionState | undefined = (
    SESSION_TRANSITIONS[current] as Partial<Record<SessionSignal, SessionState>>
  )[signal];
  return next ?? current;
}

/** 是否终态（会话已销毁，拒绝一切新命令）。 */
export function isTerminalSessionState(state: SessionState): boolean {
  return (TERMINAL_SESSION_STATES as readonly SessionState[]).includes(state);
}
