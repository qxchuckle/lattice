/**
 * Qoder 消息 → SourceEvent 映射（纯函数）
 */
import type { DriverEvent } from '@qcqx/lattice-agent-source';
import { recordField, stringField } from '../internal/shape.js';

/** 从工具参数提取文件路径（Qoder 写入类工具用 `file_path` 参数） */
function extractPath(args: Record<string, unknown>): string | undefined {
  const p = args.file_path ?? args.filePath ?? args.path;
  return typeof p === 'string' && p ? p : undefined;
}

/** 写入类工具调用 → 额外映射出 file_edit 事件（壳层凭此汇总改动文件，不认工具名） */
function mapFileWrite(name: string, args: Record<string, unknown>): DriverEvent | null {
  const kind = name === 'Write' ? 'create' : name === 'Edit' ? 'edit' : null;
  const path = extractPath(args);
  if (!kind || !path) return null;
  return { type: 'file_edit', path, kind };
}

export function mapQoderMessage(
  msg: Record<string, unknown>,
  source: { id: string; name: string },
): DriverEvent[] {
  const events: DriverEvent[] = [];
  const type = msg.type as string;

  if (type === 'assistant') {
    const message = msg.message as {
      content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>;
    };
    if (message?.content) {
      for (const block of message.content) {
        // 跳过 text：流式 delta 已经产出过，避免重复
        if (block.type === 'tool_use') {
          const name = block.name ?? 'unknown';
          const args = recordField(block, 'input');
          events.push({ type: 'tool_call', id: block.id ?? '', name, args });
          const fileEdit = mapFileWrite(name, args);
          if (fileEdit) events.push(fileEdit);
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
  } else if (type === 'system' && (msg.subtype as string) === 'compact_boundary') {
    // 源内部压缩边界（auto/manual）：透传观察，SDK resume/fork 自行感知边界
    const meta = msg.compact_metadata as { trigger?: 'manual' | 'auto'; pre_tokens?: number };
    events.push({
      type: 'compaction',
      trigger: meta?.trigger ?? 'auto',
      ...(meta?.pre_tokens !== undefined ? { preTokens: meta.pre_tokens } : {}),
    });
  } else if (type === 'result') {
    // SDK 错误 result 的 subtype 为 error_during_execution / error_max_turns /
    // error_max_budget_usd / error_max_structured_output_retries（永不为 'error'），
    // 且 SDKResultSuccess 也可能携带 is_error=true；故以 is_error 或 error 前缀判定。
    const subtype = typeof msg.subtype === 'string' ? msg.subtype : '';
    if (msg.is_error === true || subtype.startsWith('error')) {
      // 错误文案：SDKResultError 用 errors: string[]；SDKResultSuccess(is_error) 用 result: string
      const errors = Array.isArray(msg.errors)
        ? msg.errors.filter((e): e is string => typeof e === 'string' && e !== '').join('\n')
        : '';
      events.push({
        type: 'error',
        message: errors || stringField(msg, 'result') || 'Unknown error',
        code: 'unknown',
        retryable: false,
        source,
      });
    }
  }

  return events;
}
