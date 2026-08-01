/**
 * Agent 路由入口 — 薄接线层
 *
 * 职责：创建 LatticeAgent 单例 + 组装 REST / WS 两组路由。
 * 拆分自原 routes/agents.ts（756 行）：
 *   - shared.ts：send()/readCustomModels() 等共享工具 + WsSocket/AgentConn 类型（依赖图底层，防循环）
 *   - rest-routes.ts：7 个 REST 端点（sources/models/resources/file-search/tree/conversations）
 *   - ws-handler.ts：WS 连接 + 多端同步状态 + 快照 + hooks
 *   - ws-commands.ts：18 个 ClientMessage 命令分发
 */
import type { FastifyInstance } from 'fastify';
import { createLatticeAgent, type LatticeAgent } from '@qcqx/lattice-agent';
import { createAgentSource } from '@qcqx/lattice-agent-source';
import { createPiSource, createQoderSource } from '@qcqx/lattice-agent-source-builtins';
import { getSessionsCacheDir, getUsername } from '@qcqx/lattice-core';
import { readFile } from 'node:fs/promises';
import { resolveFilePath } from '../shared';
import { registerAgentRestRoutes } from './rest-routes';
import { setupAgentWs } from './ws-handler';

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
