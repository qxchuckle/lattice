/**
 * node-state — 节点状态机（跨层共享的单一真相）
 *
 * 集中定义节点状态语义、操作守卫、后代标记规则、视图投影。
 * server（ConversationController 的转换/守卫）与 client（turnState 的投影）均复用本模块，
 * 确保状态规则单点维护、不分散、不漂移。纯函数、零依赖。
 *
 * 持久化节点状态（ConversationNode.status）：
 *   active(默认/undefined) | interrupted | error | undone | hidden
 *   （streaming 仅类型保留，不落盘——流式是客户端瞬时态）
 */
import type { NodeStatus } from './conversation.js';
import type { ForkCapability } from './capabilities.js';

/** 客户端视图状态（含流式瞬时态 streaming 与 error 派生态） */
export type ViewStatus = 'streaming' | 'done' | 'error' | 'interrupted' | 'undone' | 'hidden';

/** 节点可执行的操作 */
export type NodeOperation = 'continue' | 'retry' | 'undo' | 'delete';

/** 只读终态：undone/hidden 不可再操作 */
export function isReadOnly(status: NodeStatus | undefined): boolean {
  return status === 'undone' || status === 'hidden';
}

// ── turn 视图态状态机（流式生命周期的单一真相） ──

/**
 * 视图态转换信号（驱动 streaming 生命周期）：
 * - start：发起/重试/续写 → 进入 streaming
 * - done：源正常结束
 * - error：源报错
 * - abort：用户/他端中止
 */
export type ViewSignal = 'start' | 'done' | 'error' | 'abort';

/**
 * ViewStatus 转换表：显式状态机，集中所有合法转换（替代散落各文件的 if/else 赋值）。
 * 铁律：undone/hidden 是**终止态**（用户已撤销/删除），任何信号都不改变它——
 * 防「已删节点被迟到的 done 事件复活」（旧代码散落在多处的 undone/hidden 判空）。
 * settled 态（done/error/interrupted）可被 start 拉回 streaming（continue/retry）。
 */
const VIEW_TRANSITIONS: Record<ViewStatus, Partial<Record<ViewSignal, ViewStatus>>> = {
  streaming: { done: 'done', error: 'error', abort: 'interrupted', start: 'streaming' },
  done: { start: 'streaming' },
  error: { start: 'streaming' },
  interrupted: { start: 'streaming', done: 'done', error: 'error' },
  undone: {},
  hidden: {},
};

/** 应用一个信号，返回下一视图态；无合法转换时保持原态（含终止态守卫）。 */
export function advanceViewStatus(current: ViewStatus, signal: ViewSignal): ViewStatus {
  return VIEW_TRANSITIONS[current][signal] ?? current;
}

/** 是否终止态（不接受任何转换，也不应再累积内容）。 */
export function isTerminalViewStatus(status: ViewStatus): boolean {
  return status === 'undone' || status === 'hidden';
}

/**
 * 操作守卫：该操作能否作用于该状态的节点。
 * - delete：undone→hidden 合法，仅已 hidden 不可重复；
 * - continue/retry/undo：不作用于只读终态（undone/hidden）。
 */
export function canApplyOperation(op: NodeOperation, status: NodeStatus | undefined): boolean {
  if (op === 'delete') return status !== 'hidden';
  return !isReadOnly(status);
}

/**
 * 标记后代时的跳过规则：undo 标记 undone 时不复活已删除（hidden）的后代。
 * delete 标记 hidden 时所有后代都标 hidden，无需跳过。
 */
export function shouldSkipDescendantMark(
  targetStatus: 'undone' | 'hidden',
  current: NodeStatus | undefined,
): boolean {
  return targetStatus === 'undone' && current === 'hidden';
}

/** auto-fork 是否计入该子节点：只计活跃（非只读终态）的 user 子节点 */
export function isBranchableChild(status: NodeStatus | undefined): boolean {
  return !isReadOnly(status);
}

// ── 节点能力投影（驱动客户端渲染的单一真相） ──

