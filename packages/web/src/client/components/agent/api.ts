/**
 * REST API 调用（agent 相关端点）
 */
import type { ConversationNode, NodeContent } from '@qcqx/lattice-agent-protocol';
import { authStore } from '../../store';
import { agentStore, ensureUi } from './store';
import type { TurnNode, StreamingBlock } from './types';

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
    agentStore.turns.clear();

    const userNodes = nodes.filter((n) => n.role === 'user');

    if (userNodes.length > 0) {
      // 新格式：user + assistant 配对
      for (const un of userNodes) {
        const assistant = nodes.find((n) => n.role === 'assistant' && n.parentId === un.id);
        const userText = un.content?.find((c) => c.type === 'text')?.text ?? '';

        let parentTurnId: string | null = null;
        if (un.parentId) {
          const parentAssistant = nodes.find((n) => n.id === un.parentId && n.role === 'assistant');
          parentTurnId = parentAssistant?.parentId ?? un.parentId;
        }

        const turn: TurnNode = {
          id: un.id,
          parentTurnId,
          userMessage: userText,
          blocks: assistant ? buildBlocksFromNode(assistant) : [],
          status: assistant?.metadata?.interrupted
            ? 'interrupted'
            : assistant?.content?.some((c) => c.type === 'error')
              ? 'error'
              : 'done',
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
          blocks: buildBlocksFromNode(an),
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

    // 处理中断的 streaming（上次未完成的回复）
    const interruptedStreams = data.interruptedStreams as
      | { requestId: string; parentId: string; content: NodeContent[] }[]
      | undefined;
    if (interruptedStreams?.length) {
      for (const stream of interruptedStreams) {
        const turn = agentStore.turns.get(stream.parentId);
        if (turn && turn.blocks.length === 0) {
          // 该 user 节点没有 assistant 回复 → 用部分回复填充
          turn.blocks = buildBlocksFromContent(stream.content);
          turn.status = 'interrupted';
        }
      }
    }

    agentStore.version++;
  } catch {
    /* ignore */
  }
}

function buildBlocksFromNode(node: ConversationNode): StreamingBlock[] {
  return buildBlocksFromContent(node.content ?? []);
}

function buildBlocksFromContent(content: NodeContent[]): StreamingBlock[] {
  const blocks: StreamingBlock[] = [];
  for (const c of content) {
    switch (c.type) {
      case 'text':
        blocks.push({ kind: 'text', text: c.text });
        break;
      case 'thinking':
        blocks.push({ kind: 'thinking', text: c.text });
        break;
      case 'diff':
        blocks.push({ kind: 'file_edit', path: c.path, diff: c.text });
        break;
      case 'tool_call':
        blocks.push({
          kind: 'tool_call',
          id: c.toolId,
          name: c.name,
          args: c.args,
          status: (c.status as 'done' | 'error') ?? 'done',
        });
        break;
      case 'tool_result':
        blocks.push({
          kind: 'tool_result',
          id: c.toolId,
          name: c.name,
          result: c.result,
          isError: c.isError,
        });
        break;
      case 'terminal':
        blocks.push({ kind: 'terminal', command: c.command, output: c.output });
        break;
      case 'error':
        blocks.push({ kind: 'error', message: c.message, suggestion: c.suggestion });
        break;
    }
  }
  return blocks;
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
