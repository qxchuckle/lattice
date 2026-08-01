/**
 * 轻量 type guards（运行时边界校验）
 * 仅检查 type 字段存在且合法，不做深度 schema 验证（深度校验走 `/schemas` 子出口）
 *
 * unknown 到具体形状的窄化只在 `discriminatorOf` 一处发生，下方三个 guard 共用。
 */
import type { ClientMessage, ServerMessage } from './transport/ws.js';
import type { SourceEvent } from './source/events.js';
import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } from './constants.js';

/** 取判别字段（非对象 / 无 type / type 非字符串 → undefined） */
function discriminatorOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const type = (data as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

/** 校验是否为合法的 ClientMessage（检查 type 字段） */
export function isClientMessage(data: unknown): data is ClientMessage {
  const type = discriminatorOf(data);
  return type !== undefined && CLIENT_MESSAGE_TYPES.has(type);
}

/** 校验是否为合法的 ServerMessage（检查 type 字段） */
export function isServerMessage(data: unknown): data is ServerMessage {
  const type = discriminatorOf(data);
  return type !== undefined && SERVER_MESSAGE_TYPES.has(type);
}

const SOURCE_EVENT_TYPE_LIST = [
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
  // 双向编译期钉死（方向一）：清单中不得出现 SourceEvent 之外的 type
] as const satisfies readonly SourceEvent['type'][];

// 双向编译期钉死（方向二）：SourceEvent 新增变体而清单未补 → 此处编译报错
type _MissingEventTypes = Exclude<SourceEvent['type'], (typeof SOURCE_EVENT_TYPE_LIST)[number]>;
const _assertNoMissingEventTypes: _MissingEventTypes extends never ? true : never = true;
void _assertNoMissingEventTypes;

const SOURCE_EVENT_TYPES: ReadonlySet<string> = new Set(SOURCE_EVENT_TYPE_LIST);

/** 校验是否为合法的 SourceEvent（检查 type 字段） */
export function isSourceEvent(data: unknown): data is SourceEvent {
  const type = discriminatorOf(data);
  return type !== undefined && SOURCE_EVENT_TYPES.has(type);
}

// exhaustiveness 兜底（定义在零依赖模块 exhaustiveness.ts，re-export 保持本出口向后兼容）
export { assertNever } from './exhaustiveness.js';
