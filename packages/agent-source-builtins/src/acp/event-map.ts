/**
 * ACP session/update → SourceEvent 单向映射
 *
 * 与 mapPiEvent / mapQoderMessage 同层：把外部协议事件翻译成内部 SourceEvent。
 * 设计铁律：SourceEvent 是内部单一真相，ACP 只是传输形态之一。
 *
 * 输入类型来自 @agentclientprotocol/sdk（SessionNotification），不再手写。
 */
import type { SourceEvent, SourceErrorCode } from '@qcqx/lattice-agent-protocol';
import type { SessionNotification } from '@agentclientprotocol/sdk';

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
 * 将 SDK 的 SessionNotification 映射为 SourceEvent。
 * 返回 null = 该变体无需映射（静默跳过，不报错）。
 */
export function mapSessionUpdate(notification: SessionNotification): SourceEvent | null {
  const u = notification.update as Record<string, unknown>;
  const kind = u.sessionUpdate as string | undefined;
  if (!kind) return null;

  switch (kind) {
    case 'text':
    case 'text_delta':
    case 'agent_message_chunk': {
      // SDK ContentChunk: content 是 ContentBlock 对象（{ type:'text', text }）或字符串（非 SDK 源）
      const block = u.content as { text?: string } | string | undefined;
      const content =
        typeof block === 'string' ? block : ((block?.text ?? u.text ?? u.delta ?? '') as string);
      if (!content) return null;
      return { type: 'text', content };
    }

    case 'thinking':
    case 'thinking_delta':
    case 'agent_thought_chunk': {
      const block = u.content as { text?: string } | string | undefined;
      const content =
        typeof block === 'string' ? block : ((block?.text ?? u.text ?? u.delta ?? '') as string);
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

/** 兼容旧名（测试引用） */
export const mapAcpUpdate = mapSessionUpdate;
