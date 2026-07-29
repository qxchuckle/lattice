/**
 * 错误类（运行时代码，保留在 agent-source 实现包）
 * ErrorCode / SourceErrorContext 类型从 protocol 导入
 */
import type { SourceErrorCode, SourceErrorContext } from '@qcqx/lattice-agent-protocol';

export type { SourceErrorCode, SourceErrorContext };

/** 错误构造器里只需身份两字段（对齐 protocol SourceInfo 子集） */
interface SourceIdentity {
  id: string;
  displayName: string;
}

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

  /** 能力缺口（该源版本永久性）——纵深防御：正确用法是查声明而非 catch */
  static unsupportedOperation(
    operation: SourceErrorContext['operation'],
    capabilityPath: string,
    source: SourceIdentity,
  ): SourceError {
    return new SourceError('unsupported_operation', `${source.displayName} 不支持 ${operation}`, {
      sourceId: source.id,
      sourceName: source.displayName,
      operation,
      suggestion: `查声明 capabilities.${capabilityPath}（调用前应据此门控）`,
    });
  }

  /** 操作支持但选项不支持（如 fork 无 atMessage） */
  static unsupportedOption(
    operation: SourceErrorContext['operation'],
    option: string,
    capabilityPath: string,
    source: SourceIdentity,
  ): SourceError {
    return new SourceError(
      'unsupported_option',
      `${source.displayName} 的 ${operation} 不支持选项 ${option}`,
      {
        sourceId: source.id,
        sourceName: source.displayName,
        operation,
        suggestion: `查声明 capabilities.${capabilityPath}（选项粒度能力）`,
      },
    );
  }

  /** 时序前置条件不满足（状态非能力，声明层表达不了；消费层可排队重试） */
  static invalidState(
    operation: SourceErrorContext['operation'],
    message: string,
    source: SourceIdentity,
    suggestion?: string,
  ): SourceError {
    return new SourceError('invalid_state', message, {
      sourceId: source.id,
      sourceName: source.displayName,
      operation,
      suggestion,
    });
  }
}
