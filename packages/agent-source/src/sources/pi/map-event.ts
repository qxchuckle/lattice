/**
 * Pi 事件 → SourceEvent 映射（纯函数）
 * 返回数组：一个 SDK 事件可映射出多个标准事件（如写入类工具调用 → tool_call + file_edit）
 */
import type { SourceEvent } from '../../types.js';

/** 从工具参数提取文件路径（Pi 写入类工具统一用 `path` 参数） */
function extractPath(args: Record<string, unknown>): string | undefined {
  const p = args.path ?? args.filePath ?? args.file_path;
  return typeof p === 'string' && p ? p : undefined;
}

/** 写入类工具调用 → 额外映射出 file_edit 事件（壳层凭此汇总改动文件，不认工具名） */
function mapFileWrite(name: string, args: Record<string, unknown>): SourceEvent | null {
  const kind = name === 'write' ? 'create' : name === 'edit' ? 'edit' : null;
  const path = extractPath(args);
  if (!kind || !path) return null;
  return { type: 'file_edit', path, kind };
}

export function mapPiEvent(
  event: Record<string, unknown>,
  source: { id: string; name: string },
): SourceEvent[] {
  const type = event.type as string;

  switch (type) {
    case 'message_update': {
      const e = event as { assistantMessageEvent?: { type: string; delta?: string } };
      const inner = e.assistantMessageEvent;
      if (inner?.type === 'text_delta' && inner.delta) {
        return [{ type: 'text', content: inner.delta }];
      }
      if (inner?.type === 'thinking_delta' && inner.delta) {
        return [{ type: 'thinking', content: inner.delta }];
      }
      return [];
    }
    case 'tool_execution_start': {
      const e = event as {
        toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
      };
      const name = e.toolCall?.name ?? 'unknown';
      const args = e.toolCall?.arguments ?? {};
      const events: SourceEvent[] = [{ type: 'tool_call', id: e.toolCall?.id ?? '', name, args }];
      const fileEdit = mapFileWrite(name, args);
      if (fileEdit) events.push(fileEdit);
      return events;
    }
    case 'tool_execution_end': {
      const e = event as {
        toolCall?: { id?: string; name?: string };
        result?: unknown;
        isError?: boolean;
      };
      return [
        {
          type: 'tool_result',
          id: e.toolCall?.id ?? '',
          name: e.toolCall?.name ?? 'unknown',
          result: e.result,
          isError: e.isError,
        },
      ];
    }
    case 'compaction_end': {
      // Pi 自动/手动压缩完成（threshold/overflow 在 agent_end 前发出，必在订阅窗口内）
      const e = event as {
        reason?: 'manual' | 'threshold' | 'overflow';
        aborted?: boolean;
        result?: { summary?: string; tokensBefore?: number; estimatedTokensAfter?: number };
      };
      if (e.aborted || !e.result) return []; // 取消/失败不产生标记
      return [
        {
          type: 'compaction',
          trigger: e.reason === 'manual' ? 'manual' : 'auto',
          ...(e.result.tokensBefore !== undefined ? { preTokens: e.result.tokensBefore } : {}),
          ...(e.result.estimatedTokensAfter !== undefined
            ? { postTokens: e.result.estimatedTokensAfter }
            : {}),
          ...(e.result.summary ? { summary: e.result.summary } : {}),
        },
      ];
    }
    case 'error': {
      const e = event as { error?: string; message?: string };
      return [
        {
          type: 'error',
          message: e.error ?? e.message ?? 'Unknown error',
          code: 'unknown',
          retryable: false,
          source,
        },
      ];
    }
    default:
      return [];
  }
}
