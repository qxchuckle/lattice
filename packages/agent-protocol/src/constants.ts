/**
 * 协议常量
 */
import type { ClientMessage, ServerMessage } from './transport/ws.js';

export const PROTOCOL_VERSION = '1.0';

/**
 * 契约版本（单调整数，破坏性契约变更时递增）。
 * 五包独立发 npm 的版本偏斜防线：defineSource/握手时校验 manifest.contractVersion，
 * 不等 → 类型化错误（区别于 PROTOCOL_VERSION：那是 WS 传输层版本）。
 * v2：本次破坏性重构（能力八组化/握手/ISource 表面改版）。
 */
export const CONTRACT_VERSION = 2;

/** Client → Server 消息类型 */
export const ClientMessageType = {
  SessionCreate: 'session.create',
  SessionSend: 'session.send',
  SessionContinue: 'session.continue',
  SessionRetry: 'session.retry',
  SessionUndo: 'session.undo',
  SessionDelete: 'session.delete',
  SessionAbort: 'session.abort',
  SessionDestroy: 'session.destroy',
  TreeFork: 'tree.fork',
  TreeDelete: 'tree.delete',
  TreeMerge: 'tree.merge',
  TreeSwitchHead: 'tree.switchHead',
  TreeSetDefault: 'tree.setDefault',
  PermissionRespond: 'permission.respond',
  // 消息排队（streaming 期间排队发送，多端同步）
  QueueEnqueue: 'queue.enqueue',
  QueueUpdate: 'queue.update',
  QueueSteer: 'queue.steer',
  // 多端同步（per-tree 订阅模型）
  TreeSubscribe: 'tree.subscribe',
  TreeUnsubscribe: 'tree.unsubscribe',
  PresenceUpdate: 'presence.update',
  Ping: 'ping',
} as const;

/** Server → Client 消息类型 */
export const ServerMessageType = {
  SessionCreated: 'session.created',
  Event: 'event',
  SessionError: 'session.error',
  SessionClosed: 'session.closed',
  TreeUpdated: 'tree.updated',
  TreeError: 'tree.error',
  PermissionRequest: 'permission.request',
  PermissionExpired: 'permission.expired',
  // 多端同步（per-tree 广播模型）
  TreeSnapshot: 'tree.snapshot',
  TreeEvent: 'tree.event',
  TreeReject: 'tree.reject',
  StreamEvent: 'stream.event',
  StreamAborted: 'stream.aborted',
  PresenceState: 'presence.state',
  QueueState: 'queue.state',
  Pong: 'pong',
} as const;

/** 协议级错误码（区别于 SourceEvent 中的 SourceErrorCode） */
export type ProtocolErrorCode =
  | 'unauthorized'
  | 'session_not_found'
  | 'invalid_message'
  | 'internal_error';

// ── 编译期双向钉死：ClientMessageType ↔ ClientMessage['type'] ──
// 方向一（satisfies 在 ws.ts 的 ClientMessage 联合侧保证值合法）；
// 方向二：ClientMessage 新增变体而 ClientMessageType 未补 → 此处编译报错。
// 与 guards.ts 的 SourceEvent 钉死同模式，堵 isClientMessage 静默丢弃缺口。
type _MissingClientTypes = Exclude<
  ClientMessage['type'],
  (typeof ClientMessageType)[keyof typeof ClientMessageType]
>;
const _assertNoMissingClientTypes: _MissingClientTypes extends never ? true : never = true;
void _assertNoMissingClientTypes;

type _MissingServerTypes = Exclude<
  ServerMessage['type'],
  (typeof ServerMessageType)[keyof typeof ServerMessageType]
>;
const _assertNoMissingServerTypes: _MissingServerTypes extends never ? true : never = true;
void _assertNoMissingServerTypes;

/** 合法 client 消息 type 值集合（供 guards 使用） */
export const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(ClientMessageType));

/** 合法 server 消息 type 值集合（供 guards 使用） */
export const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(ServerMessageType));
