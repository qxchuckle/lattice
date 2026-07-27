/**
 * agentStore — 公开 API（actions + re-exports）
 *
 * 内部拆分为：
 *   types.ts      类型 + 常量
 *   store.ts      valtio 状态 + 查询函数
 *   connection.ts WS + 事件处理
 *   api.ts        REST 调用
 */

// ── Re-exports（外部消费方统一从 './agentStore' 导入） ──

export type { StreamingBlock, TurnNode, NodeUiState, ConversationEntry } from './types';
export {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  ROOT_INPUT_ID,
} from './types';
export { agentStore, ensureUi, getChildIds, getSiblings, getTotalUsage } from './store';
export { connectAgentWs } from './connection';
export { loadSources, loadModels, loadConversations } from './api';

// ── Actions（高层操作，组合 store + connection + api） ──

import { agentStore, ensureUi } from './store';
import { sendWs, isWsReady, connectAgentWs, setStreamingTarget } from './connection';
import { loadModels, loadSources, loadConversations, deleteConversationApi } from './api';
import { MIN_NODE_WIDTH, MIN_NODE_HEIGHT } from './types';
import type { TurnNode } from './types';

// ── 提交消息 ──

export function submitFromNode(parentTurnId: string | null, message: string): string | null {
  if (!message.trim()) return null;

  // 懒创建 session：新对话发消息时才连接
  if (!agentStore.sessionId) {
    if (!isWsReady()) {
      connectAgentWs();
    }
    // 发送 session.create 并等待响应
    sendWs({
      type: 'session.create',
      agentId: agentStore.activeSourceId,
      treeId: agentStore.treeId ?? undefined,
    });
    // 等待 session 建立后重试（最多 5 次，每次 300ms）
    let attempts = 0;
    const waitForSession = () => {
      attempts++;
      if (agentStore.sessionId) {
        submitFromNode(parentTurnId, message);
      } else if (attempts < 5) {
        setTimeout(waitForSession, 300);
      } else {
        // 超时：创建 error 状态的 turn（用户可见 + 可重试）
        const turnId = crypto.randomUUID();
        const turn: TurnNode = {
          id: turnId,
          parentTurnId,
          userMessage: message.trim(),
          blocks: [{ kind: 'error', message: '连接服务器失败，请检查 server 是否运行' }],
          status: 'error',
          timestamp: Date.now(),
          sourceId: agentStore.activeSourceId,
          modelId: agentStore.activeModelId,
        };
        agentStore.turns.set(turnId, turn);
        ensureUi(turnId);
        agentStore.version++;
      }
    };
    setTimeout(waitForSession, 300);
    return null;
  }

  if (!isWsReady()) {
    connectAgentWs();
    setTimeout(() => submitFromNode(parentTurnId, message), 500);
    return null;
  }

  const turnId = crypto.randomUUID();
  const requestId = turnId; // 全栈统一 ID：turnId = requestId = persisted nodeId
  const turn: TurnNode = {
    id: turnId,
    parentTurnId,
    userMessage: message.trim(),
    blocks: [],
    status: 'streaming',
    timestamp: Date.now(),
    sourceId: agentStore.activeSourceId,
    modelId: agentStore.activeModelId,
  };
  agentStore.turns.set(turnId, turn);
  ensureUi(turnId);
  setStreamingTarget(turnId, requestId);
  agentStore.version++;

  sendWs({
    type: 'session.send',
    sessionId: agentStore.sessionId,
    message: message.trim(),
    parentNodeId: parentTurnId,
    requestId,
  });
  return turnId;
}

// ── 中止（支持精确中止单个流） ──

export function abortStream(turnId?: string): void {
  if (!agentStore.sessionId) return;
  // turnId === requestId（submitFromNode 中复用）
  sendWs({ type: 'session.abort', sessionId: agentStore.sessionId, requestId: turnId });
  // 立即更新 UI 状态为中断（不等 server 响应）
  if (turnId) {
    const turn = agentStore.turns.get(turnId);
    if (turn && turn.status === 'streaming') {
      turn.status = 'interrupted';
      agentStore.version++;
    }
  }
}

// ── 继续（对 interrupted 的 assistant 节点续写，不新增可见节点） ──

