/**
 * 文件监听 SSE 路由 — chokidar 监听 + Server-Sent Events 推送
 */
import type { FastifyInstance } from 'fastify';
import chokidar, { type FSWatcher } from 'chokidar';
import { getUsername } from '@qcqx/lattice-core';
import { isPathSafe } from './shared';

interface WatcherEntry {
  watcher: FSWatcher;
  clients: Set<{ res: { raw: { write: (data: string) => void } } }>;
}

const watchers = new Map<string, WatcherEntry>();

export function registerFileWatcherRoutes(app: FastifyInstance) {
  /**
   * GET /api/fs/watch?root=<path>
   * SSE 流：推送文件变更事件
   */
  app.get('/api/fs/watch', async (request, reply) => {
    const { root } = request.query as { root?: string };
    if (!root) {
      return reply.status(400).send({ error: 'root is required' });
    }

    const username = await getUsername();
    if (!isPathSafe(root, username)) {
      return reply.status(403).send({ error: 'path not allowed' });
    }

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // 复用或创建 watcher
    let entry = watchers.get(root);
    if (!entry) {
      const watcher = chokidar.watch(root, {
        ignored: /(^|[/\\])(node_modules|\.git|dist|__pycache__|\.pnpm-store)/,
        persistent: true,
        ignoreInitial: true,
        depth: 10,
      });
      entry = { watcher, clients: new Set() };
      watchers.set(root, entry);

      watcher.on('all', (event, filePath) => {
        const data = JSON.stringify({ event, path: filePath, timestamp: Date.now() });
        for (const client of entry!.clients) {
          client.res.raw.write(`data: ${data}\n\n`);
        }
      });
    }

    const client = { res: reply };
    entry.clients.add(client);

    // 心跳
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 30000);

    // 清理
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      entry!.clients.delete(client);
      if (entry!.clients.size === 0) {
        entry!.watcher.close();
        watchers.delete(root);
      }
    });
  });

  /**
   * POST /api/fs/watch/stop
   * 停止指定 root 的监听
   */
  app.post('/api/fs/watch/stop', async (request, reply) => {
    const { root } = request.body as { root?: string };
    if (!root) return reply.status(400).send({ error: 'root required' });

    const entry = watchers.get(root);
    if (entry) {
      await entry.watcher.close();
      watchers.delete(root);
    }
    return { ok: true };
  });
}
