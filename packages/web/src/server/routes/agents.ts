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
import type {
  ClientMessage,
  ServerMessage,
  PresenceState,
  ResourceListItem,
  SourceResourceInfo,
  SourceResourceQuery,
} from '@qcqx/lattice-agent-protocol';
import { isClientMessage } from '@qcqx/lattice-agent-protocol';
import {
  isAuthEnabled,
  readWebAuth,
  getSessionsCacheDir,
  readLocalConfig,
  getUsername,
  listProjects,
} from '@qcqx/lattice-core';
import { extractToken, verifyJwt } from '../auth';
import { isPathSafe, resolveFilePath } from './shared';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── 类型安全发送 ──

function send(ws: { send: (data: string) => void }, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* 连接已关闭 */
  }
}

/** 读 local config 中某源的自定义模型列表（agent.customModels.<sourceId>） */
async function readCustomModels(sourceId: string): Promise<string[]> {
  const config = (await readLocalConfig()) as Record<string, unknown> | null;
  const agentCfg = config?.agent as { customModels?: Record<string, unknown> } | undefined;
  const list = agentCfg?.customModels?.[sourceId];
  return Array.isArray(list)
    ? list.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    : [];
}

/** WebSocket 连接最小类型（传输层仅依赖这些方法，不绑定具体 ws 实现） */
interface WsSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', handler: (raw: Buffer | string | unknown[]) => void): void;
  on(event: 'close' | 'error', handler: () => void): void;
}

/** 一个 WS 连接（订阅者）：可订多棵树；一棵树可被多连接订阅 */
interface AgentConn {
  id: string;
  socket: WsSocket;
  clientKind: string;
  subscribed: Set<string>;
}

// ── 路由注册 ──

