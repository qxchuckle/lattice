/**
 * Agent WebSocket + REST 路由 — protocol-first 类型安全实现
 *
 * WS 协议（全部使用 @qcqx/lattice-agent-protocol 类型）：
 *   ClientMessage: session.create / session.send / session.abort / session.destroy
 *                  tree.fork / tree.delete / tree.merge / tree.switchHead / tree.setDefault
 *                  permission.respond
 *   ServerMessage: session.created / event / session.error / session.closed
 *                  tree.updated / tree.error / permission.request
 *
 * REST：
 *   GET /api/agent/sources       → GetSourcesResponse
 *   GET /api/agent/models        → GetModelsResponse
 *   GET /api/agent/tree/:treeId  → GetTreeResponse | GetTreeNotFoundResponse
 */
import type { FastifyInstance } from 'fastify';
import {
  createLatticeAgent,
  createAgentSource,
  PiSource,
  QoderSource,
  type LatticeAgent,
  type AgentSourceInstance,
} from '@qcqx/lattice-agent';
import type {
  ClientMessage,
  ServerMessage,
  SourceEvent,
  NodeContent,
  TokenUsage,
  ToolCallRecord,
  FileChange,
} from '@qcqx/lattice-agent-protocol';
import { isClientMessage } from '@qcqx/lattice-agent-protocol';
import { getUsername, isAuthEnabled, readWebAuth, getSessionsCacheDir } from '@qcqx/lattice-core';
import { extractToken, verifyJwt } from '../auth';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── 类型安全发送 ──

function send(ws: { send: (data: string) => void }, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* 连接已关闭 */
  }
}

// ── 流式事件 → 持久化数据构建 ──