/**
 * 节点可操作能力（视图层）。
 * 客户端按钮/输入区渲染与交互入口一律从本对象读取，禁止在组件内重新推导；
 * server 端对应操作守卫走 canApplyOperation（持久化状态，纵深防御）。
 */
export interface NodeCapabilities {
  /** 分支：从同一父节点重新提问 */
  canBranch: boolean;
  /** 撤销：节点及后代标记只读 */
  canUndo: boolean;
  /** 删除：撤销 + 隐藏（undone→hidden 合法） */
  canDelete: boolean;
  /** 重试/重新生成 */
  canRetry: boolean;
  /** 继续：对中断回复续写 */
  canContinue: boolean;
  /** 底部追问输入（模型可换，源跟随线程） */
  canFollowup: boolean;
  /** 中止流式 */
  canAbort: boolean;
}

/**
 * 能力投影上下文：节点状态之外的源能力维度（来自 ResolvedManifest）。
 * server 计算时必传；client 仅在 streaming 瞬时态本地过渡时可缺省（宽松默认）。
 */
export interface NodeCapabilityContext {
  /** 该节点所属线程源的 fork 能力（影响 canBranch/canRetry：非头部重问需要 fork） */
  fork: ForkCapability;
  /**
   * 该节点是否位于线程末尾（无活跃后代）。
   *
   * 为何必需：`fork.atMessage=false` 的源（如 ACP）只能从会话**末尾**分叉，
   * 从中间节点重问/重试做不到。缺省 true = 当作末尾（向后兼容旧调用点）。
   */
  isTail?: boolean;
}

/** ctx 缺省时的宽松默认（等价旧行为：不按源能力收紧） */
const PERMISSIVE_CTX: NodeCapabilityContext = { fork: { atMessage: true }, isTail: true };

/**
 * 能力不变量校验（状态机铁律，投影返回前断言）：
 * - streaming：canAbort 必开，结构操作（branch/undo/delete/retry/continue）全关；
 * - 非流式：canAbort 必关；
 * - undone（只读）：仅 canDelete 合法（undone→hidden），其余全关；
 * - hidden（只读终态）：全关。
 */
export function isValidNodeCapabilities(viewStatus: ViewStatus, caps: NodeCapabilities): boolean {
  const streaming = viewStatus === 'streaming';
  if (caps.canAbort !== streaming) return false;
  if (streaming) {
    return (
      !caps.canBranch && !caps.canUndo && !caps.canDelete && !caps.canRetry && !caps.canContinue
    );
  }
  if (viewStatus === 'undone' || viewStatus === 'hidden') {
    if (caps.canBranch || caps.canUndo || caps.canRetry || caps.canContinue || caps.canFollowup) {
      return false;
    }
    // delete 对 undone 合法（降级为 hidden）；hidden 不可重复删除
    return viewStatus === 'undone' || !caps.canDelete;
  }
  return true;
}

/**
 * 从视图状态 + 源能力投影节点能力（与 canApplyOperation 语义一致：
 * undone/hidden 只读；delete 对 undone 合法；流式中禁止结构操作）。
 * streaming 是客户端瞬时态，故基于 ViewStatus 而非持久化状态。
 *
 * 单一真相链路：server 用本函数计算并随 wire DTO 下发（派生数据不落盘），
 * server 命令入口用同一函数守卫——接口行为 ≡ 视图。
 */
