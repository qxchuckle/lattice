/**
 * Pi 事件 → SourceEvent 映射（纯函数）
 */
import type { SourceEvent } from '../../types.js';

export function mapPiEvent(
  event: Record<string, unknown>,
  source: { id: string; name: string },
): SourceEvent | null {
  const type = event.type as string;

  switch (type) {
    case 'message_update': {
      const e = event as { assistantMessageEvent?: { type: string; delta?: string } };
      const inner = e.assistantMessageEvent;
      if (inner?.type === 'text_delta' && inner.delta) {
        return { type: 'text', content: inner.delta };
      }
      if (inner?.type === 'thinking_delta' && inner.delta) {
        return { type: 'thinking', content: inner.delta };
      }
      return null;
    }
    case 'tool_execution_start': {
      const e = event as {
        toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
      };
      return {
        type: 'tool_call',
        id: e.toolCall?.id ?? '',
        name: e.toolCall?.name ?? 'unknown',
        args: e.toolCall?.arguments ?? {},
      };
    }
    case 'tool_execution_end': {
      const e = event as {
        toolCall?: { id?: string; name?: string };
        result?: unknown;
        isError?: boolean;
      };
      return {
        type: 'tool_result',
        id: e.toolCall?.id ?? '',
        name: e.toolCall?.name ?? 'unknown',
        result: e.result,
        isError: e.isError,
      };
    }
    case 'error': {
      const e = event as { error?: string; message?: string };
      return {
        type: 'error',
        message: e.error ?? e.message ?? 'Unknown error',
        code: 'unknown',
        retryable: false,
        source,
      };
    }
    default:
      return null;
  }
}
