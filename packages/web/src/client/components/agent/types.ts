/**
 * Agent 模块类型定义 + 常量
 *
 * 布局常量（DEFAULT_NODE_WIDTH 等）从 constants/layout.ts 集中管理，
 * 此处 re-export 保持向后兼容（外部消费方从 './types' 或 './agentStore' 导入均可）。
 */
import type {
  TokenUsage,
  NodeContent,
  ViewStatus,
  NodeCapabilities,
} from '@qcqx/lattice-agent-protocol';
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
} from '../../constants/layout';

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
  /** server 下发的能力投影（随快照写入 turn proxy，借 turn 级订阅触发重渲染——
   * valtio Map 对 existing key 的 set 不响应，单独存 turnCaps Map 更新不触发节点重渲染） */
  caps?: NodeCapabilities;
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

/** Agent 节点默认宽度（值来自 constants/layout.ts） */
export { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, MIN_NODE_WIDTH, MIN_NODE_HEIGHT };

/** 根输入节点 ID（纯 UI 标识，不属布局 token） */
export const ROOT_INPUT_ID = '__root_input__';
