import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { registerRoutes } from './routes';
import { initDb } from '@qcqx/lattice-core';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** 创建 Fastify 实例并注册所有插件和路由 */
export async function createServer() {
  // 初始化数据库（必须在路由注册前完成）
  await initDb();

  const app = Fastify({
    logger: { level: 'warn' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  // CORS（开发时前端 :5173 与 API :14527 分端口）
  await app.register(fastifyCors, { origin: true });

  // WebSocket（内置终端组件）
  await app.register(fastifyWebsocket);

  // API 路由
  await registerRoutes(app);

  // 静态资源（仅生产构建后存在 dist/client 时注册）
  const clientDir = resolve(__dirname, '../client');
  const indexPath = resolve(clientDir, 'index.html');

  if (existsSync(clientDir)) {
    // 注册 /assets/ 下的静态资源（JS/CSS/图片等）
    const assetsDir = resolve(clientDir, 'assets');
    if (existsSync(assetsDir)) {
      await app.register(fastifyStatic, {
        root: assetsDir,
        prefix: '/assets/',
        wildcard: true,
      });
    }

    // SPA fallback：非 /api 请求返回 index.html
    app.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api')) {
        if (existsSync(indexPath)) {
          const html = readFileSync(indexPath, 'utf-8');
          return reply.type('text/html').send(html);
        }
      }
      reply.code(404).send({ error: 'not_found', message: `Route ${req.url} not found` });
    });
  } else {
    // 开发模式：Vite dev server 提供前端，Fastify 只提供 API
    app.setNotFoundHandler((req, reply) => {
      reply.code(404).send({ error: 'not_found', message: `Route ${req.url} not found` });
    });
  }

  return app;
}
