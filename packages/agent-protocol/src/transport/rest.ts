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
  available: boolean;
  modelCount: number;
}

export interface GetSourcesResponse {
  sources: SourceListItem[];
}

// ── GET /api/agent/models ──

export interface ModelListItem {
  id: string;
  displayName: string;
  sourceId: string;
  contextWindow: number;
  maxOutputTokens: number;
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
