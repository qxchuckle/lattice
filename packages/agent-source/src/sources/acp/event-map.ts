/**
 * ACP session/update → SourceEvent 单向映射
 *
 * 与 mapPiEvent / mapQoderMessage 同层：把外部协议事件翻译成内部 SourceEvent。
 * 设计铁律：SourceEvent 是内部单一真相，ACP 只是传输形态之一。
 */
import type { SourceEvent, SourceErrorCode } from '@qcqx/lattice-agent-protocol';
import type { AcpSessionUpdate } from './types.js';

/** ACP error code → SourceErrorCode（未知统一落 'unknown'） */
function toErrorCode(raw: unknown): SourceErrorCode {
  const KNOWN: Set<string> = new Set([
    'auth_missing',
    'auth_invalid',
    'auth_insufficient',
    'model_not_found',
    'model_unavailable',
    'context_overflow',
    'network',
    'rate_limited',
    'timeout',
    'aborted',
    'source_not_initialized',
    'session_not_found',
    'session_expired',
    'unsupported_operation',
    'unsupported_option',
    'invalid_state',
    'unknown',
  ]);
  return typeof raw === 'string' && KNOWN.has(raw) ? (raw as SourceErrorCode) : 'unknown';
}

/**
 * 将一条 ACP session/update 通知映射为零或多条 SourceEvent。
 * 返回 null = 该变体无需映射（静默跳过，不报错）。
 */
export function mapAcpUpdate(update: AcpSessionUpdate): SourceEvent | null {
  const u = update.update;
  const kind = u.sessionUpdate;

  switch (kind) {
    case 'text':
    case 'text_delta': {
      const content = (u.text ?? u.delta ?? '') as string;
      if (!content) return null;
      return { type: 'text', content };
    }

    case 'thinking':
    case 'thinking_delta': {
      const content = (u.text ?? u.delta ?? '') as string;
      if (!content) return null;
      return { type: 'thinking', content };
    }

    case 'tool_use':
    case 'tool_call': {
      return {
        type: 'tool_call',
        id: (u.toolCallId ?? u.id ?? '') as string,
        name: (u.name ?? u.toolName ?? 'unknown') as string,
        args: (u.input ?? u.args ?? {}) as Record<string, unknown>,
      };
    }

    case 'tool_result': {
      return {
        type: 'tool_result',
        id: (u.toolCallId ?? u.id ?? '') as string,
        name: (u.name ?? u.toolName ?? '') as string,
        result: u.content ?? u.output ?? '',
        isError: (u.isError ?? false) as boolean,
      };
    }

    case 'error': {
      return {
        type: 'error',
        message: (u.message ?? u.text ?? 'ACP agent error') as string,
        code: toErrorCode(u.code),
        retryable: false,
        source: { id: 'acp', name: 'ACP' },
      };
    }

    // done / stop / 其余控制类变体：由 driver 的 prompt() 返回值处理，不映射为事件
    default:
      return null;
  }
}