function buildPersistData(events: SourceEvent[], agentId: string) {
  const content: NodeContent[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const fileChanges: FileChange[] = [];
  let usage: TokenUsage | undefined;

  for (const evt of events) {
    switch (evt.type) {
      case 'text':
        // 合并连续 text
        if (content.length > 0 && content[content.length - 1].type === 'text') {
          (content[content.length - 1] as { type: 'text'; text: string }).text += evt.content;
        } else {
          content.push({ type: 'text', text: evt.content });
        }
        break;
      case 'thinking':
        if (content.length > 0 && content[content.length - 1].type === 'thinking') {
          (content[content.length - 1] as { type: 'thinking'; text: string }).text += evt.content;
        } else {
          content.push({ type: 'thinking', text: evt.content });
        }
        break;
      case 'tool_call':
        content.push({
          type: 'tool_call',
          toolId: evt.id,
          name: evt.name,
          args: evt.args,
          status: 'pending',
        });
        toolCalls.push({
          toolId: evt.id,
          args: evt.args,
          status: 'pending',
          startedAt: Date.now(),
        });
        break;
      case 'tool_result': {
        // 更新对应 tool_call 的状态
        const tc = content.find((c) => c.type === 'tool_call' && c.toolId === evt.id);
        if (tc && tc.type === 'tool_call') tc.status = evt.isError ? 'error' : 'success';
        content.push({
          type: 'tool_result',
          toolId: evt.id,
          name: evt.name,
          result: evt.result,
          isError: evt.isError,
        });
        const rec = toolCalls.find((t) => t.toolId === evt.id);
        if (rec) {
          rec.result = evt.result;
          rec.status = evt.isError ? 'error' : 'success';
          rec.endedAt = Date.now();
        }
        break;
      }
      case 'file_edit':
        content.push({ type: 'diff', text: evt.diff, path: evt.path });
        fileChanges.push({ path: evt.path, diff: evt.diff, status: 'pending' });
        break;
      case 'terminal':
        content.push({ type: 'terminal', command: evt.command, output: evt.output });
        break;
      case 'done':
        usage = evt.usage;
        break;
      case 'error':
        content.push({ type: 'error', message: evt.message, suggestion: evt.suggestion });
        break;
    }
  }

  if (content.length === 0) content.push({ type: 'text', text: '' });

  return {
    content,
    agentId,
    metadata: {
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(fileChanges.length > 0 ? { fileChanges } : {}),
      ...(usage ? { usage } : {}),
    },
  };
}

// ── 路由注册 ──

export function registerAgentRoutes(app: FastifyInstance): void {
  let agent: LatticeAgent | null = null;
  let sourcesInstance: AgentSourceInstance | null = null;
  const sessionSourceMap = new Map<string, string>();
  const sessionTreeMap = new Map<string, string>(); // sessionId → treeId
  const requestAbortMap = new Map<string, AbortController>(); // requestId → AbortController
  const branchSessionMap = new Map<string, string>(); // branchKey → source sessionId
  const nodeBranchMap = new Map<string, string>(); // persisted nodeId → branchKey

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get(
    '/api/agent/ws',
    { websocket: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (socket: any, req: any) => {
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

      // 权限事件转发
      const unsubPermission = latticeAgent.events.on('permission:request', (event) => {
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

        // 类型守卫校验
        if (!isClientMessage(parsed)) return;
        const msg: ClientMessage = parsed;

        switch (msg.type) {
          case 'session.create': {
            const sourceId = msg.agentId ?? 'qoder';
            const cwd = msg.cwd ?? process.env.HOME ?? '/';
            const source = latticeAgent.sources.registry.getSource(sourceId);
            if (!source) {
              send(socket, {
                type: 'session.error',
                sessionId: '',
                message: `Source not found: ${sourceId}`,
              });
              return;
            }

            const sessionId = await source.createSession({ model: 'auto', cwd });
            sessionSourceMap.set(sessionId, sourceId);

            // 复用已有树（切换历史）或不创建（新对话等第一条消息时懒创建）
            let treeId = msg.treeId ?? null;
            if (treeId && !(await latticeAgent.session.loadTree(treeId))) {
              treeId = null; // 指定的树不存在，回退为懒创建
            }
            if (treeId) sessionTreeMap.set(sessionId, treeId);
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
            const sourceId = sessionSourceMap.get(msg.sessionId);
            const source = sourceId ? latticeAgent.sources.registry.getSource(sourceId) : undefined;
            if (!source) {
              send(socket, {
                type: 'session.error',
                sessionId: msg.sessionId,
                message: 'Session source not found',
              });
              return;
            }

            // 懒创建对话树（第一条消息时才创建，避免空历史）
            if (!sessionTreeMap.has(msg.sessionId)) {
              const tree = await latticeAgent.session.createTree({});
              sessionTreeMap.set(msg.sessionId, tree.id);
              send(socket, {
                type: 'session.created',
                sessionId: msg.sessionId,
                treeId: tree.id,
                agentId: sourceId ?? 'qoder',
              });
            }

            // 计算分支标识（branchKey）
            const treeIdForContext = sessionTreeMap.get(msg.sessionId);
            let branchKey = msg.requestId ?? `root-${Date.now()}`;

            if (treeIdForContext && msg.parentNodeId) {
              const nodes = latticeAgent.session.getNodes(treeIdForContext);
              let cursor: string | null = msg.parentNodeId;
              let rootAncestor = msg.parentNodeId;
              while (cursor) {
                const node = nodes.find((n) => n.id === cursor);
                if (!node) break;
                rootAncestor = node.id;
                cursor = node.parentId;
              }
              branchKey = nodeBranchMap.get(rootAncestor) ?? rootAncestor;
            }

            // 分支 session 管理：同分支复用，新分支创建（带历史）
            let sourceSessionId = branchSessionMap.get(branchKey);
            if (!sourceSessionId || !source.isSessionAlive(sourceSessionId)) {
              const newId = await source.createSession({
                model: 'auto',
                cwd: process.env.HOME ?? '/',
              });
              branchSessionMap.set(branchKey, newId);
              sourceSessionId = newId;
            }

            // 流式响应
            const collectedEvents: SourceEvent[] = [];
            const requestId = msg.requestId;
            const abortController = new AbortController();
            if (requestId) requestAbortMap.set(requestId, abortController);

            try {
              for await (const event of source.prompt(
                sourceSessionId,
                [{ type: 'text', text: msg.message }],
                {
                  signal: abortController.signal,
                },
              )) {
                collectedEvents.push(event);
                send(socket, { type: 'event', sessionId: msg.sessionId, event, requestId });
              }
            } catch (err) {
              send(socket, {
                type: 'session.error',
                sessionId: msg.sessionId,
                message: err instanceof Error ? err.message : String(err),
              });
            } finally {
              if (requestId) requestAbortMap.delete(requestId);
            }

            // 流结束 → server 持久化 user + assistant 节点
            const treeId = sessionTreeMap.get(msg.sessionId);
            if (treeId) {
              const tree = latticeAgent.session.getTree(treeId);

              // 确定 parentId：从 client 指定的父节点推导
              // parentNodeId = null → 根级节点（兄弟）
              // parentNodeId = userNodeId → 找该 user 的 assistant 子节点作为 parent
              let parentId: string | null = null;
              if (msg.parentNodeId) {
                const nodes = latticeAgent.session.getNodes(treeId);
                const assistantChild = nodes?.find(
                  (n) => n.parentId === msg.parentNodeId && n.role === 'assistant',
                );
                parentId = assistantChild?.id ?? msg.parentNodeId;
              }

              // 自动生成会话标题（首次消息的前 30 字）
              if (tree && !tree.title) {
                tree.title = msg.message.slice(0, 30) + (msg.message.length > 30 ? '...' : '');
              }

              // 重试：按 retryNodeId 直接定位，删除其 assistant 子节点
              let retryUserNode: { id: string } | undefined;
              if (msg.retry && msg.retryNodeId) {
                const nodes = latticeAgent.session.getNodes(treeId);
                retryUserNode = nodes.find((n) => n.id === msg.retryNodeId);
                if (retryUserNode) {
                  const oldAssistant = nodes.find(
                    (n) => n.parentId === retryUserNode!.id && n.role === 'assistant',
                  );
                  if (oldAssistant) {
                    await latticeAgent.session.deleteNodes(treeId, [oldAssistant.id]);
                  }
                }
              }

              // 持久化 user 节点（用 client 的 requestId 作为节点 ID，全栈统一）
              const userNode =
                retryUserNode ??
                (await latticeAgent.session.addNode(treeId, {
                  id: requestId,
                  parentId,
                  role: 'user',
                  content: [{ type: 'text', text: msg.message }],
                }));
              if (!retryUserNode) {
                nodeBranchMap.set(userNode.id, branchKey);
              }

              // 持久化 assistant 节点
              if (collectedEvents.length > 0) {
                const data = buildPersistData(collectedEvents, sourceId ?? 'unknown');
                const assistantNode = await latticeAgent.session.addNode(treeId, {
                  parentId: userNode.id,
                  role: 'assistant',
                  content: data.content,
                  agentId: data.agentId,
                  metadata: data.metadata,
                });
                send(socket, {
                  type: 'tree.updated',
                  treeId,
                  headNodeId: assistantNode.id,
                  requestId,
                });
              } else {
                send(socket, { type: 'tree.updated', treeId, headNodeId: userNode.id, requestId });
              }
            }
            break;
          }

          case 'session.abort': {
            if (msg.sessionId) {
              if (msg.requestId && requestAbortMap.has(msg.requestId)) {
                // 精确中止单个请求
                requestAbortMap.get(msg.requestId)!.abort();
                requestAbortMap.delete(msg.requestId);
              } else {
                // 中止整个 session
                const sourceId = sessionSourceMap.get(msg.sessionId);
                const source = sourceId
                  ? latticeAgent.sources.registry.getSource(sourceId)
                  : undefined;
                source?.abort(msg.sessionId);
              }
            }
            break;
          }

          case 'session.destroy': {
            if (msg.sessionId) {
              const sourceId = sessionSourceMap.get(msg.sessionId);
              const source = sourceId
                ? latticeAgent.sources.registry.getSource(sourceId)
                : undefined;
              await source?.destroySession(msg.sessionId);
              sessionSourceMap.delete(msg.sessionId);
              sessionTreeMap.delete(msg.sessionId);
            }
            send(socket, { type: 'session.closed', sessionId: msg.sessionId });
            break;
          }

          case 'tree.fork': {
            if (!msg.treeId || !msg.nodeId) return;
            const branch = await latticeAgent.session.fork(msg.treeId, msg.nodeId, msg.branchName);
            send(socket, { type: 'tree.updated', treeId: msg.treeId, branch });
            break;
          }

          case 'tree.delete': {
            if (!msg.treeId || !msg.nodeIds?.length) return;
            if (!latticeAgent.session.canBatchDelete(msg.treeId, msg.nodeIds)) {
              send(socket, { type: 'tree.error', treeId: msg.treeId, message: '不满足删除条件' });
              return;
            }
            await latticeAgent.session.deleteNodes(msg.treeId, msg.nodeIds);
            send(socket, {
              type: 'tree.updated',
              treeId: msg.treeId,
              headNodeId: latticeAgent.session.getTree(msg.treeId)?.headNodeId,
            });
            break;
          }

          case 'tree.merge': {
            if (!msg.treeId || !msg.branchId || !msg.targetNodeId) return;
            await latticeAgent.session.merge(
              msg.treeId,
              msg.branchId,
              msg.targetNodeId,
              msg.mode ?? 'squash',
            );
            send(socket, { type: 'tree.updated', treeId: msg.treeId });
            break;
          }

          case 'tree.switchHead': {
            if (!msg.treeId || !msg.nodeId) return;
            await latticeAgent.session.switchHead(msg.treeId, msg.nodeId);
            send(socket, { type: 'tree.updated', treeId: msg.treeId, headNodeId: msg.nodeId });
            break;
          }

          case 'tree.setDefault': {
            if (!msg.treeId || !msg.branchId) return;
            await latticeAgent.session.setDefaultBranch(msg.treeId, msg.branchId);
            send(socket, { type: 'tree.updated', treeId: msg.treeId });
            break;
          }

          case 'permission.respond': {
            if (msg.requestId) {
              latticeAgent.permission.respond(msg.requestId, msg.allowed);
            }
            break;
          }
        }
      });

      socket.on('close', () => unsubPermission());
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

  // 获取对话树
  app.get('/api/agent/tree/:treeId', async (req) => {
    const { treeId } = req.params as { treeId: string };
    const latticeAgent = await getAgent();
    const tree = await latticeAgent.session.loadTree(treeId);
    if (!tree) return { error: 'not_found' as const };
    const nodes = latticeAgent.session.getNodes(treeId);
    return { tree, nodes };
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
    const baseDir = getSessionsCacheDir();
    const dir = join(baseDir, treeId);
    try {
      await rm(dir, { recursive: true, force: true });
      // 同时清理索引文件
      try {
        const raw = await readFile(join(baseDir, 'index.json'), 'utf-8');
        const index = JSON.parse(raw) as { sessions?: { treeId: string }[] };
        if (index.sessions) {
          index.sessions = index.sessions.filter((s) => s.treeId !== treeId);
          await writeFile(join(baseDir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
        }
      } catch {
        /* 索引不存在则跳过 */
      }
      return { ok: true };
    } catch (err) {
      reply.code(500);
      return { error: String(err) };
    }
  });
}
