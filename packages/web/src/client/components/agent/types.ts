/**
 * Agent 模块类型定义 + 常量
 */
import type { TokenUsage } from '@qcqx/lattice-agent-protocol';

// ── 流式渲染块 ──

export type StreamingBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tool_call';
      id: string;
      name: string;
      args: Record<string, unknown>;
      status: 'running' | 'done' | 'error';
    }
  | { kind: 'tool_result'; id: string; name: string; result: unknown; isError?: boolean }
  | { kind: 'file_edit'; path: string; diff: string }
  | { kind: 'terminal'; command: string; output?: string }
  | { kind: 'error'; message: string; suggestion?: string };

// ── 画布节点模型（一轮对话 = 一个节点） ──

export interface TurnNode {
  id: string;
  parentTurnId: string | null;
  userMessage: string;
  blocks: StreamingBlock[];
  status: 'empty' | 'streaming' | 'done' | 'error' | 'interrupted' | 'undone' | 'hidden';
  timestamp: number;
  sourceId: string;
  modelId: string;
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
