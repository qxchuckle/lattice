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

export type { TurnNode, NodeUiState, ConversationEntry } from './types';
export {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  ROOT_INPUT_ID,
} from './types';
export {
  agentStore,
  ensureUi,
  putTurn,
  getChildIds,
  getSiblings,
  getTotalUsage,
  stableNodeData,
  clearNodeDataCache,
} from './store';
export { connectAgentWs } from './connection';
export {
  loadSources,
  loadModels,
  fetchModels,
  fetchModelsCached,
  clearModelListCache,
  loadConversations,
  loadAgentConfig,
} from './api';
export type { AgentClientConfig } from './api';

// ── Actions（高层操作，组合 store + connection + api） ──

import { agentStore, ensureUi, putTurn, clearNodeDataCache } from './store';
import {
  sendWs,
  isWsReady,
  connectAgentWs,
  setStreamingTarget,
  unsubscribeTree,
} from './connection';
import { resetLastAppliedRev } from './sync';
import {
  loadModels,
  loadSources,
  loadConversations,
  deleteConversationApi,
  loadAgentConfig,
} from './api';
import { MIN_NODE_WIDTH, MIN_NODE_HEIGHT } from './types';
import type { TurnNode } from './types';
import type { PromptSegment } from '@qcqx/lattice-agent-protocol';

// ── 提交消息 ──

export function submitFromNode(
  parentTurnId: string | null,
  message: string,
  opts?: { model?: string; segments?: PromptSegment[] },
): string | null {
  if (!message.trim()) return null;

  // 源/模型解析：新第一层线程用当前选择；追问继承父节点（源不可换，模型可按节点覆盖）
  const parentTurn = parentTurnId ? agentStore.turns.get(parentTurnId) : undefined;
  const sourceId = parentTurn ? parentTurn.sourceId : agentStore.activeSourceId;
  const modelId = opts?.model ?? (parentTurn ? parentTurn.modelId : agentStore.activeModelId);
  // 参数标注：root 用当前选择；追问继承父节点（server 侧同样规则，展示与实际一致）
  const thinkingLevel = parentTurn
    ? parentTurn.thinkingLevel
    : agentStore.activeThinkingLevel || undefined;
  const contextWindow = parentTurn
    ? parentTurn.contextWindow
    : agentStore.activeContextWindow || undefined;

  // 懒创建 session：新对话发消息时才连接
  if (!agentStore.sessionId) {
    if (!isWsReady()) {
      connectAgentWs();
    }
    // 发送 session.create 并等待响应
    sendWs({
      type: 'session.create',
      agentId: sourceId,
      treeId: agentStore.treeId ?? undefined,
    });
    // 等待 session 建立后重试（最多 5 次，每次 300ms）
    let attempts = 0;
    const waitForSession = () => {
      attempts++;
      if (agentStore.sessionId) {
        submitFromNode(parentTurnId, message, opts);
      } else if (attempts < 5) {
        setTimeout(waitForSession, 300);
      } else {
        // 超时：创建 error 状态的 turn（用户可见 + 可重试）
        const turnId = crypto.randomUUID();
        const turn: TurnNode = {
          id: turnId,
          parentTurnId,
          userMessage: message.trim(),
          blocks: [{ type: 'error', message: '连接服务器失败，请检查 server 是否运行' }],
          status: 'error',
          timestamp: Date.now(),
          sourceId,
          modelId,
        };
        putTurn(turn);
        ensureUi(turnId);
        agentStore.version++;
      }
    };
    setTimeout(waitForSession, 300);
    return null;
  }

  if (!isWsReady()) {
    connectAgentWs();
    setTimeout(() => submitFromNode(parentTurnId, message, opts), 500);
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
    sourceId,
    modelId,
    thinkingLevel,
    contextWindow,
  };
  putTurn(turn);
  ensureUi(turnId);
  setStreamingTarget(turnId, requestId);
  agentStore.version++;

  sendWs({
    type: 'session.send',
    sessionId: agentStore.sessionId,
    message: message.trim(),
    segments: opts?.segments,
    parentNodeId: parentTurnId,
    requestId,
    model: modelId || undefined,
    // 参数：root 用全局选择；追问用节点参数（节点作用域编辑后的值，未编辑时等同线程继承值）
    thinkingLevel: thinkingLevel || undefined,
    contextWindow: contextWindow || undefined,
    // 源仅对新第一层线程生效（server 对追问沿祖先链解析）
    sourceId,
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
    // 清除流式路由映射：避免后续延迟事件/错误覆盖中断态，也防止残留映射
    setStreamingTarget(null, turnId);
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
  // contentOnly=false：retry 会标记后代 undone（结构性变化），完成后必须重载以同步后代状态
  setStreamingTarget(turnId, turnId, false);

  // 发送 session.retry，server 会 fork 截断 + 重新 prompt
  sendWs({
    type: 'session.retry',
    sessionId: agentStore.sessionId,
    nodeId: turnId,
    requestId: turnId,
  });
}

// ── 撤销（目标节点及后代标记为 undone，只读灰色） ──

/**
 * 乐观标记本地子树状态（undo/delete 即时反馈，不等 server 往返）。
 * 规则与 server markNodes 一致：undo 不复活已 hidden 的后代；
 * server 处理完发 tree.updated → loadTree 校准最终状态。
 */
function markLocalSubtree(turnId: string, status: 'undone' | 'hidden'): void {
  const mark = (id: string): void => {
    const t = agentStore.turns.get(id);
    if (!t) return;
    if (!(status === 'undone' && t.status === 'hidden')) t.status = status;
    for (const [cid, c] of agentStore.turns) {
      if (c.parentTurnId === id) mark(cid);
    }
  };
  mark(turnId);
  agentStore.version++;
}

export function undoTurn(turnId: string): void {
  const turn = agentStore.turns.get(turnId);
  if (!turn || !agentStore.sessionId) return;

  sendWs({
    type: 'session.undo',
    sessionId: agentStore.sessionId,
    nodeId: turnId,
  });
  markLocalSubtree(turnId, 'undone');
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
  markLocalSubtree(turnId, 'hidden');
}

// ── presence（多端同步：本端在场状态上报，节流） ──

let presenceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPresence: { focusNodeId?: string | null; typing?: boolean } = {};

/** 节流上报本端 presence（focus/typing）给同树其他端 */
export function reportPresence(patch: { focusNodeId?: string | null; typing?: boolean }): void {
  pendingPresence = { ...pendingPresence, ...patch };
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    if (agentStore.treeId && agentStore.sessionId) {
      sendWs({ type: 'presence.update', treeId: agentStore.treeId, ...pendingPresence });
    }
    pendingPresence = {};
  }, 300);
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
  agentStore.activeThinkingLevel = '';
  agentStore.activeContextWindow = 0;
  loadModels(sourceId);
}

