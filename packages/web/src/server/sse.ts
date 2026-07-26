import type { FastifyReply } from 'fastify';
import type { SseProgress, SseDone } from '@qcqx/lattice-agent-protocol';

export type { SseProgress, SseDone };

/**
 * 设置 SSE 响应头，返回写入函数。
 *
 * 使用方式：
 * ```ts
 * const sse = createSseStream(reply);
 * sse.send({ current: 1, total: 100 });
 * sse.done({ result: { added: 5 } });
 * ```
 */
export function createSseStream(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  reply.raw.on('close', () => {
    closed = true;
  });
  reply.raw.on('error', () => {
    closed = true;
  });

  return {
    /** 发送进度事件 */
    send(data: SseProgress): void {
      if (closed) return;
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    /** 发送完成事件并关闭流 */
    done(data: SseDone): void {
      if (closed) return;
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      reply.raw.end();
    },
    /** 检查连接是否已关闭 */
    get isClosed(): boolean {
      return closed;
    },
  };
}
