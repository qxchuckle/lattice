/**
 * 协议常量
 */

export const PROTOCOL_VERSION = '1.0';

/** Client → Server 消息类型 */
export const ClientMessageType = {
  SessionCreate: 'session.create',
  SessionSend: 'session.send',
  SessionAbort: 'session.abort',
  SessionDestroy: 'session.destroy',
  TreeFork: 'tree.fork',
  TreeDelete: 'tree.delete',
  TreeMerge: 'tree.merge',
  TreeSwitchHead: 'tree.switchHead',
  TreeSetDefault: 'tree.setDefault',
  PermissionRespond: 'permission.respond',
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
} as const;

/** 协议级错误码（区别于 SourceEvent 中的 SourceErrorCode） */
export type ProtocolErrorCode =
  | 'unauthorized'
  | 'session_not_found'
  | 'invalid_message'
  | 'internal_error';

/** 合法 client 消息 type 值集合（供 guards 使用） */
export const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(ClientMessageType));

/** 合法 server 消息 type 值集合（供 guards 使用） */
export const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(ServerMessageType));
