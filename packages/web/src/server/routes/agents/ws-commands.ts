/**
 * WS 命令分发 — ClientMessage switch
 *
 * 纯分发逻辑：解析消息类型 → 调用 controller/session → 回复/广播。
 * 所有状态（订阅表/presence/hooks）由 ws-handler 通过 ctx 注入。
 */
import type { LatticeAgent, ConversationHooks } from '@qcqx/lattice-agent';
import type { ClientMessage, ServerMessage, PresenceState } from '@qcqx/lattice-agent-protocol';
import { assertNever } from '@qcqx/lattice-agent-protocol';
import { clientMessageSchema } from '@qcqx/lattice-agent-protocol/schemas';
import { randomUUID } from 'node:crypto';
import type { WsSocket, AgentConn } from './shared';

/** 命令分发所需的全部上下文（由 ws-handler 构建并注入） */
export interface WsCommandContext {
  socket: WsSocket;
  conn: AgentConn;
  latticeAgent: LatticeAgent;
  send: (msg: ServerMessage) => void;
  broadcastTree: (treeId: string, msg: ServerMessage, exceptConnId?: string) => void;
  broadcastPresence: (treeId: string) => void;
  broadcastSnapshot: (treeId: string) => void;
  buildSnapshot: (treeId: string) => Promise<ServerMessage | null>;
  makeHooks: (sessionId: string, trackRid: string | undefined) => ConversationHooks;
  unsubscribeConn: (conn: AgentConn, treeId: string) => void;
  cancelGrace: (treeId: string) => void;
  treeSubscribers: Map<string, Set<AgentConn>>;
  treePresence: Map<string, Map<string, PresenceState>>;
  socketRequestIds: Set<string>;
}

// ── P1-#11: 入站参数守卫 ──────────────────────────────────
// parse, don't validate：形状/类型/长度/嵌套校验全部下沉 protocol schema（单一真相，
// 见 protocol/schemas 的 clientMessageSchema 与 WS_INBOUND_LIMITS），本文件只做入口
// safeParse（check-only：通过后继续用原对象，未知键透传）。

