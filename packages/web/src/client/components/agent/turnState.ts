/**
 * turnState — 客户端 turn 视图状态投影（薄适配）
 *
 * 投影规则的单一真相在 protocol/node-state.ts（server 下发能力与命令守卫用同一函数）。
 * 本文件仅做类型适配（ViewStatus → TurnNode['status']），不重写判定逻辑。
 */
import type { ConversationNode, NodeStatus, ViewStatus } from '@qcqx/lattice-agent-protocol';
import { deriveTurnViewStatus } from '@qcqx/lattice-agent-protocol';
import type { TurnNode } from './types';

/**
 * 从持久化的 user/assistant 节点投影出客户端 turn 视图状态。
 * 与 live 流式态（streaming）无关——streaming 由连接层在流式期间单独设置。
 */
export function deriveTurnStatus(
  userNode: ConversationNode,
  assistantNode: ConversationNode | undefined,
): TurnNode['status'] {
  return deriveTurnViewStatus(userNode, assistantNode);
}

/**
 * ViewStatus → NodeStatus 反向适配（供 canApplyOperation / shouldSkipDescendantMark 等
 * 接受 NodeStatus 的 protocol 谓词消费客户端 ViewStatus）：
 * 'done' 是活跃节点的视图投影（projectViewStatus 的兑底分支），对应持久化 'active'；
 * 其余视图态与持久化态同名同义，直接透传。
 */
export function viewToNodeStatus(status: ViewStatus): NodeStatus {
  return status === 'done' ? 'active' : status;
}

/** 是否流式瞬时态（客户端唯一合法的 streaming 内联判断收口） */
export function isStreamingStatus(status: ViewStatus | undefined): boolean {
  return status === 'streaming';
}

/** turn 是否在树中展示（hidden = 已删除不渲染；与 getVisibleTurns 口径一致） */
export function isVisibleTurnStatus(status: ViewStatus | undefined): boolean {
  return status !== 'hidden';
}

/** 节点样式标志（仅供边框/配色/占位映射，不参与交互入口判断——交互走能力投影） */
export interface TurnStyleFlags {
  isStreaming: boolean;
  isError: boolean;
  isInterrupted: boolean;
  isUndone: boolean;
  isHidden: boolean;
}

/** 从 turn 视图状态投影样式标志（单点收口，替代组件内散落的 status === 'xxx' 内联判断） */
export function turnStyleFlags(status: ViewStatus | undefined): TurnStyleFlags {
  return {
    isStreaming: status === 'streaming',
    isError: status === 'error',
    isInterrupted: status === 'interrupted',
    isUndone: status === 'undone',
    isHidden: status === 'hidden',
  };
}
