/**
 * 错误类（运行时代码，保留在 agent-source 实现包）
 * ErrorCode / SourceErrorContext 类型从 protocol 导入
 */
import type { SourceErrorCode, SourceErrorContext } from '@qcqx/lattice-agent-protocol';

export type { SourceErrorCode, SourceErrorContext };

// ── 错误类（操作级 throw） ──

const RETRYABLE_CODES: Set<SourceErrorCode> = new Set(['network', 'rate_limited', 'timeout']);

export class SourceError extends Error {
  readonly code: SourceErrorCode;
  readonly retryable: boolean;
  readonly context: SourceErrorContext;

  constructor(code: SourceErrorCode, message: string, context: SourceErrorContext) {
    super(`[${context.sourceId}] ${message}`);
    this.name = 'SourceError';
    this.code = code;
    this.context = context;
    this.retryable = RETRYABLE_CODES.has(code);
  }

  /** 快捷创建 */
  static auth(
    message: string,
    context: Omit<SourceErrorContext, 'operation'> & {
      operation?: SourceErrorContext['operation'];
    },
  ): SourceError {
    return new SourceError('auth_missing', message, { operation: 'checkAuth', ...context });
  }

  static sessionNotFound(sessionId: string, sourceId: string, sourceName: string): SourceError {
    return new SourceError('session_not_found', `Session not found: ${sessionId}`, {
      sourceId,
      sourceName,
      operation: 'prompt',
      suggestion: '会话可能已过期，请重新创建',
    });
  }

  static notInitialized(sourceId: string, sourceName: string): SourceError {
    return new SourceError('source_not_initialized', `${sourceName} 尚未初始化`, {
      sourceId,
      sourceName,
      operation: 'init',
      suggestion: '请先调用 init() 或使用 createAgentSource() 工厂函数',
    });
  }
}
