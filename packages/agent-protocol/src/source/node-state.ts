/**
 * node-state — 节点状态机（跨层共享的单一真相）
 *
 * 集中定义节点状态语义、操作守卫、后代标记规则、视图投影。
 * server（ConversationController 的转换/守卫）与 client（turnState 的投影）均复用本模块，
 * 确保状态规则单点维护、不分散、不漂移。纯函数、零依赖。
 *
 * 持久化节点状态（ConversationNode.status）：
 *   active(默认/undefined) | interrupted | undone | hidden
 *   （streaming 仅类型保留，不落盘——流式是客户端瞬时态）
 */
import type { NodeStatus } from './conversation.js';

/** 客户端视图状态（含流式瞬时态 streaming 与 error 派生态） */
export type ViewStatus = 'streaming' | 'done' | 'error' | 'interrupted' | 'undone' | 'hidden';

/** 节点可执行的操作 */
export type NodeOperation = 'continue' | 'retry' | 'undo' | 'delete';

/** 只读终态：undone/hidden 不可再操作 */
export function isReadOnly(status: NodeStatus | undefined): boolean {
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
 * 从视图状态投影节点能力（与 canApplyOperation 语义一致：
 * undone/hidden 只读；delete 对 undone 合法；流式中禁止结构操作）。
 * streaming 是客户端瞬时态，故本函数基于 ViewStatus 而非持久化状态。
 */
export function computeNodeCapabilities(viewStatus: ViewStatus): NodeCapabilities {
  const streaming = viewStatus === 'streaming';
  // ViewStatus 的 undone/hidden 与持久化状态同名同义，其余视图态均映射自活跃节点
  const persisted: NodeStatus =
    viewStatus === 'undone' || viewStatus === 'hidden'
      ? viewStatus
      : viewStatus === 'interrupted'
        ? 'interrupted'
        : 'active';
  return {
    canBranch: !streaming && !isReadOnly(persisted),
    canUndo: !streaming && canApplyOperation('undo', persisted),
    canDelete: !streaming && canApplyOperation('delete', persisted),
    canRetry: viewStatus === 'error' || viewStatus === 'interrupted',
    canContinue: viewStatus === 'interrupted',
    canFollowup: !isReadOnly(persisted),
    canAbort: streaming,
  };
}

/**
 * 视图投影优先级：undone > hidden > error(内容) > interrupted > done。
 * streaming 为客户端流式瞬时态，不参与本投影（由连接层单独设置）。
 * error 依据内容块判定（source 真实报错），优先于 interrupted，保证 live/reload 一致。
 */
export function projectViewStatus(
  nodeStatus: NodeStatus | undefined,
  hasError: boolean,
): ViewStatus {
  if (nodeStatus === 'undone') return 'undone';
  if (nodeStatus === 'hidden') return 'hidden';
  if (hasError) return 'error';
  if (nodeStatus === 'interrupted') return 'interrupted';
  return 'done';
}
