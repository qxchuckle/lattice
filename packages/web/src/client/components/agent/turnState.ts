/**
 * turnState — 客户端 turn 视图状态投影（薄适配）
 *
 * 投影规则的单一真相在 protocol/node-state.ts（server 下发能力与命令守卫用同一函数）。
 * 本文件仅做类型适配（ViewStatus → TurnNode['status']），不重写判定逻辑。
 */
import type { ConversationNode } from '@qcqx/lattice-agent-protocol';
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
