/**
 * Agent 状态（valtio proxy）+ 纯查询函数
 */
import { proxy } from 'valtio';
import type { SourceListItem, ModelListItem, PresenceState } from '@qcqx/lattice-agent-protocol';
import type { TurnNode, NodeUiState, ConversationEntry } from './types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from './types';

export const agentStore = proxy({
  turns: new Map<string, TurnNode>(),
  ui: new Map<string, NodeUiState>(),
  sessionId: null as string | null,
  treeId: null as string | null,
  connected: false,
  sources: [] as SourceListItem[],
  models: [] as ModelListItem[],
  activeSourceId: 'qoder' as string,
  activeModelId: '' as string,
  /** 当前模型的参数选择（'' / 0 = 源默认；切换模型时重置） */
  activeThinkingLevel: '' as string,
  activeContextWindow: 0 as number,
  /** 正在编辑参数的模型 ID（驱动 ModelTuningModal） */
  tuningModelId: '' as string,
  /** 参数编辑的目标节点（'' = 虚拟根/新线程全局参数；非空 = 节点作用域，追问用该节点参数） */
  tuningTargetTurnId: '' as string,
  /** 设置弹窗打开时聚焦的源（源下拉齿轮入口） */
  settingsFocusSourceId: '' as string,
  visible: false,
  version: 0,
  conversations: [] as ConversationEntry[],
  historyOpen: false,
  settingsOpen: false,
  /** 同树其他在场端（多端同步 presence） */
  peers: [] as PresenceState[],
});

// ── 内部辅助 ──

/**
 * turn 以独立 proxy 入 Map。
 * valtio 的 proxy() 不代理 Map/Set，turns Map 内的对象默认脱离响应式追踪；
 * 逐 turn 包 proxy 后，流式 delta（applyStreamEvent 原地改 blocks）经 turn 级
 * useSnapshot 只重渲染对应节点，画布结构仍由 version 驱动。
 * 所有 turn 入 Map 必须走此函数，禁止直接 turns.set。
 */
export function putTurn(turn: TurnNode): TurnNode {
  const p = proxy(turn);
  agentStore.turns.set(p.id, p);
  return p;
}

/** 稳定空 turn 兜底（useSnapshot 不可条件调用，目标节点缺失时占位） */
export const MISSING_TURN = proxy<TurnNode>({
  id: '',
  parentTurnId: null,
  userMessage: '',
  blocks: [],
  status: 'hidden',
  timestamp: 0,
  sourceId: '',
  modelId: '',
});

/**
 * ui 以独立 proxy 入 Map（同 putTurn 思路）：节点组件对单 ui 做 useSnapshot，
 * 缩放/折叠只重渲染对应节点，不再经 version 广播到全部节点。
 */
export function ensureUi(nodeId: string): NodeUiState {
  let ui = agentStore.ui.get(nodeId);
  if (!ui) {
    ui = proxy<NodeUiState>({ width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
    agentStore.ui.set(nodeId, ui);
  }
  return ui;
}

// ── 查询函数 ──

// 子/兄弟查询供节点 UI 计数与布局使用：排除 hidden（已删除不渲染），
// 否则分支/兄弟计数会把看不见的节点算进去（与画布 getVisibleTurns 口径一致）

export function getChildIds(nodeId: string): string[] {
  const children: string[] = [];
  for (const [id, turn] of agentStore.turns) {
    if (turn.parentTurnId === nodeId && turn.status !== 'hidden') children.push(id);
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
    if (turn.parentTurnId === node.parentTurnId && turn.status !== 'hidden') siblings.push(id);
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

// ── 节点 data 引用缓存（供 React Flow memo 生效） ──

/** 稳定 node.data 引用（按 turnId）：tree 重建时 data 引用不变，内容未变节点不重渲染 */
const nodeDataCache = new Map<string, { turnId: string }>();
export function stableNodeData(turnId: string): { turnId: string } {
  let d = nodeDataCache.get(turnId);
  if (!d) {
    d = { turnId };
    nodeDataCache.set(turnId, d);
  }
  return d;
}
/** 切换/删除树时清缓存（防跨树无界增长） */
export function clearNodeDataCache(): void {
  nodeDataCache.clear();
}
