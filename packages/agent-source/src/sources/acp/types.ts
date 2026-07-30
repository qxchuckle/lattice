/**
 * ACP 协议类型（v1 stable）— 仅限 agent-source 内部使用
 *
 * 设计约束：ACP 类型不进 protocol 包（内部契约是 SourceEvent/ISource，ACP 只是一种传输）。
 * 本文件只声明 AcpDriver 实际消费的最小形状，非完整 ACP schema。
 */

// ── JSON-RPC 基础 ──

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/** agent → client 反向请求（带 id，需应答） */
export interface JsonRpcServerRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

// ── initialize ──

export interface AcpInitializeParams {
  protocolVersion: number;
  clientCapabilities: {
    fs: { readTextFile: boolean; writeTextFile: boolean };
    terminal: boolean;
  };
  clientInfo: { name: string; version: string };
}

export interface AcpInitializeResult {
  protocolVersion?: number;
  agentInfo?: { name?: string; version?: string };
  capabilities?: Record<string, unknown>;
  /** 模型/思考深度等配置选项（数据驱动：driver 从此提取 listModels） */
  configOptions?: AcpConfigOption[];
}

export interface AcpConfigOption {
  category: 'model' | 'model_config' | 'thought_level' | string;
  options?: Array<{ id: string; name?: string }>;
}

// ── session 操作 ──

export interface AcpSessionNewParams {
  cwd?: string;
  mcpServers?: unknown[];
}

export interface AcpSessionNewResult {
  sessionId: string;
}

export interface AcpPromptParams {
  sessionId: string;
  prompt: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  /** 模型/思考深度配置（泛化 SessionConfigOption） */
  config?: Array<{ category: string; value: string }>;
}

export interface AcpPromptResult {
  /** 正常结束时 agent 返回的元数据（usage 等） */
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AcpForkParams {
  sessionId: string;
  cwd?: string;
  mcpServers?: unknown[];
}

export interface AcpForkResult {
  sessionId: string;
}

// ── session/update 流式事件 ──

export interface AcpSessionUpdate {
  sessionId?: string;
  update: {
    sessionUpdate: string; // 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error' | 'done' | ...
    [key: string]: unknown;
  };
}

// ── 反向权限 ──

export interface AcpPermissionRequest {
  sessionId?: string;
  tool?: string;
  description?: string;
  options?: Array<{ id: string; title?: string }>;
}

export interface AcpPermissionResponse {
  outcome: { outcome: 'selected'; optionId: string };
}
