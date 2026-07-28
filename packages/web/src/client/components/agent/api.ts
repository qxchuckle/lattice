/**
 * REST API 调用（agent 相关端点）
 */
import type { ConversationNode, NodeContent } from '@qcqx/lattice-agent-protocol';
import { authStore } from '../../store';
import { agentStore, ensureUi } from './store';
import type { TurnNode } from './types';
import { deriveTurnStatus } from './turnState';
import { isReadOnly } from '@qcqx/lattice-agent-protocol';

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

    // 保留正在流式中的 turn 的实时内容：
    // 并行回答时某个 turn 完成会触发整树重载，但其他在途 turn 的 assistant 节点尚未落盘，
    // 全量重建会冲掉它们正在累积的内容，故先捕获、重建后恢复
    const liveStreaming = new Map<string, NodeContent[]>();
    for (const [id, t] of agentStore.turns) {
      // 只要处于流式态就捕获（包括尚未收到首 token、blocks 为空的，避免重载后误判为 done 空节点）
      if (t.status === 'streaming') {
        liveStreaming.set(id, t.blocks);
      }
    }

    agentStore.turns.clear();

    const userNodes = nodes.filter((n) => n.role === 'user');

    if (userNodes.length > 0) {
      // 新格式：user + assistant 配对
      for (const un of userNodes) {
        // 一个 user 可能有多个 assistant 子节点（retry 后旧的被标记 undone），优先取 active 的
        const assistantChildren = nodes.filter(
          (n) => n.role === 'assistant' && n.parentId === un.id,
        );
        const assistant =
          assistantChildren.find((n) => !isReadOnly(n.status)) ?? assistantChildren[0];
        const userText = un.content?.find((c) => c.type === 'text')?.text ?? '';

        let parentTurnId: string | null = null;
        if (un.parentId) {
          const parentAssistant = nodes.find((n) => n.id === un.parentId && n.role === 'assistant');
          parentTurnId = parentAssistant?.parentId ?? un.parentId;
        }

        // 节点状态投影（状态机单一真相，见 turnState.ts）
        const turnStatus = deriveTurnStatus(un, assistant);

        const turn: TurnNode = {
          id: un.id,
          parentTurnId,
          userMessage: userText,
          blocks: assistant?.content ?? [],
          status: turnStatus,
          timestamp: un.timestamp,
          sourceId: assistant?.agentId ?? 'qoder',
          modelId: assistant?.metadata?.model ?? '',
          usage: undefined,
        };
        agentStore.turns.set(turn.id, turn);
        ensureUi(turn.id);
      }
    } else {
      // 兼容旧格式：只有 assistant 节点，每个 assistant = 一个 turn
      const assistantNodes = nodes.filter((n) => n.role === 'assistant');
      for (const an of assistantNodes) {
        const text = an.content?.find((c) => c.type === 'text')?.text ?? '';
        const turn: TurnNode = {
          id: an.id,
          parentTurnId: an.parentId,
          userMessage: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
          blocks: an.content ?? [],
          status: 'done',
          timestamp: an.timestamp,
          sourceId: an.agentId ?? 'qoder',
          modelId: an.metadata?.model ?? '',
          usage: undefined,
        };
        agentStore.turns.set(turn.id, turn);
        ensureUi(turn.id);
      }
    }

    // 恢复在途流式 turn 的内容（server 端尚未落盘，客户端实时累积为准）
    for (const [id, blocks] of liveStreaming) {
      const turn = agentStore.turns.get(id);
      if (
        turn &&
        turn.blocks.length === 0 &&
        turn.status !== 'undone' &&
        turn.status !== 'hidden'
      ) {
        turn.blocks = [...blocks];
        turn.status = 'streaming';
      }
    }

    // 处理中断的 streaming（上次未完成的回复）
    const interruptedStreams = data.interruptedStreams as
      | { requestId: string; parentId: string; content: NodeContent[] }[]
      | undefined;
    if (interruptedStreams?.length) {
      for (const stream of interruptedStreams) {
        const turn = agentStore.turns.get(stream.parentId);
        if (turn && turn.blocks.length === 0) {
          // 该 user 节点没有 assistant 回复 → 用部分回复填充
          turn.blocks = stream.content;
          turn.status = 'interrupted';
        }
      }
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
