/**
 * E2E Agent Server — mock AI SDK 源 + 真实 agent+web 服务
 *
 * 用 agent-source 的 createScriptedDriver 构造假源，配合 web 包的 setupAgentWs
 * 注册真实 WS 路由，实现「mock AI SDK 源 + 真实 agent+web 服务」的 E2E 环境。
 *
 * E2E 专用：通过相对路径直连 web 包内部模块（setupAgentWs / registerAgentRestRoutes），
 * 不走包出口——depcruise 不扫描 packages/e2e，不会误报 deep import。
 */
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createLatticeAgent, createAgentSource } from '@qcqx/lattice-agent';
import type { LatticeAgent } from '@qcqx/lattice-agent';
import { defineSource } from '@qcqx/lattice-agent-source';
import { createScriptedDriver } from '@qcqx/lattice-agent-source/testing';
import { initDb, getSessionsCacheDir } from '@qcqx/lattice-core';

// E2E-only: 直连 web 包内部模块（不走包出口；depcruise 不扫 e2e）
import { setupAgentWs } from '../../web/src/server/routes/agents/ws-handler.js';
import { registerAgentRestRoutes } from '../../web/src/server/routes/agents/rest-routes.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** mock 源 ID——与 client 默认 agentId 对齐（client 不指定 agentId 时 fallback 'qoder'） */
const MOCK_SOURCE_ID = 'mock';

/** 最小 HTML 占位页（web 客户端构建不存在时使用，page.evaluate 直连 WS） */
const MINIMAL_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Lattice E2E</title></head>
<body>
<h1>Lattice E2E Test Page</h1>
<p>WebSocket endpoint: <code>/api/agent/ws</code></p>
<script>window.__e2eReady = true;</script>
</body>
</html>`;

export interface E2EServer {
  app: ReturnType<typeof Fastify>;
  agent: LatticeAgent;
  port: number;
  close: () => Promise<void>;
}

/**
 * 创建 E2E 服务器：Fastify + mock agent + WS/REST 路由 + 静态客户端
 *
 * LATTICE_HOME 必须在调用前设置（由 fixtures/server-setup.ts 负责），
 * 确保 DB / session 缓存落在测试隔离目录。
 */
export async function createE2EServer(port = 14530): Promise<E2EServer> {
  // 初始化数据库（LATTICE_HOME 已设置，数据落在测试隔离目录）
  await initDb();

  // ── 创建 mock agent ──
  const sourcesInstance = await createAgentSource({
    sources: [
      defineSource(
        createScriptedDriver({
          id: MOCK_SOURCE_ID,
          // 能力基线：允许 resume + open 模型策略（prompt 可跑通）
          capabilities: {
            session: {
              resume: true,
              fork: false,
              rename: false,
              maxConcurrentSessions: 'unlimited',
            },
            models: { policy: 'open', tuning: false },
          },
          auth: { status: 'configured', detail: 'mock' },
          models: [
            {
              id: 'mock-model',
              displayName: 'Mock Model',
              capabilities: {
                streaming: true,
                toolCalling: false,
                vision: false,
                reasoning: false,
              },
              contextWindow: 32_000,
              maxOutputTokens: 4_096,
            },
          ],
          // 每轮 prompt 回放脚本：emit text → 工厂合成 done
          script: [{ type: 'text', content: 'Hello from mock agent!' }],
          outcome: { sourceMessageId: 'mock-msg-1' },
        }),
      ),
    ],
  });

  const agent = createLatticeAgent({
    storage: { baseDir: getSessionsCacheDir() },
    sources: sourcesInstance,
  });

  // ── 创建 Fastify app ──
  const app = Fastify({ logger: { level: 'warn' } });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // 健康检查端点（Playwright webServer url 探测用）
  app.get('/health', async () => ({ status: 'ok' }));

  // Agent WS 路由（web 包真实实现 + mock agent 注入）
  const getAgent = async (): Promise<LatticeAgent> => agent;
  const { cleanupTree } = setupAgentWs(app, getAgent);

  // Agent REST 路由（sources/models/conversations/tree 查询；web 客户端需要）
  registerAgentRestRoutes(app, getAgent, cleanupTree);

  // ── 静态资源：web 客户端构建（若存在）或最小 HTML 占位 ──
  const clientDir = resolve(__dirname, '../../web/dist/client');
  if (existsSync(clientDir)) {
    const assetsDir = resolve(clientDir, 'assets');
    if (existsSync(assetsDir)) {
      await app.register(fastifyStatic, {
        root: assetsDir,
        prefix: '/assets/',
        wildcard: true,
      });
    }
    const indexPath = resolve(clientDir, 'index.html');
    // SPA fallback：非 /api 请求返回 index.html
    app.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api') && existsSync(indexPath)) {
        return reply.type('text/html').send(readFileSync(indexPath, 'utf-8'));
      }
      reply.code(404).send({ code: 'not_found', message: `Route ${req.url} not found` });
    });
  } else {
    // 构建不存在：提供最小 HTML 占位页（page.evaluate 直连 WS）
    app.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api')) {
        return reply.type('text/html').send(MINIMAL_HTML);
      }
      reply.code(404).send({ code: 'not_found', message: `Route ${req.url} not found` });
    });
  }

  await app.listen({ port, host: '127.0.0.1' });

  return {
    app,
    agent,
    port,
    async close() {
      await app.close();
      await agent.dispose();
    },
  };
}
