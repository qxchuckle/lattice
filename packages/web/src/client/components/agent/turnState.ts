/**
 * turnState — 客户端 turn 视图状态投影
 *
 * 状态机规则的单一真相在 protocol/node-state.ts（server/client 共享）。
 * 本文件仅做客户端适配：从持久化节点提取 hasError，委托 projectViewStatus 投影。
 */
import type { ConversationNode } from '@qcqx/lattice-agent-protocol';
import { projectViewStatus } from '@qcqx/lattice-agent-protocol';
import type { TurnNode } from './types';

/**
 * 从持久化的 user/assistant 节点投影出客户端 turn 视图状态。
 * 与 live 流式态（streaming）无关——streaming 由连接层在流式期间单独设置。
 */
export function deriveTurnStatus(
  userNode: ConversationNode,
  assistantNode: ConversationNode | undefined,
): TurnNode['status'] {
  const nodeStatus = userNode.status ?? assistantNode?.status;
  const hasError = assistantNode?.content?.some((c) => c.type === 'error') ?? false;
  return projectViewStatus(nodeStatus, hasError);
}
