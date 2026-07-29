/**
 * 轻量 type guards（运行时边界校验）
 * 仅检查 type 字段存在且合法，不做深度 schema 验证
 */
import type { ClientMessage, ServerMessage } from './transport/ws.js';
import type { SourceEvent } from './source/events.js';
import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } from './constants.js';

/** 校验是否为合法的 ClientMessage（检查 type 字段） */
export function isClientMessage(data: unknown): data is ClientMessage {
  if (typeof data !== 'object' || data === null) return false;
  const type = (data as Record<string, unknown>).type;
  return typeof type === 'string' && CLIENT_MESSAGE_TYPES.has(type);
}

/** 校验是否为合法的 ServerMessage（检查 type 字段） */
export function isServerMessage(data: unknown): data is ServerMessage {
  if (typeof data !== 'object' || data === null) return false;
  const type = (data as Record<string, unknown>).type;
  return typeof type === 'string' && SERVER_MESSAGE_TYPES.has(type);
}

const SOURCE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'thinking',
  'tool_call',
  'tool_result',
  'file_edit',
  'terminal',
  'compaction',
  'notice',
  'done',
  'error',
]);

/** 校验是否为合法的 SourceEvent（检查 type 字段） */
export function isSourceEvent(data: unknown): data is SourceEvent {
  if (typeof data !== 'object' || data === null) return false;
  const type = (data as Record<string, unknown>).type;
  return typeof type === 'string' && SOURCE_EVENT_TYPES.has(type);
}
