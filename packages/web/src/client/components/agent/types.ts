/**
 * Agent 模块类型定义 + 常量
 */
import type { TokenUsage, NodeContent, ViewStatus } from '@qcqx/lattice-agent-protocol';

// ── 画布节点模型（一轮对话 = 一个节点） ──
// blocks 直接用协议 NodeContent（与 server 持久化/流式转换同一类型，无平行块模型）
// status 直接用协议 ViewStatus（视图状态类型单一真相，见 node-state.ts）

export interface TurnNode {
  id: string;
  parentTurnId: string | null;
  userMessage: string;
  blocks: NodeContent[];
  status: ViewStatus;
  timestamp: number;
  sourceId: string;
  modelId: string;
  /** 本轮参数（'' = 源默认；'none' = 关闭思考；0 = 默认档位） */
  thinkingLevel?: string;
  contextWindow?: number;
  usage?: TokenUsage;
}

// ── UI 状态（纯前端） ──

export interface NodeUiState {
  width: number;
  height: number;
  collapsed?: boolean;
}

// ── 历史会话条目 ──

export interface ConversationEntry {
  treeId: string;
  title?: string;
  nodeCount: number;
  updatedAt: number;
}

// ── 常量 ──

export const DEFAULT_NODE_WIDTH = 340;
export const DEFAULT_NODE_HEIGHT = 260;
export const MIN_NODE_WIDTH = 240;
export const MIN_NODE_HEIGHT = 140;
export const ROOT_INPUT_ID = '__root_input__';