export function continueTurn(turnId: string): void {
  const turn = agentStore.turns.get(turnId);
  if (!turn || !agentStore.sessionId) return;

  // 重置状态为 streaming（在原节点上续写）
  turn.status = 'streaming';
  agentStore.version++;

  // 发送 session.continue，server 会在原节点上追加内容
  setStreamingTarget(turnId, turnId);
  sendWs({
    type: 'session.continue',
    sessionId: agentStore.sessionId,
    nodeId: turnId,
    requestId: turnId,
  });
}

// ── 重试（对 user 节点丢弃后代并重新生成） ──

export function retryTurn(turnId: string): void {
  const turn = agentStore.turns.get(turnId);
  if (!turn || !agentStore.sessionId) return;

  // 重置 turn 以展示重新生成的流式内容（旧回复 server 会标记 undone）
  turn.blocks = [];
  turn.status = 'streaming';
  agentStore.version++;
  setStreamingTarget(turnId, turnId);

  // 发送 session.retry，server 会 fork 截断 + 重新 prompt
  sendWs({
    type: 'session.retry',
    sessionId: agentStore.sessionId,
    nodeId: turnId,
    requestId: turnId,
  });
}

// ── 撤销（目标节点及后代标记为 undone，只读灰色） ──

export function undoTurn(turnId: string): void {
  const turn = agentStore.turns.get(turnId);
  if (!turn || !agentStore.sessionId) return;

  sendWs({
    type: 'session.undo',
    sessionId: agentStore.sessionId,
    nodeId: turnId,
  });
}

// ── 删除（撤销 + 隐藏） ──

export function deleteTurn(turnId: string): void {
  const turn = agentStore.turns.get(turnId);
  if (!turn || !agentStore.sessionId) return;

  sendWs({
    type: 'session.delete',
    sessionId: agentStore.sessionId,
    nodeId: turnId,
  });
}

// ── 节点尺寸 ──

export function liveResizeNode(nodeId: string, width: number, height: number): void {
  const ui = ensureUi(nodeId);
  ui.width = Math.round(Math.max(MIN_NODE_WIDTH, width));
  ui.height = Math.round(Math.max(MIN_NODE_HEIGHT, height));
}

export function setNodeSize(nodeId: string, width: number, height: number): void {
  const ui = ensureUi(nodeId);
  ui.width = Math.round(Math.max(MIN_NODE_WIDTH, width));
  ui.height = Math.round(Math.max(MIN_NODE_HEIGHT, height));
  agentStore.version++;
}

// ── 源/模型 ──

export function setSource(sourceId: string): void {
  agentStore.activeSourceId = sourceId;
  agentStore.activeModelId = '';
  loadModels(sourceId);
}

export function setModel(modelId: string): void {
  agentStore.activeModelId = modelId;
}

// ── 会话管理 ──

export async function switchConversation(treeId: string): Promise<void> {
  if (agentStore.sessionId) sendWs({ type: 'session.destroy', sessionId: agentStore.sessionId });
  agentStore.sessionId = null;
  agentStore.turns.clear();
  agentStore.ui.clear();
  agentStore.treeId = treeId;
  agentStore.version++;

  // 直接发送 session.create（WS 已连接）
  sendWs({ type: 'session.create', agentId: agentStore.activeSourceId, treeId });
}

export function newConversation(): void {
  // 纯前端假对话：不连接 WS，不创建 session，等发消息时才懒创建
  agentStore.sessionId = null;
  agentStore.treeId = null;
  agentStore.turns.clear();
  agentStore.ui.clear();
  agentStore.version++;
}

export async function deleteConversation(treeId: string): Promise<void> {
  try {
    await deleteConversationApi(treeId);
    agentStore.conversations = agentStore.conversations.filter((c) => c.treeId !== treeId);
    if (agentStore.treeId === treeId) newConversation();
  } catch {
    /* ignore */
  }
}

// ── 初始化 ──

let initializing = false;

export async function initAgent(): Promise<void> {
  if (initializing) return;
  initializing = true;
  try {
    await loadSources();
    await loadModels(agentStore.activeSourceId);
    connectAgentWs();
  } finally {
    initializing = false;
  }
}
