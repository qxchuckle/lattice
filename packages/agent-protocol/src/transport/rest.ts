/**
 * REST API 请求/响应 schema 类型（Agent 相关端点）
 */
import type { ConversationTree, ConversationNode } from '../source/conversation.js';

// ── GET /api/agent/tree/:treeId ──

export interface GetTreeResponse {
  tree: ConversationTree;
  nodes: ConversationNode[];
  error?: undefined;
}

export interface GetTreeNotFoundResponse {
  error: 'not_found';
}

// ── GET /api/agent/turns/latest ──

export interface GetLatestTurnsResponse {
  treeId: string | null;
  turns: unknown[];
}

// ── POST /api/agent/turns ──

export interface PostTurnRequest {
  treeId: string;
  node: { id: string; [key: string]: unknown };
}

export interface PostTurnResponse {
  ok: true;
}

// ── GET /api/agent/sources（未来：源配置页） ──

export interface SourceListItem {
  id: string;
  displayName: string;
  version: string;
  /** catalog=只能从列表选 / open=任意字符串 / hybrid=推荐+自定义 */
  modelPolicy: 'catalog' | 'open' | 'hybrid';
  available: boolean;
  modelCount: number;
}

export interface GetSourcesResponse {
  sources: SourceListItem[];
}

// ── GET /api/agent/models ──

import type { ModelTuning } from '../source/models.js';

export interface ModelListItem {
  id: string;
  displayName: string;
  sourceId: string;
  contextWindow: number;
  maxOutputTokens: number;
  /** 费率（costFactor 数值供排序/计算；costLabel 源生成展示文本，web 直接渲染） */
  costFactor?: number;
  costLabel?: string;
  /** 用户自定义模型（配置页添加，仅 hybrid/open 源） */
  custom?: boolean;
  /** 可调参数规格（数据控制渲染：有规格才渲染编辑入口） */
  tuning?: ModelTuning;
}

export interface GetModelsResponse {
  models: ModelListItem[];
}

// ── GET /api/agent/auth-status ──

export interface AuthStatusItem {
  sourceId: string;
  status: 'configured' | 'missing' | 'error';
  message?: string;
}

export interface GetAuthStatusResponse {
  auth: AuthStatusItem[];
}
