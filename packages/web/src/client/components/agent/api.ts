/**
 * REST API 调用（agent 相关端点）
 */
import type { ConversationNode, NodeContent } from '@qcqx/lattice-agent-protocol';
import { authStore } from '../../store';
import { agentStore, ensureUi } from './store';
import type { TurnNode } from './types';
import { buildTurnsFromNodes, restoreStreamingTurns, fillInterruptedStreams } from './turnGraph';

function getHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authStore.token) h.Authorization = `Bearer ${authStore.token}`;
  return h;
}

// ── 对话树加载 ──

export async function loadTree(treeId: string): Promise<void> {
  try {
    const res = await fetch(`/api/agent/tree/${treeId}`, { headers: getHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (data.error || !data.nodes?.length) return;

    const nodes = data.nodes as ConversationNode[];

    // 捕获在途流式 turn 的实时内容（避免全量重建冲掉未落盘的累积）
    const liveStreaming = new Map<string, NodeContent[]>();
    for (const [id, t] of agentStore.turns) {
      // 只要处于流式态就捕获（包括尚未收到首 token、blocks 为空的）
      if (t.status === 'streaming') liveStreaming.set(id, t.blocks);
    }

    // 纯函数重建 + 流式恢复 + 中断填充（数据逻辑见 turnGraph.ts，可独立测试）
    const turns = buildTurnsFromNodes(nodes);
    restoreStreamingTurns(turns, liveStreaming);
    if (data.interruptedStreams?.length) {
      fillInterruptedStreams(turns, data.interruptedStreams);
    }

    // 写入 store
    agentStore.turns.clear();
    for (const [id, turn] of turns) {
      agentStore.turns.set(id, turn);
      ensureUi(id);
    }
    agentStore.version++;
  } catch {
    /* ignore */
  }
}

// ── 源/模型 ──

export async function loadSources(): Promise<void> {
  try {
    const res = await fetch('/api/agent/sources', { headers: getHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    agentStore.sources = data.sources ?? [];
  } catch {
    /* ignore */
  }
}

export async function loadModels(sourceId?: string): Promise<void> {
  try {
    const qs = sourceId ? `?sourceId=${sourceId}` : '';
    const res = await fetch(`/api/agent/models${qs}`, { headers: getHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    agentStore.models = data.models ?? [];
    if (agentStore.models.length > 0 && !agentStore.activeModelId) {
      agentStore.activeModelId = agentStore.models[0].id;
    }
  } catch {
    /* ignore */
  }
}

// ── 历史会话 ──

export async function loadConversations(): Promise<void> {
  try {
    const res = await fetch('/api/agent/conversations', { headers: getHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    agentStore.conversations = data.conversations ?? [];
  } catch {
    /* ignore */
  }
}

export async function deleteConversationApi(treeId: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
  const res = await fetch(`/api/agent/conversations/${treeId}`, { method: 'DELETE', headers });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}
