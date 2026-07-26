/**
 * Qoder 消息 → SourceEvent 映射（纯函数）
 */
import type { SourceEvent } from '../../types.js';

export function mapQoderMessage(
  msg: Record<string, unknown>,
  source: { id: string; name: string },
): SourceEvent[] {
  const events: SourceEvent[] = [];
  const type = msg.type as string;

  if (type === 'assistant') {
    const message = msg.message as {
      content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>;
    };
    if (message?.content) {
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          events.push({ type: 'text', content: block.text });
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool_call',
            id: block.id ?? '',
            name: block.name ?? 'unknown',
            args: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }
    }
  } else if (type === 'stream_event') {
    const event = msg.event as { delta?: { type: string; text?: string; thinking?: string } };
    const delta = event?.delta;
    if (delta?.type === 'text_delta' && delta.text) {
      events.push({ type: 'text', content: delta.text });
    } else if (delta?.type === 'thinking_delta' && delta.thinking) {
      events.push({ type: 'thinking', content: delta.thinking });
    }
  } else if (type === 'result') {
    const subtype = msg.subtype as string;
    if (subtype === 'error') {
      events.push({
        type: 'error',
        message: (msg.error as string) ?? 'Unknown error',
        code: 'unknown',
        retryable: false,
        source,
      });
    }
  }

  return events;
}
