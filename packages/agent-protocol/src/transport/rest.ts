/**
 * REST API 请求/响应 schema 类型（Agent 相关端点）
 */
import type { ConversationTree, ConversationNode, StreamingState } from '../source/conversation.js';
import type { SourceResourceInfo } from '../source/resources.js';
import type { NodeCapabilities } from '../source/node-state.js';
import type { CapabilityDowngrade } from '../source/manifest.js';
import type { SourceCapabilities } from '../source/capabilities.js';

// ── GET /api/agent/tree/:treeId ──

export interface GetTreeResponse {
  tree: ConversationTree;
  nodes: ConversationNode[];
  /** 未正常结束的在途流（崩溃恢复：client 据此把 turn 填为 interrupted） */
  interruptedStreams: StreamingState[];
  /**
   * turn 能力投影（turnId → 可执行操作）：与 WS 快照同源同形。
   * reload 走 REST 时也必须带上，否则快照到达前 client 只能本地投影（缺源能力维度）。
   */
  turnCapabilities: Record<string, NodeCapabilities>;
  error?: undefined;
}

export interface GetTreeNotFoundResponse {
  error: 'not_found';
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
  /** 不可用时的机器可读原因（数据驱动：UI 直接展示，不硬编码判断） */
  unavailableReason?: { code: string; message: string };
  /** 降准留痕：声明与实际不符的能力路径（审计透明） */
  downgrades?: CapabilityDowngrade[];
  /** 握手后的实际能力（数据驱动：UI 按此渲染能力标签，不硬编码源名） */
  capabilities?: SourceCapabilities;
}

export interface GetSourcesResponse {
  sources: SourceListItem[];
}

// ── GET /api/agent/models ──

import type { ModelTuning, ModelCapabilities } from '../source/models.js';

export interface ModelListItem {
  id: string;
  displayName: string;
  sourceId: string;
  contextWindow: number;
  maxOutputTokens: number;
  /** 能力声明（源提供）：vision 门控图片输入入口 */
  capabilities?: ModelCapabilities;
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

// ── GET /api/agent/resources?sourceId=&cwd=&kinds= ──

/** 聚合资源项：源级发现 + 编排层本地注册，壳层拿统一列表渲染菜单 */
export interface ResourceListItem extends SourceResourceInfo {
  /** local=编排层注册（lattice 模板等） / source=源级发现 */
  origin: 'local' | 'source';
  /** origin='source' 时的源 ID */
  sourceId?: string;
}

export interface GetResourcesResponse {
  resources: ResourceListItem[];
}