export function projectNodeCapabilities(
  viewStatus: ViewStatus,
  ctx: NodeCapabilityContext = PERMISSIVE_CTX,
): NodeCapabilities {
  const streaming = viewStatus === 'streaming';
  // ViewStatus 的 undone/hidden/error/interrupted 与持久化状态同名同义，其余视图态均映射自活跃节点
  const persisted: NodeStatus =
    viewStatus === 'undone' || viewStatus === 'hidden'
      ? viewStatus
      : viewStatus === 'interrupted'
        ? 'interrupted'
        : viewStatus === 'error'
          ? 'error'
          : 'active';
  // 分支/重试 = 从锚点重问，需源具备 fork 能力。
  // 两个粒度都要门：
  //   fork === false          → 根本不能分叉
  //   fork.atMessage === false → 只能从会话末尾分叉（中间节点做不到）
  // 后者对应的产品事实：该源只支持线形对话，非末尾节点不能再分支。
  const isTail = ctx.isTail ?? true;
  const forkable = ctx.fork !== false && (ctx.fork.atMessage || isTail);
  const caps: NodeCapabilities = {
    canBranch: !streaming && !isReadOnly(persisted) && forkable,
    canUndo: !streaming && canApplyOperation('undo', persisted),
    canDelete: !streaming && canApplyOperation('delete', persisted),
    canRetry: (viewStatus === 'error' || viewStatus === 'interrupted') && forkable,
    canContinue: viewStatus === 'interrupted',
    canFollowup: !isReadOnly(persisted),
    canAbort: streaming,
  };
  // 不变量断言：投影规则与状态机铁律漂移即抛错（fail-fast，防错误能力下发至客户端）
  if (!isValidNodeCapabilities(viewStatus, caps)) {
    throw new Error(
      `projectNodeCapabilities invariant violation: ${viewStatus} -> ${JSON.stringify(caps)}`,
    );
  }
  return caps;
}

/**
 * 视图投影优先级：undone > hidden > error(持久化态/内容) > interrupted > done。
 * streaming 为客户端流式瞬时态，不参与本投影（由连接层单独设置）。
 * error 依据持久化 error 态或内容块判定（source 真实报错），优先于 interrupted，保证 live/reload 一致。
 */
export function projectViewStatus(
  nodeStatus: NodeStatus | undefined,
  hasError: boolean,
): ViewStatus {
  if (nodeStatus === 'undone') return 'undone';
  if (nodeStatus === 'hidden') return 'hidden';
  if (nodeStatus === 'error' || hasError) return 'error';
  if (nodeStatus === 'interrupted') return 'interrupted';
  return 'done';
}

/**
 * 流结束后的持久化状态归置（单一真相，禁止调用方内联判断）：
 * - 用户中止 → interrupted（用户意图优先，即使流内出现过 error 事件）
 * - 源报错（error 事件）→ error
 * - 源未完成（无 done 断流）→ interrupted
 * - 正常完成 → active
 */
export function resolveSettledNodeStatus(outcome: {
  userAborted: boolean;
  hasError: boolean;
  sourceIncomplete: boolean;
}): NodeStatus {
  if (outcome.userAborted) return 'interrupted';
  if (outcome.hasError) return 'error';
  if (outcome.sourceIncomplete) return 'interrupted';
  return 'active';
}

// ── turn 级投影（UI 以 turn 为单位渲染：user 节点 + 其 assistant 子节点） ──

/** 投影所需的最小节点形状（不绑完整 ConversationNode，便于测试与壳层适配） */
export interface TurnProjectionNode {
  status?: NodeStatus;
  content?: ReadonlyArray<{ type: string }>;
}

/**
 * 从持久化的 user/assistant 节点投影出 turn 视图状态。
 * server（下发能力与命令守卫）与 client（渲染）共用本函数，保证接口行为 ≡ 视图。
 */
export function deriveTurnViewStatus(
  userNode: TurnProjectionNode,
  assistantNode: TurnProjectionNode | undefined,
): ViewStatus {
  const nodeStatus = userNode.status ?? assistantNode?.status;
  const hasError = assistantNode?.content?.some((c) => c.type === 'error') ?? false;
  return projectViewStatus(nodeStatus, hasError);
}

/**
 * turn 能力投影（单一真相）：server 据此随 wire DTO 下发并守卫命令入口，
 * client 直接渲染——两边同一函数，绕过 UI 直请接口时行为完全一致。
 */
export function projectTurnCapabilities(
  userNode: TurnProjectionNode,
  assistantNode: TurnProjectionNode | undefined,
  ctx?: NodeCapabilityContext,
): NodeCapabilities {
  return projectNodeCapabilities(deriveTurnViewStatus(userNode, assistantNode), ctx);
}
