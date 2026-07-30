/**
 * Agent WS 路由 — 连接管理 + 多端同步状态
 *
 * 职责：
 *   - WS 连接鉴权 + 身份建立
 *   - per-tree 订阅表 / presence / 停流宽限（跨连接共享）
 *   - 快照构建 + hooks 工厂（controller 回调 → WS 消息）
 *   - 命令分发委托 ws-commands.ts
 *   - 连接关闭清理
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { LatticeAgent, ConversationHooks } from '@qcqx/lattice-agent';
import type { ServerMessage, PresenceState, ClientMessage } from '@qcqx/lattice-agent-protocol';
import { isClientMessage } from '@qcqx/lattice-agent-protocol';
import { isAuthEnabled, readWebAuth } from '@qcqx/lattice-core';
import { extractToken, verifyJwt } from '../../auth';
import { randomUUID } from 'node:crypto';
import { send, type WsSocket, type AgentConn } from './index';
import { handleWsCommand, type WsCommandContext } from './ws-commands';

const STREAM_GRACE_MS = 30000;

export function setupAgentWs(
  app: FastifyInstance,
  getAgent: () => Promise<LatticeAgent>,
): { cleanupTree: (treeId: string) => void } {
  // ── 多端同步状态（per-tree，跨连接共享，整个路由层唯一） ──
  const treeSubscribers = new Map<string, Set<AgentConn>>();
  const treePresence = new Map<string, Map<string, PresenceState>>();
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 向一棵树的全部订阅者广播（可排除发起连接） */
  function broadcastTree(treeId: string, msg: ServerMessage, exceptConnId?: string): void {
    const subs = treeSubscribers.get(treeId);
    if (!subs) return;
    for (const c of subs) {
      if (exceptConnId && c.id === exceptConnId) continue;
      send(c.socket, msg);
    }
  }

  /** 广播该树当前全量 presence 列表 */
  function broadcastPresence(treeId: string): void {
    const peers = [...(treePresence.get(treeId)?.values() ?? [])];
    broadcastTree(treeId, { type: 'presence.state', treeId, peers });
  }

  /** 退订：仅移除订阅 + presence，不拆树资源 */
  function unsubscribeConn(conn: AgentConn, treeId: string): void {
    treeSubscribers.get(treeId)?.delete(conn);
    conn.subscribed.delete(treeId);
    if (treePresence.get(treeId)?.delete(conn.id)) broadcastPresence(treeId);
    void maybeStartGrace(treeId);
  }

  /** 订阅者归零 → 起宽限计时器；到期仍无人观看则中止该树在途流 */
  async function maybeStartGrace(treeId: string): Promise<void> {
    const subs = treeSubscribers.get(treeId);
    if (subs && subs.size > 0) return;
    if (graceTimers.has(treeId)) return;
    graceTimers.set(
      treeId,
      setTimeout(async () => {
        graceTimers.delete(treeId);
        const s = treeSubscribers.get(treeId);
        if (s && s.size > 0) return;
        const ag = await getAgent();
        ag.conversation.abortTreeStreams(treeId);
      }, STREAM_GRACE_MS),
    );
  }

  /** 取消宽限计时器（有人订阅时） */
  function cancelGrace(treeId: string): void {
    const t = graceTimers.get(treeId);
    if (t) {
      clearTimeout(t);
      graceTimers.delete(treeId);
    }
  }

  /** 清理某树的全部同步状态（REST DELETE 会话时调用） */
  function cleanupTree(treeId: string): void {
    cancelGrace(treeId);
    treeSubscribers.delete(treeId);
    treePresence.delete(treeId);
  }

  // ── WS 连接 ──

  // fastify-websocket 插件注入的 websocket 路由（类型定义不完整，需 as 绕过）

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
      const { conversation, session, events } = latticeAgent;

      const conn: AgentConn = {
        id: randomUUID(),
        socket,
        clientKind: 'web',
        subscribed: new Set(),
      };

      // 构建一棵树的全量快照
      const buildSnapshot = async (treeId: string): Promise<ServerMessage | null> => {
        const snapshotTakenAt = Date.now(); // 构建起始时间：异步构建期间若有新变更，客户端可据此判旧
        const tree = await session.loadTree(treeId);
        if (!tree) return null;
        const interrupted = await session.getInterruptedStreams(treeId);
        const nodes = session.getNodes(treeId);
        return {
          type: 'tree.snapshot',
          treeId,
          rev: tree.rev ?? 0,
          nodes,
          branches: tree.branches,
          headNodeId: tree.headNodeId,
          turnCapabilities: conversation.turnCapabilities(treeId),
          streaming: interrupted.map((s) => ({
            requestId: s.requestId,
            parentId: s.parentId,
            content: s.content,
          })),
          conversation: {
            treeId,
            title: tree.title,
            nodeCount: nodes.length,
            updatedAt: tree.updatedAt,
          },
          snapshotTakenAt,
          expectedNextRev: (tree.rev ?? 0) + 1,
        };
      };

      const broadcastSnapshot = (treeId: string): void => {
        void buildSnapshot(treeId).then((snap) => {
          if (snap) broadcastTree(treeId, snap);
        });
      };

      // 本 socket 进行中的请求（断开时只 abort 自己的）
      const socketRequestIds = new Set<string>();

      // hooks 工厂：controller 回调 → WS 消息 + 多端广播
      const makeHooks = (sessionId: string, trackRid: string | undefined): ConversationHooks => {
        const sourceId = conversation.getSession(sessionId)?.sourceId ?? 'qoder';
        if (trackRid) socketRequestIds.add(trackRid);
        const untrack = (): void => {
          if (trackRid) socketRequestIds.delete(trackRid);
        };
        return {
          onEvent: (event, rid) => {
            send(socket, { type: 'event', sessionId, event, requestId: rid });
            const tid = conversation.getSession(sessionId)?.treeId;
            if (tid)
              broadcastTree(
                tid,
                { type: 'stream.event', treeId: tid, requestId: rid, event },
                conn.id,
              );
          },
          onError: (message, rid) => {
            untrack();
            send(socket, { type: 'session.error', sessionId, message, requestId: rid });
            const tid = conversation.getSession(sessionId)?.treeId;
            if (tid && rid)
              broadcastTree(
                tid,
                { type: 'stream.aborted', treeId: tid, requestId: rid, reason: message },
                conn.id,
              );
          },
          onTreeUpdated: (treeId, headNodeId, rid) => {
            untrack();
            send(socket, { type: 'tree.updated', treeId, headNodeId, requestId: rid });
            broadcastSnapshot(treeId);
          },
          onTreeCreated: (treeId) =>
            send(socket, { type: 'session.created', sessionId, treeId, agentId: sourceId }),
          onReject: (rid, reason) => {
            const sess = conversation.getSession(sessionId);
            const tid = sess?.treeId ?? undefined;
            const rev = tid ? (session.getTree(tid)?.rev ?? 0) : undefined;
            send(socket, { type: 'tree.reject', treeId: tid, requestId: rid ?? '', reason, rev });
          },
          onStreamAborted: (tid, rid, reason) => {
            broadcastTree(tid, { type: 'stream.aborted', treeId: tid, requestId: rid, reason });
          },
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

      // 命令分发上下文
      const ctx: WsCommandContext = {
        socket,
        conn,
        latticeAgent,
        send: (msg: ServerMessage) => send(socket, msg),
        broadcastTree,
        broadcastPresence,
        broadcastSnapshot,
        buildSnapshot,
        makeHooks,
        unsubscribeConn,
        cancelGrace,
        treeSubscribers,
        treePresence,
        socketRequestIds,
      };

      socket.on('message', async (raw: Buffer | string | unknown[]) => {
        let parsed: unknown;
        try {
          const text = typeof raw === 'string' ? raw : Buffer.from(raw as Uint8Array).toString();
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        if (!isClientMessage(parsed)) return;
        // 命令处理异常不得击穿 message handler（单条命令失败 → 后续消息仍可处理）
        try {
          await handleWsCommand(ctx, parsed as ClientMessage);
        } catch (err) {
          req.log.error({ err, msgType: (parsed as ClientMessage).type }, 'ws command failed');
          try {
            send(socket, {
              type: 'session.error',
              sessionId: (parsed as { sessionId?: string }).sessionId ?? '',
              message: 'Internal error processing command',
            });
          } catch {
            /* send 失败忽略，避免二次崩溃 */
          }
        }
      });

      socket.on('close', () => {
        unsubPermission();
        for (const rid of socketRequestIds) conversation.abortByRequestId(rid);
        socketRequestIds.clear();
        for (const treeId of [...conn.subscribed]) unsubscribeConn(conn, treeId);
      });
      socket.on('error', () => unsubPermission());
    },
  );

  return { cleanupTree };
}
