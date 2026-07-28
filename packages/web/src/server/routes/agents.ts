/**
 * Agent WebSocket + REST 路由 — 薄传输层
 *
 * 所有会话编排（send/continue/retry/undo/delete/fork/abort）下沉到 agent 包的
 * ConversationController。本层只负责：
 *   - WS 消息解析 / 类型守卫 / 分发
 *   - controller hooks 回调 → WS 消息转发
 *   - REST 查询（sources/models/tree/conversations）
 *
 * WS 协议（@qcqx/lattice-agent-protocol）：
 *   ClientMessage: session.* / tree.* / permission.respond
 *   ServerMessage: session.created / event / session.error / session.closed
 *                  tree.updated / tree.error / permission.request
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createLatticeAgent,
  createAgentSource,
  PiSource,
  QoderSource,
  type LatticeAgent,
  type AgentSourceInstance,
  type ConversationHooks,
} from '@qcqx/lattice-agent';
import type { ClientMessage, ServerMessage } from '@qcqx/lattice-agent-protocol';
import { isClientMessage } from '@qcqx/lattice-agent-protocol';
import { isAuthEnabled, readWebAuth, getSessionsCacheDir } from '@qcqx/lattice-core';
import { extractToken, verifyJwt } from '../auth';
import { randomUUID } from 'node:crypto';

// ── 类型安全发送 ──

function send(ws: { send: (data: string) => void }, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* 连接已关闭 */
  }
}

/** WebSocket 连接最小类型（传输层仅依赖这些方法，不绑定具体 ws 实现） */
interface WsSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', handler: (raw: Buffer | string | unknown[]) => void): void;
  on(event: 'close' | 'error', handler: () => void): void;
}

// ── 路由注册 ──

