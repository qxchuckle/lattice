/**
 * agentStore — 对话树状态管理（树形节点 + 内嵌输入框交互）
 * 核心模型：每个节点 = 用户问题 + AI回答 + 输入框
 * 任意节点输入回车 → 派生子节点 → AI 在新节点中回答
 */
import { proxy } from 'valtio';
import { authStore } from '../../store';

// ── 数据模型 ──

/** 每个节点独立的运行配置 */
export interface NodeConfig {
  /** 使用的模型 */
  model: string;
  /** 上下文窗口大小 */
  contextSize: string;
  /** 启用的工具集 */
  tools: string;
}

/** 可选上下文窗口 */
export const CONTEXT_SIZES = [
  { id: 'default', label: '默认' },
  { id: '8k', label: '8K' },
  { id: '32k', label: '32K' },
  { id: '128k', label: '128K' },
  { id: '200k', label: '200K' },
] as const;

/** 可选工具集 */
export const TOOL_PRESETS = [
  { id: 'all', label: '全部工具' },
  { id: 'code', label: '代码编辑' },
  { id: 'read', label: '只读' },
  { id: 'none', label: '无工具' },
] as const;

/** 默认节点配置 */
export function defaultNodeConfig(): NodeConfig {
  return { model: 'qoder-default', contextSize: 'default', tools: 'all' };
}

/** 节点默认尺寸 */
export const DEFAULT_NODE_WIDTH = 300;
export const DEFAULT_NODE_HEIGHT = 200;
/** 节点最小尺寸 */
export const MIN_NODE_WIDTH = 220;
export const MIN_NODE_HEIGHT = 120;

export interface TreeNode {
  id: string;
  parentId: string | null;
  /** 用户问题（输入框回车后填入） */
  userMessage: string;
  /** AI 回答（流式累积） */
  assistantText: string;
  /** 节点状态 */
  status: 'empty' | 'streaming' | 'done' | 'error';
  timestamp: number;
  /** 子节点 IDs */
  childIds: string[];
  // ── 节点级配置 ──
  /** 本节点运行配置（模型/上下文/工具） */
  config: NodeConfig;
  // ── 节点尺寸 ──
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  // ── Token 统计 ──
  /** 输入 token（用户消息估算） */
  inputTokens: number;
  /** 输出 token（AI 回答估算） */
  outputTokens: number;
  /** 输出速度 tokens/s */
  tokensPerSecond: number;
  /** 流式开始时间 */
  streamStartTime: number | null;
  /** 流式结束时间 */
  streamEndTime: number | null;
}

// ── 模型列表（参考主流 Agent 工具） ──

