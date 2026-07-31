/**
 * Agent 路由内共享工具与类型 — 无路由注册逻辑
 *
 * 从 index.ts 拆出（原 index.ts 既是入口又承载共享工具，被子模块回 import
 * 形成循环依赖）。本模块位于依赖图最底层，只被 index / rest-routes /
 * ws-handler / ws-commands 单向引用。
 */
import type { ServerMessage } from '@qcqx/lattice-agent-protocol';
import { readLocalConfig } from '@qcqx/lattice-core';

/** 类型安全发送（连接已关闭时静默） */
export function send(ws: { send: (data: string) => void }, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* 连接已关闭 */
  }
}

/** 读 local config 中某源的自定义模型列表（agent.customModels.<sourceId>） */
export async function readCustomModels(sourceId: string): Promise<string[]> {
  const config = (await readLocalConfig()) as Record<string, unknown> | null;
  const agentCfg = config?.agent as { customModels?: Record<string, unknown> } | undefined;
  const list = agentCfg?.customModels?.[sourceId];
  return Array.isArray(list)
    ? list.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    : [];
}

/** WebSocket 连接最小类型（传输层仅依赖这些方法，不绑定具体 ws 实现） */
export interface WsSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', handler: (raw: Buffer | string | unknown[]) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
}

/** 一个 WS 连接（订阅者）：可订多棵树；一棵树可被多连接订阅 */
export interface AgentConn {
  id: string;
  socket: WsSocket;
  clientKind: string;
  subscribed: Set<string>;
  /** P1-#12: 该连接有权 respond 的 permission requestId 集合 */
  pendingPermissions: Set<string>;
  /** P1-#12 fix: 该连接发起/持有的 session 集合，用于权限请求按 session 归属过滤 */
  sessions: Set<string>;
}