export function setModel(modelId: string): void {
  agentStore.activeModelId = modelId;
  // 参数选择随模型重置（回到该模型 tuning 规格的默认值）
  agentStore.activeThinkingLevel = '';
  agentStore.activeContextWindow = 0;
}

// ── 会话管理 ──

export async function switchConversation(treeId: string): Promise<void> {
  if (agentStore.sessionId) sendWs({ type: 'session.destroy', sessionId: agentStore.sessionId });
  if (agentStore.treeId) unsubscribeTree(agentStore.treeId); // 退订旧树（不拆树资源）
  resetLastAppliedRev(); // 重置 rev 基线（新树从 0 计）
  clearNodeDataCache();
  agentStore.sessionId = null;
  agentStore.turns.clear();
  agentStore.ui.clear();
  agentStore.peers = [];
  agentStore.treeId = treeId;
  agentStore.version++;

  // WS 未就绪时发起连接：onopen 会按 treeId 兜底 session.create（避免消息丢失看不了历史）
  if (!isWsReady()) {
    connectAgentWs();
    return;
  }
  sendWs({ type: 'session.create', agentId: agentStore.activeSourceId, treeId });
}

export function newConversation(): void {
  // 纯前端假对话：不连接 WS，不创建 session，等发消息时才懒创建
  if (agentStore.treeId) unsubscribeTree(agentStore.treeId); // 退订旧树（与 switchConversation 一致）
  resetLastAppliedRev();
  clearNodeDataCache();
  agentStore.sessionId = null;
  agentStore.treeId = null;
  agentStore.turns.clear();
  agentStore.ui.clear();
  agentStore.peers = [];
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
    // WS 最先连接：对话/历史不被源模型目录加载阻塞（首次动态目录需起 CLI，秒级）
    connectAgentWs();
    await loadSources();
    // 应用配置页的默认源/默认模型（local config agent 段）
    const cfg = await loadAgentConfig();
    if (cfg.defaultSource && agentStore.sources.some((s) => s.id === cfg.defaultSource)) {
      agentStore.activeSourceId = cfg.defaultSource;
    }
    await loadModels(agentStore.activeSourceId);
    if (cfg.defaultModel && agentStore.models.some((m) => m.id === cfg.defaultModel)) {
      agentStore.activeModelId = cfg.defaultModel;
    }
  } finally {
    initializing = false;
  }
}