export function registerAgentRoutes(app: FastifyInstance): void {
  let agent: LatticeAgent | null = null;
  let sourcesInstance: AgentSourceInstance | null = null;

  async function getAgent(): Promise<LatticeAgent> {
    if (!agent) {
      if (!sourcesInstance) {
        sourcesInstance = await createAgentSource({
          sources: [
            new PiSource(),
            new QoderSource({ authMode: 'cli', permissionMode: 'acceptEdits' }),
          ],
        });
      }
      agent = createLatticeAgent({
        storage: { baseDir: getSessionsCacheDir() },
        sources: sourcesInstance,
      });
    }
    return agent;
  }

  // ═══════════════════════════════════════════
  // WebSocket
  // ═══════════════════════════════════════════

  (app as any).get(
    '/api/agent/ws',
    { websocket: true },
    async (socket: WsSocket, req: FastifyRequest) => {
      // 鉴权
      if (await isAuthEnabled()) {
        const webAuth = await readWebAuth();
        const token = extractToken(req);
        if (!token || !webAuth || !verifyJwt(token, webAuth.jwtSecret)) {
          socket.close(4001, 'unauthorized');
          return;
        }
      }

      const latticeAgent = await getAgent();
      const { conversation, session, sources, permission, events } = latticeAgent;

      // 本 socket 进行中的请求（断开时只 abort 自己的，不影响其他 tab）
      const socketRequestIds = new Set<string>();

      // 构建单次操作的 hooks：controller 回调 → WS 消息，并跟踪请求生命周期
      const makeHooks = (sessionId: string, trackRid: string | undefined): ConversationHooks => {
        const sourceId = conversation.getSession(sessionId)?.sourceId ?? 'qoder';
        if (trackRid) socketRequestIds.add(trackRid);
        const untrack = (): void => {
          if (trackRid) socketRequestIds.delete(trackRid);
        };
        return {
          onEvent: (event, rid) =>
            send(socket, { type: 'event', sessionId, event, requestId: rid }),
          onError: (message, rid) => {
            untrack();
            send(socket, { type: 'session.error', sessionId, message, requestId: rid });
          },
          onTreeUpdated: (treeId, headNodeId, rid) => {
            untrack();
            send(socket, { type: 'tree.updated', treeId, headNodeId, requestId: rid });
          },
          onTreeCreated: (treeId) =>
            send(socket, { type: 'session.created', sessionId, treeId, agentId: sourceId }),
        };
      };

      // 权限事件转发
      const unsubPermission = events.on('permission:request', (event) => {
        const p = event.payload as {
          requestId: string;
          tool: string;
          args: Record<string, unknown>;
          level: 'allow' | 'ask' | 'deny';
        };
        send(socket, {
          type: 'permission.request',
          requestId: p.requestId,
          tool: p.tool,
          args: p.args,
          level: p.level,
        });
      });

      socket.on('message', async (raw: Buffer | string | unknown[]) => {
        let parsed: unknown;
        try {
          const text = typeof raw === 'string' ? raw : Buffer.from(raw as Uint8Array).toString();
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        if (!isClientMessage(parsed)) return;
        const msg: ClientMessage = parsed;

        switch (msg.type) {
          case 'session.create': {
            const sourceId = msg.agentId ?? 'qoder';
            if (!sources.registry.getSource(sourceId)) {
              send(socket, {
                type: 'session.error',
                sessionId: '',
                message: `Source not found: ${sourceId}`,
              });
              return;
            }
            const sessionId = randomUUID();
            let treeId = msg.treeId ?? null;
            if (treeId && !(await session.loadTree(treeId))) treeId = null; // 指定的树不存在 → 懒创建
            conversation.createSession(sessionId, sourceId, treeId);
            send(socket, {
              type: 'session.created',
              sessionId,
              treeId: treeId ?? '',
              agentId: sourceId,
            });
            break;
          }

          case 'session.send': {
            if (!msg.sessionId || !msg.message) return;
            const requestId = msg.requestId ?? randomUUID();
            conversation.send(
              msg.sessionId,
              msg.message,
              {
                parentNodeId: msg.parentNodeId,
                branchId: msg.branchId,
                requestId,
                model: msg.model,
              },
              makeHooks(msg.sessionId, requestId),
            );
            break;
          }

          case 'session.continue': {
            if (!msg.sessionId || !msg.nodeId) return;
            const requestId = msg.requestId ?? randomUUID();
            conversation.continue(
              msg.sessionId,
              msg.nodeId,
              requestId,
              makeHooks(msg.sessionId, requestId),
            );
            break;
          }

          case 'session.retry': {
            if (!msg.sessionId || !msg.nodeId) return;
            const requestId = msg.requestId ?? randomUUID();
            conversation.retry(
              msg.sessionId,
              msg.nodeId,
              requestId,
              makeHooks(msg.sessionId, requestId),
            );
            break;
          }

          case 'session.undo':
          case 'session.delete': {
            if (!msg.sessionId || !msg.nodeId) return;
            const hooks = makeHooks(msg.sessionId, undefined);
            if (msg.type === 'session.undo') {
              await conversation.undo(msg.sessionId, msg.nodeId, hooks);
            } else {
              await conversation.delete(msg.sessionId, msg.nodeId, hooks);
            }
            break;
          }

          case 'session.abort': {
            if (msg.sessionId) conversation.abort(msg.sessionId, msg.requestId);
            break;
          }

          case 'session.destroy': {
            if (msg.sessionId) await conversation.destroySession(msg.sessionId);
            send(socket, { type: 'session.closed', sessionId: msg.sessionId });
            break;
          }

          case 'tree.fork': {
            if (!msg.treeId || !msg.nodeId) return;
            const branch = await conversation.fork(msg.treeId, msg.nodeId, msg.branchName);
            send(socket, { type: 'tree.updated', treeId: msg.treeId, branch });
            break;
          }

          case 'tree.delete': {
            if (!msg.treeId || !msg.nodeIds?.length) return;
            if (!session.canBatchDelete(msg.treeId, msg.nodeIds)) {
              send(socket, { type: 'tree.error', treeId: msg.treeId, message: '不满足删除条件' });
              return;
            }
            await session.deleteNodes(msg.treeId, msg.nodeIds);
            send(socket, {
              type: 'tree.updated',
              treeId: msg.treeId,
              headNodeId: session.getTree(msg.treeId)?.headNodeId,
            });
            break;
          }

          case 'tree.merge': {
            if (!msg.treeId || !msg.branchId || !msg.targetNodeId) return;
            await session.merge(msg.treeId, msg.branchId, msg.targetNodeId, msg.mode ?? 'squash');
            send(socket, { type: 'tree.updated', treeId: msg.treeId });
            break;
          }

          case 'tree.switchHead': {
            if (!msg.treeId || !msg.nodeId) return;
            await session.switchHead(msg.treeId, msg.nodeId);
            send(socket, { type: 'tree.updated', treeId: msg.treeId, headNodeId: msg.nodeId });
            break;
          }

          case 'tree.setDefault': {
            if (!msg.treeId || !msg.branchId) return;
            await session.setDefaultBranch(msg.treeId, msg.branchId);
            send(socket, { type: 'tree.updated', treeId: msg.treeId });
            break;
          }

          case 'permission.respond': {
            if (msg.requestId) permission.respond(msg.requestId, msg.allowed);
            break;
          }
        }
      });

      socket.on('close', () => {
        unsubPermission();
        // 断开时 abort 该 socket 关联的进行中请求（不影响其他 tab）
        for (const rid of socketRequestIds) conversation.abortByRequestId(rid);
        socketRequestIds.clear();
      });
      socket.on('error', () => unsubPermission());
    },
  );

  // ═══════════════════════════════════════════
  // REST
  // ═══════════════════════════════════════════

  // 获取可用源列表
  app.get('/api/agent/sources', async () => {
    const latticeAgent = await getAgent();
    const sourceInfos = latticeAgent.sources.registry.listSources();
    return {
      sources: sourceInfos.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        version: s.version,
        available: s.available,
        modelCount: s.modelCount,
      })),
    };
  });

  // 获取模型列表（可按源过滤）
  app.get('/api/agent/models', async (req) => {
    const { sourceId } = req.query as { sourceId?: string };
    const latticeAgent = await getAgent();
    const models = latticeAgent.sources.registry.listModels(sourceId);
    return {
      models: models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        sourceId: sourceId ?? 'all',
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
      })),
    };
  });

  // 获取对话树（含中断检测）
  app.get('/api/agent/tree/:treeId', async (req) => {
    const { treeId } = req.params as { treeId: string };
    const latticeAgent = await getAgent();
    const tree = await latticeAgent.session.loadTree(treeId);
    if (!tree) return { error: 'not_found' as const };
    const nodes = latticeAgent.session.getNodes(treeId);
    const interruptedStreams = await latticeAgent.session.getInterruptedStreams(treeId);
    return { tree, nodes, interruptedStreams };
  });

  // 获取历史会话列表
  app.get('/api/agent/conversations', async () => {
    const latticeAgent = await getAgent();
    const sessions = await latticeAgent.session.listSessions();
    return { conversations: sessions.sort((a, b) => b.updatedAt - a.updatedAt) };
  });

  // 删除历史会话
  app.delete('/api/agent/conversations/:treeId', async (req, reply) => {
    const { treeId } = req.params as { treeId: string };
    try {
      await (await getAgent()).session.deleteTree(treeId);
      return { ok: true };
    } catch (err) {
      reply.code(500);
      return { error: String(err) };
    }
  });
}
