/**
 * Agent 状态（valtio proxy）+ 纯查询函数
 */
import { proxy } from 'valtio';
import type { SourceInfo, ModelInfo } from '@qcqx/lattice-agent-protocol';
import type { TurnNode, NodeUiState, ConversationEntry } from './types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from './types';

export const agentStore = proxy({
  turns: new Map<string, TurnNode>(),
  ui: new Map<string, NodeUiState>(),
  sessionId: null as string | null,
  treeId: null as string | null,
  connected: false,
  sources: [] as SourceInfo[],
  models: [] as ModelInfo[],
  activeSourceId: 'qoder' as string,
  activeModelId: '' as string,
  visible: false,
  version: 0,
  conversations: [] as ConversationEntry[],
  historyOpen: false,
});

// ── 内部辅助 ──

export function ensureUi(nodeId: string): NodeUiState {
  let ui = agentStore.ui.get(nodeId);
  if (!ui) {
    ui = { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
    agentStore.ui.set(nodeId, ui);
  }
  return ui;
}

// ── 查询函数 ──

export function getChildIds(nodeId: string): string[] {
  const children: string[] = [];
  for (const [id, turn] of agentStore.turns) {
    if (turn.parentTurnId === nodeId) children.push(id);
  }
  return children.sort(
    (a, b) => agentStore.turns.get(a)!.timestamp - agentStore.turns.get(b)!.timestamp,
  );
}

export function getSiblings(nodeId: string): string[] {
  const node = agentStore.turns.get(nodeId);
  if (!node) return [];
  const siblings: string[] = [];
  for (const [id, turn] of agentStore.turns) {
    if (turn.parentTurnId === node.parentTurnId) siblings.push(id);
  }
  return siblings.sort(
    (a, b) => agentStore.turns.get(a)!.timestamp - agentStore.turns.get(b)!.timestamp,
  );
}

export function getTotalUsage(): { input: number; output: number } {
  let input = 0,
    output = 0;
  for (const turn of agentStore.turns.values()) {
    if (turn.usage) {
      input += turn.usage.input ?? 0;
      output += turn.usage.output ?? 0;
    }
  }
  return { input, output };
}