export function registerAgentRoutes(app: FastifyInstance): void {
  let agent: LatticeAgent | null = null;
  let sourcesInstance: AgentSourceInstance | null = null;

  // 多端同步：per-tree 订阅表 + presence（跨连接共享，整个路由层唯一）
  const treeSubscribers = new Map<string, Set<AgentConn>>();
  const treePresence = new Map<string, Map<string, PresenceState>>();
  // 订阅者归零后的停流宽限计时器（防重连抖动误杀在途流）
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const STREAM_GRACE_MS = 30000;

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

  /** 退订：仅移除订阅 + presence，不拆树资源（流/源会话归属树不随连接断开而中止） */
  function unsubscribeConn(conn: AgentConn, treeId: string): void {
    treeSubscribers.get(treeId)?.delete(conn);
    conn.subscribed.delete(treeId);
    if (treePresence.get(treeId)?.delete(conn.id)) broadcastPresence(treeId);
    void maybeStartGrace(treeId);
  }

  /** 订阅者归零 → 起宽限计时器；到期仍无人观看则中止该树在途流（停烧 token） */
  async function maybeStartGrace(treeId: string): Promise<void> {
    const subs = treeSubscribers.get(treeId);
    if (subs && subs.size > 0) return;
    if (graceTimers.has(treeId)) return;
    graceTimers.set(
      treeId,
      setTimeout(() => {
        graceTimers.delete(treeId);
        const s = treeSubscribers.get(treeId);
        if (s && s.size > 0) return; // 宽限期内有人重新订阅 → 不停
        const ag = agent;
        if (ag) ag.conversation.abortTreeStreams(treeId);
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
        promptDeps: {
          // 引用展开：spec 正文 / task PRD（后端安全解析路径，不接受前端传路径）；file 留 P2
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

      // 本连接（订阅者）身份
      const conn: AgentConn = {
        id: randomUUID(),
        socket,
        clientKind: 'web',
        subscribed: new Set(),
      };

      // 构建一棵树的全量快照（订阅时下发 / 提交后广播给其他订阅者）
      const buildSnapshot = async (treeId: string): Promise<ServerMessage | null> => {
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
          streaming: interrupted.map((s) => ({
            requestId: s.requestId,
            parentId: s.parentId,
            content: s.content,
          })),
          // 会话列表元数据捎带：客户端增量更新列表，免每次变更走 REST 拉列表
          conversation: {
            treeId,
            title: tree.title,
            nodeCount: nodes.length,
            updatedAt: tree.updatedAt,
          },
        };
      };

      /** 向该树全部订阅者广播当前快照（结构变更后的权威同步；客户端按 rev 守卫应用） */
      const broadcastSnapshot = (treeId: string): void => {
        void buildSnapshot(treeId).then((snap) => {
          if (snap) broadcastTree(treeId, snap);
        });
      };

      // 本 socket 进行中的请求（断开时只 abort 自己的，不影响其他 tab）
      const socketRequestIds = new Set<string>();

      // 构建单次操作的 hooks：controller 回调 → WS 消息，并跟踪请求生命周期
      // legacy 消息发给发起端（现客户端）；同时向该树其他订阅者广播新协议消息（多端同步）
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
            // 快照广播给全部订阅者（含发起端）：统一以快照为权威重建路径，
            // 不再依赖客户端 REST 重载（消除 REST/WS 双路径丢失更新竞态）
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
            // 广播给该树全部订阅者（含发起端）：撤销/删除中止了在途流
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
            // 源是第一层线程属性（session.send 携带/沿祖先链解析），这里仅作 session 默认源
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
            if (msg.sessionId) {
              const tid = conversation.getSession(msg.sessionId)?.treeId;
              conversation.abort(msg.sessionId, msg.requestId);
              // 显式停止：广播给他端立即停渲染（不等快照对齐）
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
            send(socket, { type: 'session.closed', sessionId: msg.sessionId });
            break;
          }

          case 'tree.fork': {
            if (!msg.treeId || !msg.nodeId) return;
            const branch = await conversation.fork(msg.treeId, msg.nodeId, msg.branchName);
            send(socket, { type: 'tree.updated', treeId: msg.treeId, branch });
            broadcastSnapshot(msg.treeId);
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
            broadcastSnapshot(msg.treeId);
            break;
          }

          case 'tree.merge': {
            if (!msg.treeId || !msg.branchId || !msg.targetNodeId) return;
            await session.merge(msg.treeId, msg.branchId, msg.targetNodeId, msg.mode ?? 'squash');
            send(socket, { type: 'tree.updated', treeId: msg.treeId });
            broadcastSnapshot(msg.treeId);
            break;
          }

          case 'tree.switchHead': {
            if (!msg.treeId || !msg.nodeId) return;
            await session.switchHead(msg.treeId, msg.nodeId);
            send(socket, { type: 'tree.updated', treeId: msg.treeId, headNodeId: msg.nodeId });
            broadcastSnapshot(msg.treeId);
            break;
          }

          case 'tree.setDefault': {
            if (!msg.treeId || !msg.branchId) return;
            await session.setDefaultBranch(msg.treeId, msg.branchId);
            send(socket, { type: 'tree.updated', treeId: msg.treeId });
            broadcastSnapshot(msg.treeId);
            break;
          }

          case 'permission.respond': {
            if (msg.requestId) permission.respond(msg.requestId, msg.allowed);
            break;
          }

          // ── 多端同步（per-tree 订阅） ──

          case 'tree.subscribe': {
            if (!msg.treeId) return;
            let subs = treeSubscribers.get(msg.treeId);
            if (!subs) {
              subs = new Set();
              treeSubscribers.set(msg.treeId, subs);
            }
            subs.add(conn);
            conn.subscribed.add(msg.treeId);
            cancelGrace(msg.treeId); // 有人观看 → 取消停流宽限
            if (msg.clientKind) conn.clientKind = msg.clientKind;
            const snap = await buildSnapshot(msg.treeId);
            if (snap) send(socket, snap);
            broadcastPresence(msg.treeId);
            break;
          }

          case 'tree.unsubscribe': {
            if (msg.treeId) unsubscribeConn(conn, msg.treeId);
            break;
          }

          case 'presence.update': {
            if (!msg.treeId) return;
            let pm = treePresence.get(msg.treeId);
            if (!pm) {
              pm = new Map();
              treePresence.set(msg.treeId, pm);
            }
            pm.set(conn.id, {
              connectionId: conn.id,
              clientKind: conn.clientKind,
              focusNodeId: msg.focusNodeId,
              typing: msg.typing,
            });
            broadcastPresence(msg.treeId);
            break;
          }

          case 'ping': {
            send(socket, { type: 'pong' });
            break;
          }
        }
      });

      socket.on('close', () => {
        unsubPermission();
        // 断开时 abort 该 socket 关联的进行中请求（不影响其他 tab）
        for (const rid of socketRequestIds) conversation.abortByRequestId(rid);
        socketRequestIds.clear();
        // 退出本连接订阅的全部树（仅退订 + presence，不拆树资源）
        for (const treeId of [...conn.subscribed]) unsubscribeConn(conn, treeId);
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
        modelPolicy: s.modelPolicy,
        available: s.available,
        modelCount: s.modelCount,
      })),
    };
  });

  // 获取模型列表（可按源过滤）：源提供的模型 + 用户自定义模型（仅 hybrid/open 源）
  app.get('/api/agent/models', async (req) => {
    const { sourceId } = req.query as { sourceId?: string };
    const latticeAgent = await getAgent();
    const registry = latticeAgent.sources.registry;
    const models = await registry.listModelsAsync(sourceId);
    const items = models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      sourceId: m.sourceId,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: m.capabilities, // vision 门控图片输入（能力由源提供）
      costFactor: m.costFactor,
      costLabel: m.costLabel,
      tuning: m.tuning,
    }));
    // 合并自定义模型（catalog 源不支持）；参数规格全 freeform（模型未知，由用户自行设定）
    const targetIds = sourceId ? [sourceId] : registry.listSources().map((s) => s.id);
    for (const id of targetIds) {
      const source = registry.getSource(id);
      if (!source || source.modelPolicy === 'catalog') continue;
      for (const modelId of await readCustomModels(id)) {
        if (items.some((m) => m.sourceId === id && m.id === modelId)) continue;
        items.push({
          id: modelId,
          displayName: modelId,
          sourceId: id,
          contextWindow: 0,
          maxOutputTokens: 0,
          // 自定义模型能力未知：保守关闭 vision（不开图片入口），其余按通用能力置 true
          capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
          costFactor: undefined,
          costLabel: undefined,
          custom: true,
          tuning: {
            contextWindow: { options: [], freeform: true },
            thinking: { options: ['low', 'medium', 'high'], toggleable: true, freeform: true },
          },
        } as (typeof items)[number] & { custom: boolean });
      }
    }
    return { models: items };
  });

  // 资源发现：本地（lattice 命令/skill）+ 源级（产品自带）聚合，壳层拿统一列表渲染菜单
  app.get('/api/agent/resources', async (req) => {
    const q = req.query as { sourceId?: string; cwd?: string; kinds?: string };
    const latticeAgent = await getAgent();
    const kinds = q.kinds
      ? (q.kinds.split(',').filter(Boolean) as SourceResourceQuery['kinds'])
      : undefined;
    // cwd 是客户端传入路径：必须 isPathSafe 守卫，不安全则忽略（退化为仅全局/用户级资源）
    let cwd: string | undefined;
    if (q.cwd) {
      const username = await getUsername();
      if (await isPathSafe(q.cwd, username)) cwd = q.cwd;
    }

    const resources: ResourceListItem[] = [];
    // 本地：重扫（含项目级 <cwd>/.lattice/commands）后取列表
    latticeAgent.workflow.loadLocalCommands(cwd);
    for (const r of latticeAgent.workflow.listLocalResources()) {
      if (kinds?.length && !kinds.includes(r.kind)) continue;
      resources.push({ ...r, origin: 'local' });
    }
    // 源级：registry 聚合（未实现/失败的源 = []）
    const query: SourceResourceQuery = { ...(cwd ? { cwd } : {}), ...(kinds ? { kinds } : {}) };
    const result = await latticeAgent.sources.registry.listResources(q.sourceId, query);
    if (Array.isArray(result)) {
      for (const r of result) resources.push({ ...r, origin: 'source', sourceId: q.sourceId });
    } else {
      for (const [sid, list] of Object.entries(result)) {
        for (const r of list as SourceResourceInfo[]) {
          resources.push({ ...r, origin: 'source', sourceId: sid });
        }
      }
    }
    return { resources };
  });

  // @ 文件引用搜索：在全部注册项目范围内按文件名模糊匹配（浅层遍历，上限 20 条）
  app.get('/api/agent/file-search', async (req) => {
    const { q } = req.query as { q?: string };
    const kw = (q ?? '').trim().toLowerCase();
    if (!kw) return { files: [] };

    const IGNORED = new Set([
      'node_modules',
      '.git',
      'dist',
      '.next',
      '__pycache__',
      '.pnpm-store',
      'coverage',
      'build',
    ]);
    const MAX_RESULTS = 20;
    const MAX_DEPTH = 6;
    const results: Array<{ path: string; name: string; root: string }> = [];

    const projects = listProjects(await getUsername());
    const roots: string[] = [];
    for (const p of projects) {
      try {
        const paths = JSON.parse(p.local_path) as string[];
        if (Array.isArray(paths)) roots.push(...paths.filter((x) => typeof x === 'string'));
      } catch {
        /* 脏数据跳过 */
      }
    }

    const walk = async (dir: string, root: string, depth: number): Promise<void> => {
      if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, root, depth + 1);
        } else if (entry.name.toLowerCase().includes(kw)) {
          results.push({ path: full, name: entry.name, root: relative(root, full) });
        }
      }
    };

    for (const root of roots) {
      if (results.length >= MAX_RESULTS) break;
      await walk(root, root, 0);
    }
    return { files: results };
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
      // 清理该树的同步状态（订阅/presence/宽限计时），防泄漏与悬空订阅
      cancelGrace(treeId);
      treeSubscribers.delete(treeId);
      treePresence.delete(treeId);
      return { ok: true };
    } catch (err) {
      reply.code(500);
      return { error: String(err) };
    }
  });
}
