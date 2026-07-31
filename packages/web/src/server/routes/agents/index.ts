/**
 * Agent 路由入口 — 薄接线层
 *
 * 职责：创建 LatticeAgent 单例 + 组装 REST / WS 两组路由。
 * 拆分自原 routes/agents.ts（756 行）：
 *   - rest-routes.ts：7 个 REST 端点（sources/models/resources/file-search/tree/conversations）
 *   - ws-handler.ts：WS 连接 + 多端同步状态 + 快照 + hooks
 *   - ws-commands.ts：18 个 ClientMessage 命令分发
 */
import type { FastifyInstance } from 'fastify';
import {
  createLatticeAgent,
  createAgentSource,
  createPiSource,
  createQoderSource,
  type LatticeAgent,
} from '@qcqx/lattice-agent';
import type { ServerMessage } from '@qcqx/lattice-agent-protocol';
import { getSessionsCacheDir, getUsername, readLocalConfig } from '@qcqx/lattice-core';
import { readFile } from 'node:fs/promises';
import { resolveFilePath } from '../shared';
import { registerAgentRestRoutes } from './rest-routes';
import { setupAgentWs } from './ws-handler';

// ── 共享工具 ──

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

// ── 路由注册 ──

export function registerAgentRoutes(app: FastifyInstance): void {
  // 并发安全的懒初始化：首批请求（/sources、/models、WS 等）会同时到达，
  // 若只判 `if (!agent)` 会各自 createAgentSource → 多次 initAll/handshake/probe（日志重复、资源浪费）。
  // 缓存 Promise 本身，保证全局只构建一次。
  let agentPromise: Promise<LatticeAgent> | null = null;

  const buildAgent = async (): Promise<LatticeAgent> => {
    const sourcesInstance = await createAgentSource({
      sources: [
        createPiSource(),
        createQoderSource({ authMode: 'cli', permissionMode: 'acceptEdits' }),
      ],
    });
    return createLatticeAgent({
      storage: { baseDir: getSessionsCacheDir() },
      sources: sourcesInstance,
      promptDeps: {
        resolveRef: async (refType, id) => {
          if (refType === 'file') return null;
          try {
            const username = await getUsername();
            const path = await resolveFilePath(refType === 'spec' ? 'spec' : 'prd', id, username);
            return path ? await readFile(path, 'utf-8') : null;
          } catch {
            return null;
          }
        },
      },
    });
  };

  const getAgent = (): Promise<LatticeAgent> => {
    agentPromise ??= buildAgent();
    return agentPromise;
  };

  // WS 路由（含多端同步状态）；返回 cleanupTree 供 REST DELETE 使用
  const { cleanupTree } = setupAgentWs(app, getAgent);

  // REST 路由
  registerAgentRestRoutes(app, getAgent, cleanupTree);
}
