/**
 * REST API 调用（agent 相关端点）
 */
import type { NodeContent, ModelListItem, GetTreeResponse } from '@qcqx/lattice-agent-protocol';
import { get, del } from '../../api/request';
import { ApiError } from '../../../shared/api';
import { agentStore, ensureUi, putTurn, type ClientSourceInfo } from './store';
import type { ConversationEntry } from './types';
import { buildTurnsFromNodes, restoreStreamingTurns, fillInterruptedStreams } from './turnGraph';
import { isStreamingStatus } from './turnState';

// ── 对话树加载 ──

export async function loadTree(treeId: string): Promise<void> {
  try {
    const data = await get<GetTreeResponse>(`/api/agent/tree/${treeId}`);
    if (!data.nodes.length) return;
    // 竞态防护：异步返回时若已切换到别的树，丢弃本次结果，避免旧树数据覆盖当前树
    if (agentStore.treeId !== treeId) return;

    const nodes = data.nodes;

    // 捕获在途流式 turn 的实时内容（避免全量重建冲掉未落盘的累积）
    const liveStreaming = new Map<string, NodeContent[]>();
    for (const [id, t] of agentStore.turns) {
      // 只要处于流式态就捕获（包括尚未收到首 token、blocks 为空的）
      if (isStreamingStatus(t.status)) liveStreaming.set(id, t.blocks);
    }

    // 纯函数重建 + 流式恢复 + 中断填充（数据逻辑见 turnGraph.ts，可独立测试）
    const turns = buildTurnsFromNodes(nodes);
    restoreStreamingTurns(turns, liveStreaming);
    if (data.interruptedStreams.length) {
      fillInterruptedStreams(turns, data.interruptedStreams);
    }
    // 能力数据驱动：REST 与 WS 快照同源，reload 后立即可用（不本地重算）；
    // 旧版 server 无此字段时降级为空——渲染侧 turnCaps 缺失时回退本地推导（向后兼容）
    agentStore.turnCaps.clear();
    for (const [turnId, caps] of Object.entries(data.turnCapabilities ?? {})) {
      agentStore.turnCaps.set(turnId, caps);
    }

    // 写入 store（putTurn 包 proxy：流式 delta 靠 turn 级响应式驱动节点重渲染）
    agentStore.turns.clear();
    for (const [id, turn] of turns) {
      putTurn(turn);
      ensureUi(id);
    }
    agentStore.version++;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_found') return;
    /* ignore other errors too */
  }
}

// ── 源/模型 ──

export async function loadSources(): Promise<void> {
  try {
    const data = await get<{ sources: ClientSourceInfo[] }>('/api/agent/sources');
    agentStore.sources = data.sources ?? [];
  } catch {
    /* ignore */
  }
}

/** 纯获取某源模型列表（不写 store，供配置页等独立消费） */
export async function fetchModels(sourceId?: string): Promise<ModelListItem[]> {
  try {
    const qs = sourceId ? `?sourceId=${sourceId}` : '';
    const data = await get<{ models: ModelListItem[] }>(`/api/agent/models${qs}`);
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
    const data = await get<Record<string, unknown>>('/api/config?scope=local');
    return (data?.agent as AgentClientConfig) ?? {};
  } catch {
    return {};
  }
}

// ── 历史会话 ──

export async function loadConversations(): Promise<void> {
  try {
    const data = await get<{ conversations: ConversationEntry[] }>('/api/agent/conversations');
    agentStore.conversations = data.conversations ?? [];
  } catch {
    /* ignore */
  }
}

export async function deleteConversationApi(treeId: string): Promise<void> {
  await del(`/api/agent/conversations/${treeId}`);
}