export async function handleWsCommand(ctx: WsCommandContext, msg: ClientMessage): Promise<void> {
  const { latticeAgent, send, broadcastTree, broadcastSnapshot, makeHooks, conn } = ctx;
  const { conversation, session, sources, permission } = latticeAgent;

  // P1-#11: 入站参数守卫（类型不符/缺必填/超长/嵌套非法均在此拒绝）
  const parsed = clientMessageSchema.safeParse(msg);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const detail = issue ? `${issue.path.join('.')}: ${issue.message}` : 'malformed message';
    send({
      type: 'session.error',
      sessionId: 'sessionId' in msg ? (msg.sessionId ?? '') : '',
      // 透传原消息 requestId（若携带），便于客户端将校验失败路由到对应 turn
      requestId: 'requestId' in msg ? (msg.requestId as string) : undefined,
      message: `Invalid parameters: ${detail}`,
    });
    return;
  }

  switch (msg.type) {
    case 'session.create': {
      const sourceId = msg.agentId ?? 'qoder';
      if (!sources.registry.getSource(sourceId)) {
        send({ type: 'session.error', sessionId: '', message: `Source not found: ${sourceId}` });
        return;
      }
      const sessionId = randomUUID();
      let treeId = msg.treeId ?? null;
      if (treeId && !(await session.loadTree(treeId))) treeId = null;
      conversation.createSession(sessionId, sourceId, treeId);
      // P1-#12 fix: 记录 session 归属，权限请求只发给持有该 session 的连接
      conn.sessions.add(sessionId);
      send({ type: 'session.created', sessionId, treeId: treeId ?? '', agentId: sourceId });
      break;
    }

    case 'session.send': {
      if (!msg.sessionId || !msg.message) return;
      // P1-#12 fix: 记录 session 归属（客户端可能 resume 已有 session）
      conn.sessions.add(msg.sessionId);
      const requestId = msg.requestId ?? randomUUID();
      conversation.send(
        msg.sessionId,
        msg.message,
        {
          parentNodeId: msg.parentNodeId,
          branchId: msg.branchId,
          segments: msg.segments,
          requestId,
          model: msg.model,
          thinkingLevel: msg.thinkingLevel,
          contextWindow: msg.contextWindow,
          sourceId: msg.sourceId,
        },
        makeHooks(msg.sessionId, requestId),
      );
      break;
    }

    case 'session.continue': {
      if (!msg.sessionId || !msg.nodeId) return;
      conn.sessions.add(msg.sessionId);
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
      conn.sessions.add(msg.sessionId);
      const requestId = msg.requestId ?? randomUUID();
      conversation.retry(msg.sessionId, msg.nodeId, requestId, makeHooks(msg.sessionId, requestId));
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
      if (msg.sessionId) {
        const tid = conversation.getSession(msg.sessionId)?.treeId;
        conversation.abort(msg.sessionId, msg.requestId);
        if (tid && msg.requestId)
          broadcastTree(tid, {
            type: 'stream.aborted',
            treeId: tid,
            requestId: msg.requestId,
            reason: 'aborted',
          });
      }
      break;
    }

    case 'session.destroy': {
      if (msg.sessionId) await conversation.destroySession(msg.sessionId);
      send({ type: 'session.closed', sessionId: msg.sessionId });
      break;
    }

    case 'tree.fork': {
      if (!msg.treeId || !msg.nodeId) return;
      const outcome = await conversation.fork(msg.treeId, msg.nodeId, msg.branchName);
      // 铁律：不静默降级——源侧 fork 失败时新分支无历史上下文，必须告知发起端
      if (outcome?.notice) {
        send({ type: 'tree.error', treeId: msg.treeId, message: outcome.notice });
      }
      send({ type: 'tree.updated', treeId: msg.treeId });
      broadcastSnapshot(msg.treeId);
      break;
    }

    case 'tree.delete': {
      if (!msg.treeId || !msg.nodeIds?.length) return;
      if (!session.canBatchDelete(msg.treeId, msg.nodeIds)) {
        send({ type: 'tree.error', treeId: msg.treeId, message: '不满足删除条件' });
        return;
      }
      await session.deleteNodes(msg.treeId, msg.nodeIds);
      send({
        type: 'tree.updated',
        treeId: msg.treeId,
        headNodeId: session.getTree(msg.treeId)?.headNodeId,
      });
      broadcastSnapshot(msg.treeId);
      break;
    }

    case 'tree.merge': {
      if (!msg.treeId || !msg.branchId || !msg.targetNodeId) return;
      await session.merge(msg.treeId, msg.branchId, msg.targetNodeId, msg.mode ?? 'squash');
      send({ type: 'tree.updated', treeId: msg.treeId });
      broadcastSnapshot(msg.treeId);
      break;
    }

    case 'tree.switchHead': {
      if (!msg.treeId || !msg.nodeId) return;
      await session.switchHead(msg.treeId, msg.nodeId);
      send({ type: 'tree.updated', treeId: msg.treeId, headNodeId: msg.nodeId });
      broadcastSnapshot(msg.treeId);
      break;
    }

    case 'tree.setDefault': {
      if (!msg.treeId || !msg.branchId) return;
      await session.setDefaultBranch(msg.treeId, msg.branchId);
      send({ type: 'tree.updated', treeId: msg.treeId });
      broadcastSnapshot(msg.treeId);
      break;
    }

    case 'permission.respond': {
      if (!msg.requestId) break;
      // P1-#12: 校验权限请求归属——只允许持有对应 requestId 的连接应答
      if (!conn.pendingPermissions.has(msg.requestId)) {
        send({
          type: 'session.error',
          sessionId: '',
          message: 'Unauthorized permission response',
        });
        break;
      }
      conn.pendingPermissions.delete(msg.requestId);
      // 清除 TTL 定时器（已应答，不再过期）
      const timer = conn.permissionTimers.get(msg.requestId);
      if (timer) {
        clearTimeout(timer);
        conn.permissionTimers.delete(msg.requestId);
      }
      permission.respond(msg.requestId, msg.allowed);
      break;
    }

    // ── 多端同步（per-tree 订阅） ──

    case 'tree.subscribe': {
      if (!msg.treeId) return;
      let subs = ctx.treeSubscribers.get(msg.treeId);
      if (!subs) {
        subs = new Set();
        ctx.treeSubscribers.set(msg.treeId, subs);
      }
      subs.add(conn);
      conn.subscribed.add(msg.treeId);
      ctx.cancelGrace(msg.treeId);
      if (msg.clientKind) conn.clientKind = msg.clientKind;
      const snap = await ctx.buildSnapshot(msg.treeId);
      if (snap) send(snap);
      ctx.broadcastPresence(msg.treeId);
      break;
    }

    case 'tree.unsubscribe': {
      if (msg.treeId) ctx.unsubscribeConn(conn, msg.treeId);
      break;
    }

    case 'presence.update': {
      if (!msg.treeId) return;
      let pm = ctx.treePresence.get(msg.treeId);
      if (!pm) {
        pm = new Map();
        ctx.treePresence.set(msg.treeId, pm);
      }
      pm.set(conn.id, {
        connectionId: conn.id,
        clientKind: conn.clientKind,
        focusNodeId: msg.focusNodeId,
        typing: msg.typing,
      });
      ctx.broadcastPresence(msg.treeId);
      break;
    }

    case 'ping': {
      send({ type: 'pong' });
      break;
    }

    default:
      // exhaustiveness 兜底：ClientMessage 新增变体而本 switch 未补 → 编译报错
      assertNever(msg);
  }
}
