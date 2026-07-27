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
  ConversationBranch,
} from '@qcqx/lattice-agent-protocol';
import { isClientMessage } from '@qcqx/lattice-agent-protocol';
import { getUsername, isAuthEnabled, readWebAuth, getSessionsCacheDir } from '@qcqx/lattice-core';
import { extractToken, verifyJwt } from '../auth';
import { randomUUID } from 'node:crypto';
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
  const sessionSendQueue = new Map<string, Promise<void>>(); // sessionId → 串行锁（防止并行 send）

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
  // session.send 核心逻辑（由串行锁调度）
  // ═══════════════════════════════════════════

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleSessionSend(
    socket: any,
    msg: Extract<ClientMessage, { type: 'session.send' }>,
    latticeAgent: LatticeAgent,
    socketRequestIds: Set<string>,
  ): Promise<void> {
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

    // ══ 解析实际父节点 + 自动 fork ══
    const treeId = sessionTreeMap.get(msg.sessionId);
    const tree = treeId ? latticeAgent.session.getTree(treeId) : undefined;

    // 解析新节点要挂的实际父节点（链接：若 parentNodeId 是 user 节点，找到它的 assistant 子节点）
    let actualParentId: string | null = null;
    if (treeId && msg.parentNodeId) {
      const nodes = latticeAgent.session.getNodes(treeId);
      const assistantChild = nodes.find(
        (n) => n.parentId === msg.parentNodeId && n.role === 'assistant',
      );
      actualParentId = assistantChild?.id ?? msg.parentNodeId;
    }

    // 定位分支：优先用客户端显式指定的 branchId，否则从父节点解析
    const actualParent =
      treeId && actualParentId ? latticeAgent.session.getNode(treeId, actualParentId) : undefined;
    const resolvedBranchId =
      msg.branchId ??
      actualParent?.branchId ??
      (treeId && msg.parentNodeId
        ? latticeAgent.session.getNode(treeId, msg.parentNodeId)?.branchId
        : undefined);
    let branch = tree?.branches.find((b) => b.id === (resolvedBranchId ?? tree?.defaultBranchId));
    let sourceSessionId = branch?.sourceSessionId ?? null;

    // 自动 fork 检测：未显式指定分支 + 实际父节点已有 user 子节点 + 不是 retry → 兄弟分支
    let autoForked = false;
    if (tree && actualParent && !msg.branchId && !msg.retry && sourceSessionId) {
      const hasUserChild = latticeAgent.session
        .getNodes(tree.id)
        .some((n) => n.parentId === actualParent.id && n.role === 'user');
      if (hasUserChild) {
        const sourceId = sessionSourceMap.get(msg.sessionId);
        const source = sourceId ? latticeAgent.sources.registry.getSource(sourceId) : undefined;
        if (source) {
          const atMessage = (actualParent.metadata as Record<string, unknown>)?.sourceMessageId as
            | string
            | undefined;
          let newBranch: ConversationBranch | undefined;
          try {
            newBranch = await latticeAgent.session.fork(tree.id, actualParent.id);
            const forkedSessionId = await source.forkSession(sourceSessionId, atMessage);
            await latticeAgent.session.setBranchSession(tree.id, newBranch.id, forkedSessionId);
            branch = newBranch;
            sourceSessionId = forkedSessionId;
            autoForked = true;
          } catch {
            // fork 失败：清理可能已创建的孤儿分支，继续使用原 session
            if (newBranch) {
              await latticeAgent.session.removeBranch(tree.id, newBranch.id).catch(() => {});
            }
          }
        }
      }
    }

    const requestId = msg.requestId;
    if (requestId) socketRequestIds.add(requestId);

    // ══ 持久化 user 节点（prompt 前，确保用户消息永不丢失） ══
    let userNode: { id: string } | undefined;
    if (treeId) {
      const t = latticeAgent.session.getTree(treeId);

      if (t && !t.title) {
        t.title = msg.message.slice(0, 30) + (msg.message.length > 30 ? '...' : '');
      }

      // 重试：删除旧 assistant 子节点
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

      userNode =
        retryUserNode ??
        (await latticeAgent.session.addNode(treeId, {
          id: requestId,
          parentId: actualParentId,
          role: 'user',
          content: [{ type: 'text', text: msg.message }],
          branchId: autoForked || msg.branchId ? branch?.id : undefined,
        }));
    }

    // ══ 流式响应 + 每 delta 写入 streaming 文件（对齐 Claude Code） ══
    const collectedEvents: SourceEvent[] = [];
    const abortController = new AbortController();
    if (requestId) requestAbortMap.set(requestId, abortController);

    // 增量维护 content（O(1) 每个 delta，避免 buildPersistData 的 O(n) 重建）
    const runningContent: NodeContent[] = [];
    const streamStartedAt = Date.now();

    const persistStreaming = async () => {
      if (!treeId || !requestId || !userNode) return;
      await latticeAgent.session.writeStreaming(treeId, {
        requestId,
        parentId: userNode.id,
        role: 'assistant',
        startedAt: streamStartedAt,
        content: runningContent,
      });
    };

    try {
      for await (const event of source.prompt(
        sourceSessionId,
        [{ type: 'text', text: msg.message }],
        { signal: abortController.signal },
      )) {
        collectedEvents.push(event);

        // 增量更新 runningContent
        switch (event.type) {
          case 'text': {
            const last = runningContent[runningContent.length - 1];
            if (last && last.type === 'text') last.text += event.content;
            else runningContent.push({ type: 'text', text: event.content });
            break;
          }
          case 'thinking': {
            const last = runningContent[runningContent.length - 1];
            if (last && last.type === 'thinking') last.text += event.content;
            else runningContent.push({ type: 'thinking', text: event.content });
            break;
          }
          case 'tool_call':
            runningContent.push({
              type: 'tool_call',
              toolId: event.id,
              name: event.name,
              args: event.args,
              status: 'pending',
            });
            break;
          case 'tool_result': {
            const tc = runningContent.find((c) => c.type === 'tool_call' && c.toolId === event.id);
            if (tc && tc.type === 'tool_call') tc.status = event.isError ? 'error' : 'success';
            runningContent.push({
              type: 'tool_result',
              toolId: event.id,
              name: event.name,
              result: event.result,
              isError: event.isError,
            });
            break;
          }
          case 'file_edit':
            runningContent.push({ type: 'diff', text: event.diff, path: event.path });
            break;
          case 'terminal':
            runningContent.push({ type: 'terminal', command: event.command, output: event.output });
            break;
          case 'error':
            runningContent.push({
              type: 'error',
              message: event.message,
              suggestion: event.suggestion,
            });
            break;
          case 'done':
            break;
        }

        // 每个 delta 写入 streaming 文件（崩溃时最多丢 1 个 delta）
        await persistStreaming();
        send(socket, { type: 'event', sessionId: msg.sessionId, event, requestId });
      }
    } catch (err) {
      // 异常中断 → streaming 文件已包含到最后一个 delta 的内容
      await persistStreaming();
      send(socket, {
        type: 'session.error',
        sessionId: msg.sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (requestId) {
        requestAbortMap.delete(requestId);
        socketRequestIds.delete(requestId);
      }
    }

    // ══ 流结束 → 持久化 assistant 节点 ══
    // 判定是否中断：未收到 done 事件 = 被 abort（手动停止 / 关闭页面 / 崩溃）
    const doneEvent = collectedEvents.find((e) => e.type === 'done');
    const wasInterrupted = abortController.signal.aborted || !doneEvent;

    // 从 done 事件捕获源 sessionId（新建时源返回，续写时不变）并持久化
    if (doneEvent && 'sessionId' in doneEvent && doneEvent.sessionId && branch && treeId) {
      if (branch.sourceSessionId !== doneEvent.sessionId) {
        await latticeAgent.session.setBranchSession(treeId, branch.id, doneEvent.sessionId);
      }
      branch.sourceSessionId = doneEvent.sessionId;
    }

    if (treeId) {
      if (collectedEvents.length > 0) {
        const data = buildPersistData(collectedEvents, sourceId ?? 'unknown');
        const assistantNode = await latticeAgent.session.addNode(treeId, {
          parentId: userNode!.id,
          role: 'assistant',
          content: data.content,
          agentId: data.agentId,
          metadata: {
            ...data.metadata,
            ...(wasInterrupted ? { interrupted: true } : {}),
            // 持久化源消息 ID（fork 时需要传给源）
            ...(doneEvent && 'sourceMessageId' in doneEvent && doneEvent.sourceMessageId
              ? { sourceMessageId: doneEvent.sourceMessageId }
              : {}),
          },
        });
        // 只有正常完成才清理 streaming 文件（中断时保留，供崩溃恢复用）
        if (!wasInterrupted && requestId) {
          await latticeAgent.session.clearStreaming(treeId, requestId);
        }
        send(socket, { type: 'tree.updated', treeId, headNodeId: assistantNode.id, requestId });
      } else {
        if (!wasInterrupted && requestId) {
          await latticeAgent.session.clearStreaming(treeId, requestId);
        }
        send(socket, { type: 'tree.updated', treeId, headNodeId: userNode?.id ?? null, requestId });
      }
    }
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

      // 跟踪该 socket 关联的进行中请求（断开时只 abort 自己的）
      const socketRequestIds = new Set<string>();

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
            const source = latticeAgent.sources.registry.getSource(sourceId);
            if (!source) {
              send(socket, {
                type: 'session.error',
                sessionId: '',
                message: `Source not found: ${sourceId}`,
              });
              return;
            }

            // 生成客户端 session ID（源 session 在第一次 prompt 时懒创建）
            const sessionId = randomUUID();
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

            // 串行锁：同一 session 的 send 顺序执行，避免并行导致 tree 结构异常
            const sessionId = msg.sessionId;
            const prevSend = sessionSendQueue.get(sessionId) ?? Promise.resolve();
            const sendDone = prevSend.then(() =>
              handleSessionSend(socket, msg, latticeAgent, socketRequestIds),
            );
            const caught = sendDone.catch(() => {});
            sessionSendQueue.set(sessionId, caught);
            caught.finally(() => {
              // 队列尾部清理：如果当前仍是队列末尾，删除条目避免内存泄漏
              if (sessionSendQueue.get(sessionId) === caught) {
                sessionSendQueue.delete(sessionId);
              }
            });
            break;
          }

          case 'session.abort': {
            if (msg.sessionId) {
              if (msg.requestId && requestAbortMap.has(msg.requestId)) {
                // 精确中止单个请求
                requestAbortMap.get(msg.requestId)!.abort();
                requestAbortMap.delete(msg.requestId);
              } else {
                // 中止整个 session：精确 abort 该会话各分支的源 session
                const sourceId = sessionSourceMap.get(msg.sessionId);
                const source = sourceId
                  ? latticeAgent.sources.registry.getSource(sourceId)
                  : undefined;
                const abortTreeId = sessionTreeMap.get(msg.sessionId);
                const abortTree = abortTreeId
                  ? latticeAgent.session.getTree(abortTreeId)
                  : undefined;
                for (const b of abortTree?.branches ?? []) {
                  if (b.sourceSessionId) source?.abort(b.sourceSessionId);
                }
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
              // 清理关联的 streaming 文件（避免误判为中断）
              const treeIdForCleanup = sessionTreeMap.get(msg.sessionId);
              if (treeIdForCleanup) {
                const interrupted =
                  await latticeAgent.session.getInterruptedStreams(treeIdForCleanup);
                for (const s of interrupted) {
                  await latticeAgent.session.clearStreaming(treeIdForCleanup, s.requestId);
                }
              }
              // 清理 source session
              // （源内部自管历史，server 不需要清理映射）
              sessionSourceMap.delete(msg.sessionId);
              sessionTreeMap.delete(msg.sessionId);
              sessionSendQueue.delete(msg.sessionId);
            }
            send(socket, { type: 'session.closed', sessionId: msg.sessionId });
            break;
          }

          case 'tree.fork': {
            if (!msg.treeId || !msg.nodeId) return;
            const branch = await latticeAgent.session.fork(msg.treeId, msg.nodeId, msg.branchName);

            // 源级别 fork：新分支获得独立的源 session（截断到 fork 点）
            if (branch) {
              // 找到对应的源（通过 treeId 反查 sessionId → sourceId）
              let sourceId: string | undefined;
              for (const [sid, tid] of sessionTreeMap) {
                if (tid === msg.treeId) {
                  sourceId = sessionSourceMap.get(sid);
                  break;
                }
              }
              const source = sourceId
                ? latticeAgent.sources.registry.getSource(sourceId)
                : undefined;
              const tree = latticeAgent.session.getTree(msg.treeId);
              const forkNode = latticeAgent.session.getNode(msg.treeId, msg.nodeId);
              const parentBranch = tree?.branches.find((b) => b.id === forkNode?.branchId);
              const parentSessionId = parentBranch?.sourceSessionId;
              const atMessage = (forkNode?.metadata as Record<string, unknown>)?.sourceMessageId as
                | string
                | undefined;

              if (source && parentSessionId) {
                try {
                  const forkedSessionId = await source.forkSession(parentSessionId, atMessage);
                  await latticeAgent.session.setBranchSession(
                    msg.treeId,
                    branch.id,
                    forkedSessionId,
                  );
                } catch {
                  /* fork 失败时新分支从空白开始 */
                }
              }
            }

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

      socket.on('close', () => {
        unsubPermission();
        // 断开时 abort 该 socket 关联的进行中请求（不影响其他 tab）
        for (const rid of socketRequestIds) {
          const ctrl = requestAbortMap.get(rid);
          if (ctrl) {
            ctrl.abort();
            requestAbortMap.delete(rid);
          }
        }
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
    // 检测中断的 streaming（上次未完成的回复）
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
