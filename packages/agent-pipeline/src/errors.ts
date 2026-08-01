/**
 * PipelineError — 消费层类型化错误
 *
 * 三层能力机制的错误层在消费层的镜像：能力缺口本应由声明层门控（策略表 + 投影），
 * 走到这里意味着调用方绕过了门控（或 middleware 自身失败）——纵深防御，不静默。
 *
 * 复用 protocol 的错误 taxonomy（unsupported_operation / unsupported_option / invalid_state），
 * 另加消费层专属 `middleware_failure`（源无关，故不进 protocol）。
 */
import type { SourceErrorCode } from '@qcqx/lattice-agent-protocol';

export type PipelineErrorCode =
  | Extract<SourceErrorCode, 'unsupported_operation' | 'unsupported_option' | 'invalid_state'>
  | 'middleware_failure'
  | 'validation_error';

/** middleware 失败发生的拦截点：入向 prompt 变换 / 出向事件变换 */
export type PipelinePhase = 'prompt' | 'transform';

export interface PipelineErrorContext {
  /** 相关源 ID */
  sourceId?: string;
  /** 能力声明路径（如 'session.fork'）——调用方应据此门控 */
  capabilityPath?: string;
  /** 失败的 middleware 名（code=middleware_failure 时）。兼容保留，新代码读 middlewareName */
  middleware?: string;
  /** 触发错误的 middleware 名（与 middleware 同值，统一契约字段） */
  middlewareName?: string;
  /** 错误发生的拦截点：'prompt'（入向）/ 'transform'（出向） */
  phase?: PipelinePhase;
  /** 原始错误 */
  cause?: unknown;
}

export class PipelineError extends Error {
  readonly code: PipelineErrorCode;
  readonly context: PipelineErrorContext;

  constructor(code: PipelineErrorCode, message: string, context: PipelineErrorContext = {}) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
    this.context = context;
  }

  /** 能力缺口：调用方未按声明门控 */
  static unsupported(capabilityPath: string, message: string, sourceId?: string): PipelineError {
    return new PipelineError('unsupported_operation', message, { capabilityPath, sourceId });
  }

  /** 选项不被支持（操作本身支持） */
  static unsupportedOption(
    capabilityPath: string,
    message: string,
    sourceId?: string,
  ): PipelineError {
    return new PipelineError('unsupported_option', message, { capabilityPath, sourceId });
  }

  /** middleware 抛错的类型化包装（不静默吞）；phase 标识入向/出向拦截点 */
  static middlewareFailed(name: string, cause: unknown, phase: PipelinePhase): PipelineError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new PipelineError('middleware_failure', `middleware "${name}" 执行失败：${detail}`, {
      middleware: name,
      middlewareName: name,
      phase,
      cause,
    });
  }
}

/** 可重试的错误码集合（middleware 瞬时失败可重试；确定性错误重试无益） */
const RETRYABLE_CODES: ReadonlySet<PipelineErrorCode> = new Set(['middleware_failure']);

/** 判断 PipelineError.code 是否可重试（消费层据此决定重试或熔断） */
export function isRetryableCode(code: PipelineErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}
