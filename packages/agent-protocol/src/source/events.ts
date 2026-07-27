/**
 * 标准化事件（源 → 上层的唯一输出格式）
 * 全 Agent 体系统一使用此类型，不再有其他事件定义
 */

export type SourceErrorCode =
  // 认证
  | 'auth_missing'
  | 'auth_invalid'
  | 'auth_insufficient'
  // 模型
  | 'model_not_found'
  | 'model_unavailable'
  | 'context_overflow'
  // 网络/运行时
  | 'network'
  | 'rate_limited'
  | 'timeout'
  | 'aborted'
  // 源
  | 'source_not_initialized'
  | 'session_not_found'
  | 'session_expired'
  // 其他
  | 'unknown';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  total?: number;
  costUsd?: number;
}

export type SourceEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: unknown; isError?: boolean }
  | { type: 'file_edit'; path: string; diff: string }
  | { type: 'terminal'; command: string; output?: string }
  | {
      type: 'done';
      sessionId?: string;
      summary?: string;
      usage?: TokenUsage;
      sourceMessageId?: string;
    }
  | {
      type: 'error';
      message: string;
      code: SourceErrorCode;
      retryable: boolean;
      source: { id: string; name: string };
      suggestion?: string;
    };

/** 错误上下文（附在 SourceError 类上，源实现层使用） */
export interface SourceErrorContext {
  sourceId: string;
  sourceName: string;
  operation:
    | 'init'
    | 'prompt'
    | 'abort'
    | 'destroySession'
    | 'forkSession'
    | 'renameSession'
    | 'listModels'
    | 'checkAuth';
  config?: {
    model?: string;
    cwd?: string;
    thinkingLevel?: string;
  };
  cause?: Error;
  suggestion?: string;
}