export const AVAILABLE_MODELS = [
  { id: 'qoder-default', label: 'Qoder Default', provider: 'qoder' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', provider: 'anthropic' },
  { id: 'claude-opus-4', label: 'Claude Opus 4', provider: 'anthropic' },
  { id: 'gpt-5', label: 'GPT-5', provider: 'openai' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
] as const;

/** 估算 token 数（混合中英文启发式：~3 字符/token） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

/** 格式化 token 数显示（1234 → 1.2k） */
export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Store ──

export const agentStore = proxy({
  /** 所有节点 */
  nodes: new Map<string, TreeNode>(),
  /** 根节点 ID */
  rootId: null as string | null,
  /** 当前正在流式响应的节点 ID */
  streamingNodeId: null as string | null,
  /** WebSocket 连接状态 */
  wsConnected: false,
  /** 会话 ID */
  sessionId: null as string | null,
  treeId: null as string | null,
  /** 画布是否可见 */
  visible: false,
  /** 版本号：每次节点变更 +1，强制画布重新布局 */
  version: 0,
  // ── 会话级统计 ──
  /** 累计输入 token */
  totalInputTokens: 0,
  /** 累计输出 token */
  totalOutputTokens: 0,
  /** 当前选择的模型 */
  currentModel: 'qoder-default' as string,
});

// ── 持久化（JSONL 文件目录，存 lattice 缓存层） ──

/** 持久化单个节点（append-only，按 id 去重） */
function persistNode(node: TreeNode) {
  const treeId = agentStore.treeId;
  if (!treeId) return; // treeId 未就绪时跳过，后续 finalize 会补
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
  fetch('/api/agent/turns', {
    method: 'POST',
    headers,
    body: JSON.stringify({ treeId, node }),
  }).catch(() => {
    /* 忽略持久化失败（缓存层，非关键路径） */
  });
}

// ── 节点操作 ──

export function createRootNode(): string {
  const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const node: TreeNode = {
    id,
    parentId: null,
    userMessage: '',
    assistantText: '',
    status: 'empty',
    timestamp: Date.now(),
    childIds: [],
    config: defaultNodeConfig(),
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
    inputTokens: 0,
    outputTokens: 0,
    tokensPerSecond: 0,
    streamStartTime: null,
    streamEndTime: null,
  };
  agentStore.nodes.set(id, node);
  agentStore.rootId = id;
  agentStore.version++;
  return id;
}

export function createChildNode(parentId: string, userMessage: string): string {
  const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const inputTokens = estimateTokens(userMessage);
  // 继承父节点配置（用户可在节点上独立修改）
  const parent = agentStore.nodes.get(parentId);
  const config: NodeConfig = parent ? { ...parent.config } : defaultNodeConfig();
  const node: TreeNode = {
    id,
    parentId,
    userMessage,
    assistantText: '',
    status: 'streaming',
    timestamp: Date.now(),
    childIds: [],
    config,
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
    inputTokens,
    outputTokens: 0,
    tokensPerSecond: 0,
    streamStartTime: Date.now(),
    streamEndTime: null,
  };
  agentStore.nodes.set(id, node);

  // 更新父节点的 childIds
  if (parent) {
    parent.childIds.push(id);
  }

  agentStore.streamingNodeId = id;
  agentStore.totalInputTokens += inputTokens;
  agentStore.version++;

  // 持久化子节点 + 父节点（childIds 已更新）
  persistNode(node);
  if (parent) persistNode(parent);

  return id;
}

export function appendStreamText(nodeId: string, text: string) {
  const node = agentStore.nodes.get(nodeId);
  if (node) {
    node.assistantText += text;
    node.outputTokens = estimateTokens(node.assistantText);
    // 实时计算输出速度
    if (node.streamStartTime) {
      const elapsed = (Date.now() - node.streamStartTime) / 1000;
      if (elapsed > 0.1) {
        node.tokensPerSecond = Math.round(node.outputTokens / elapsed);
      }
    }
    agentStore.version++;
  }
}

export function finalizeNode(nodeId: string, status: 'done' | 'error' = 'done') {
  const node = agentStore.nodes.get(nodeId);
  if (node) {
    node.status = status;
    node.streamEndTime = Date.now();
    node.outputTokens = estimateTokens(node.assistantText);
    // 最终速度
    if (node.streamStartTime && node.streamEndTime) {
      const elapsed = (node.streamEndTime - node.streamStartTime) / 1000;
      if (elapsed > 0.1) {
        node.tokensPerSecond = Math.round(node.outputTokens / elapsed);
      }
    }
    agentStore.totalOutputTokens += node.outputTokens;
    // 持久化完整节点（含回答 + 统计）
    persistNode(node);
  }
  if (agentStore.streamingNodeId === nodeId) {
    agentStore.streamingNodeId = null;
  }
  agentStore.version++;
}

/** 切换模型 */
export function setModel(modelId: string) {
  agentStore.currentModel = modelId;
}

/** 更新某个节点的配置 */
export function setNodeConfig(nodeId: string, patch: Partial<NodeConfig>) {
  const node = agentStore.nodes.get(nodeId);
  if (node) {
    Object.assign(node.config, patch);
    agentStore.version++;
  }
}

/** 实时缩放：拖拽过程中仅同步尺寸到 store（不 bump version、不移动其他节点，避免连线错位；松手时由 setNodeSize 触发整体重布局） */
export function liveResizeNode(nodeId: string, width: number, height: number) {
  const node = agentStore.nodes.get(nodeId);
  if (node) {
    node.width = Math.round(Math.max(MIN_NODE_WIDTH, width));
    node.height = Math.round(Math.max(MIN_NODE_HEIGHT, height));
  }
}

/** 缩放结束：保存最终尺寸并触发整体重布局（version++ → dagre 重布局 → 碰撞挤开 / 收缩间距） */
export function setNodeSize(nodeId: string, width: number, height: number) {
  const node = agentStore.nodes.get(nodeId);
  if (node) {
    node.width = Math.round(Math.max(MIN_NODE_WIDTH, width));
    node.height = Math.round(Math.max(MIN_NODE_HEIGHT, height));
  }
  agentStore.version++;
}

// ── WebSocket ──

let ws: WebSocket | null = null;

export function connectAgentWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = authStore.token ? `?token=${authStore.token}` : '';
  ws = new WebSocket(`${protocol}//${window.location.host}/api/agent/ws${token}`);

  ws.onopen = () => {
    agentStore.wsConnected = true;
    if (!agentStore.sessionId) {
      // 传 treeId 以复用已有对话树（恢复会话），否则后端创建新树
      ws?.send(
        JSON.stringify({ type: 'session.create', agentId: 'qoder', treeId: agentStore.treeId }),
      );
    }
  };

  ws.onclose = () => {
    agentStore.wsConnected = false;
    setTimeout(() => connectAgentWs(), 3000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch {
      /* ignore */
    }
  };
}

function handleWsMessage(msg: Record<string, unknown>) {
  switch (msg.type) {
    case 'session.created':
      agentStore.sessionId = msg.sessionId as string;
      agentStore.treeId = msg.treeId as string;
      break;

    case 'event': {
      const evt = msg.event as { type: string; content?: string; message?: string };
      const nodeId = agentStore.streamingNodeId;
      if (!nodeId) return;

      if (evt.type === 'text' && evt.content) {
        appendStreamText(nodeId, evt.content);
      } else if (evt.type === 'done') {
        finalizeNode(nodeId, 'done');
      } else if (evt.type === 'error') {
        appendStreamText(nodeId, `\n[Error: ${evt.message ?? 'unknown'}]`);
        finalizeNode(nodeId, 'error');
      }
      break;
    }

    case 'session.error': {
      const nodeId = agentStore.streamingNodeId;
      if (nodeId) finalizeNode(nodeId, 'error');
      break;
    }
  }
}

// ── 核心交互：节点输入框回车 ──

export function submitFromNode(parentNodeId: string, message: string) {
  if (!message.trim()) return;

  // 确保 WS 连接
  if (!ws || !agentStore.sessionId) {
    connectAgentWs();
    // 延迟发送（等连接建立）
    setTimeout(() => submitFromNode(parentNodeId, message), 500);
    return;
  }

  // 创建子节点（继承父节点配置）
  const childId = createChildNode(parentNodeId, message.trim());
  const childNode = agentStore.nodes.get(childId);

  // 发送到后端（附带节点级配置）
  ws.send(
    JSON.stringify({
      type: 'session.send',
      sessionId: agentStore.sessionId,
      treeId: agentStore.treeId,
      message: message.trim(),
      config: childNode?.config,
    }),
  );

  return childId;
}

// ── 初始化 ──

/** 从后端恢复最新对话（缓存层 JSONL） */
async function resumeFromBackend(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
    const res = await fetch('/api/agent/turns/latest', { headers });
    if (!res.ok) return false;
    const data = (await res.json()) as { treeId: string | null; turns: TreeNode[] };
    if (!data.treeId || !data.turns || data.turns.length === 0) return false;

    // 加载节点（已按 id 去重），重建索引
    agentStore.nodes.clear();
    let rootId: string | null = null;
    let totalIn = 0;
    let totalOut = 0;
    for (const node of data.turns) {
      // 恢复时把未完成的流式节点标记为 done
      if (node.status === 'streaming') node.status = 'done';
      // 兼容旧数据：缺少 config 字段时补默认值
      if (!node.config) node.config = defaultNodeConfig();
      // 兼容旧数据：缺少尺寸时补默认值
      if (!node.width) node.width = DEFAULT_NODE_WIDTH;
      if (!node.height) node.height = DEFAULT_NODE_HEIGHT;
      agentStore.nodes.set(node.id, node);
      if (node.parentId === null) rootId = node.id;
      totalIn += node.inputTokens ?? 0;
      totalOut += node.outputTokens ?? 0;
    }

    if (!rootId) return false;

    agentStore.rootId = rootId;
    agentStore.treeId = data.treeId;
    agentStore.totalInputTokens = totalIn;
    agentStore.totalOutputTokens = totalOut;
    agentStore.version++;
    return true;
  } catch {
    return false;
  }
}

let initializing = false;

export async function initAgentTree() {
  if (agentStore.rootId || initializing) return; // 已初始化或正在初始化
  initializing = true;

  try {
    // 优先从后端恢复最新对话，失败则新建
    const resumed = await resumeFromBackend();
    if (!resumed) {
      createRootNode();
    }
    connectAgentWs();
  } finally {
    initializing = false;
  }
}
