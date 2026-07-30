/**
 * REST API 调用（agent 相关端点）
 */
import type {
  NodeContent,
  ModelListItem,
  GetTreeResponse,
  GetTreeNotFoundResponse,
} from '@qcqx/lattice-agent-protocol';
import { authStore } from '../../store';
import { agentStore, ensureUi, putTurn } from './store';
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
    // 契约类型直接用 protocol 的响应形状（不再局部 as 硬转；server 端同一类型钉住）
    const data = (await res.json()) as GetTreeResponse | GetTreeNotFoundResponse;
    if (data.error || !data.nodes.length) return;
    // 竞态防护：异步返回时若已切换到别的树，丢弃本次结果，避免旧树数据覆盖当前树
    if (agentStore.treeId !== treeId) return;

    const nodes = data.nodes;

    // 捕获在途流式 turn 的实时内容（避免全量重建冲掉未落盘的累积）
    const liveStreaming = new Map<string, NodeContent[]>();
    for (const [id, t] of agentStore.turns) {
      // 只要处于流式态就捕获（包括尚未收到首 token、blocks 为空的）
      if (t.status === 'streaming') liveStreaming.set(id, t.blocks);
    }

    // 纯函数重建 + 流式恢复 + 中断填充（数据逻辑见 turnGraph.ts，可独立测试）
    const turns = buildTurnsFromNodes(nodes);
    restoreStreamingTurns(turns, liveStreaming);
    if (data.interruptedStreams.length) {
      fillInterruptedStreams(turns, data.interruptedStreams);
    }
    // 能力数据驱动：REST 与 WS 快照同源，reload 后立即可用（不本地重算）
    agentStore.turnCaps.clear();
    for (const [turnId, caps] of Object.entries(data.turnCapabilities)) {
      agentStore.turnCaps.set(turnId, caps);
    }

    // 写入 store（putTurn 包 proxy：流式 delta 靠 turn 级响应式驱动节点重渲染）
    agentStore.turns.clear();
    for (const [id, turn] of turns) {
      putTurn(turn);
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

/** 纯获取某源模型列表（不写 store，供配置页等独立消费） */
export async function fetchModels(sourceId?: string): Promise<ModelListItem[]> {
  try {
    const qs = sourceId ? `?sourceId=${sourceId}` : '';
    const res = await fetch(`/api/agent/models${qs}`, { headers: getHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.models ?? [];
  } catch {
    return [];
  }
}

export async function loadModels(sourceId?: string): Promise<void> {
  const models = await fetchModels(sourceId);
  agentStore.models = models;
  if (models.length > 0 && !agentStore.activeModelId) {
    agentStore.activeModelId = models[0].id;
  }
}

// ── 按源模型列表缓存（节点追问模型选择器用，避免每节点重复请求） ──

const modelListCache = new Map<string, ModelListItem[]>();

export async function fetchModelsCached(sourceId: string): Promise<ModelListItem[]> {
  const hit = modelListCache.get(sourceId);
  if (hit) return hit;
  const models = await fetchModels(sourceId);
  if (models.length > 0) modelListCache.set(sourceId, models);
  return models;
}

/** 自定义模型变更后失效缓存 */
export function clearModelListCache(): void {
  modelListCache.clear();
}

// ── Agent 配置（local config 的 agent 段） ──

export interface AgentClientConfig {
  defaultSource?: string;
  defaultModel?: string;
  customModels?: Record<string, string[]>;
}

export async function loadAgentConfig(): Promise<AgentClientConfig> {
  try {
    const res = await fetch('/api/config?scope=local', { headers: getHeaders() });
    if (!res.ok) return {};
    const data = await res.json();
    return (data?.agent as AgentClientConfig) ?? {};
  } catch {
    return {};
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
