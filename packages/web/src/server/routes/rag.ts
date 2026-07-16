import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  getRAGStatus,
  updateRagIndex,
  forceRebuildIndex,
  isModelInstalled,
  isModelLoaded,
  getModelLoadError,
  isModelLoadNetworkError,
  formatModelNetworkHint,
  generateEmbedding,
  removeInstalledModel,
} from '@qcqx/lattice-core';
import { createSseStream } from '../sse';

/** RAG 操作并发锁 */
const ragLock = { running: false };

export function registerRagRoutes(app: FastifyInstance): void {
  app.get('/api/rag/status', async () => {
    return await getRAGStatus();
  });

  app.post('/api/rag/update', async (_req, reply) => {
    if (ragLock.running) {
      reply.code(409);
      return { error: 'conflict', message: 'RAG 操作正在进行中，请稍后再试' };
    }
    ragLock.running = true;
    let sse: ReturnType<typeof createSseStream> | null = null;
    try {
      sse = createSseStream(reply);
      const result = await updateRagIndex((p) => {
        sse!.send({
          current: p.current,
          total: p.total,
          added: p.added,
          updated: p.updated,
          removed: 0,
          skipped: p.skipped,
          chunksProcessed: p.chunksProcessed,
          currentFile: p.currentFile,
        });
      });
      sse.done({ done: true, result: { ...result, mode: result.mode } });
    } catch (err) {
      if (sse) {
        // SSE 已开始，通过事件发送错误
        sse.done({ done: true, error: (err as Error).message });
      } else {
        // createSseStream 自身失败，回退到 JSON
        reply.code(500);
        return { error: 'internal', message: (err as Error).message };
      }
    } finally {
      ragLock.running = false;
    }
  });

  app.post('/api/rag/rebuild', async (_req, reply) => {
    if (ragLock.running) {
      reply.code(409);
      return { error: 'conflict', message: 'RAG 操作正在进行中，请稍后再试' };
    }
    ragLock.running = true;
    let sse: ReturnType<typeof createSseStream> | null = null;
    try {
      sse = createSseStream(reply);
      const indexed = await forceRebuildIndex((p) => {
        sse!.send({
          current: p.current,
          total: p.total,
          added: p.added,
          updated: p.updated,
          removed: 0,
          skipped: p.skipped,
          chunksProcessed: p.chunksProcessed,
          currentFile: p.currentFile,
        });
      });
      sse.done({ done: true, result: { indexed } });
    } catch (err) {
      if (sse) {
        sse.done({ done: true, error: (err as Error).message });
      } else {
        reply.code(500);
        return { error: 'internal', message: (err as Error).message };
      }
    } finally {
      ragLock.running = false;
    }
  });

  // ── 模型管理 ──

  app.get('/api/rag/model/status', async () => {
    return {
      installed: await isModelInstalled(),
      loaded: isModelLoaded(),
      loadError: getModelLoadError()?.message ?? null,
      isNetworkError: isModelLoadNetworkError(),
      networkHint: isModelLoadNetworkError() ? formatModelNetworkHint() : null,
    };
  });

  app.post('/api/rag/model/download', async (_req, reply) => {
    const sse = createSseStream(reply);
    try {
      const embedding = await generateEmbedding('lattice web model warmup');
      sse.done({
        done: true,
        result: { success: !!embedding },
      });
    } catch (err) {
      sse.done({ done: true, error: (err as Error).message });
    }
  });

  app.post('/api/rag/model/remove', async () => {
    await removeInstalledModel();
    return { success: true };
  });
}
