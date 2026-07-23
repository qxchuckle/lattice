/**
 * Agent WebSocket 路由 — 前端 ↔ 后端 Agent 通信
 * 协议：
 *   client → server: session.create / session.send / session.abort / session.destroy
 *                    tree.fork / tree.delete / tree.merge / tree.switchHead
 *   server → client: session.created / event / session.error / session.closed
 *                    tree.updated / permission.request
 */
import type { FastifyInstance } from 'fastify';
import { createLatticeAgent, QoderAdapter, type LatticeAgent } from '@qcqx/lattice-agent';
import { getUsername, isAuthEnabled, readWebAuth, getSessionsCacheDir } from '@qcqx/lattice-core';
import { extractToken, verifyJwt } from '../auth';
import { readFile, appendFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

interface ClientMessage {
  type:
    | 'session.create'
    | 'session.send'
    | 'session.abort'
    | 'session.destroy'
    | 'tree.fork'
    | 'tree.delete'
    | 'tree.merge'
    | 'tree.switchHead'
    | 'tree.setDefault'
    | 'permission.respond';
  // session
  agentId?: string;
  cwd?: string;
  taskId?: string;
  sessionId?: string;
  message?: string;
  // tree
  treeId?: string;
  nodeId?: string;
  nodeIds?: string[];
  branchName?: string;
  branchId?: string;
  targetNodeId?: string;
  mode?: string;
  // permission
  requestId?: string;
  allowed?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function send(ws: { send: (data: string) => void }, payload: Record<string, unknown>) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* 连接已关闭 */
  }
}

export function registerAgentRoutes(app: FastifyInstance): void {
  // Agent 实例（懒初始化，每个 server 一个）
  let agent: LatticeAgent | null = null;
  // Qoder 适配器（默认 Agent）
  let qoder: QoderAdapter | null = null;
  // 外部 agent 会话映射: wsSessionId → qoderSessionId
  const qoderSessions = new Map<string, string>();

  function getAgent(_username: string): LatticeAgent {
    if (!agent) {
      agent = createLatticeAgent({
        storage: {
          baseDir: getSessionsCacheDir(),
        },
      });
    }
    return agent;
  }

  function getQoder(): QoderAdapter {
    if (!qoder) {
      qoder = new QoderAdapter({
        authMode: 'cli',
        permissionMode: 'acceptEdits',
      });
    }
    return qoder;
  }

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

      const username = await getUsername();
      const latticeAgent = getAgent(username);

      // 监听 Agent 事件 → 转发给前端
      const unsubPermission = latticeAgent.events.on('permission:request', (event) => {
        send(socket, { type: 'permission.request', ...event.payload });
      });

      socket.on('message', async (raw: Buffer | string | unknown[]) => {
        let msg: ClientMessage;
        try {
          const text = typeof raw === 'string' ? raw : Buffer.from(raw as Uint8Array).toString();
          msg = JSON.parse(text);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'session.create': {
            const agentId = msg.agentId ?? 'qoder';
            const cwd = msg.cwd ?? process.env.HOME ?? '/';

            let sessionId: string;
            if (agentId === 'qoder') {
              // 使用 Qoder 适配器
              sessionId = await getQoder().createSession(cwd);
              qoderSessions.set(sessionId, sessionId);
            } else {
              // 内置 Agent（Pi）
              sessionId = latticeAgent.core.createSession({
                agentId,
                cwd,
                taskId: msg.taskId,
              });
            }

            // 复用已有对话树（恢复会话）或创建新树
            let treeId = msg.treeId;
            if (!treeId || !(await latticeAgent.session.loadTree(treeId))) {
              const tree = await latticeAgent.session.createTree({ taskId: msg.taskId });
              treeId = tree.id;
            }
            send(socket, { type: 'session.created', sessionId, treeId, agentId });
            break;
          }

          case 'session.send': {
            if (!msg.sessionId || !msg.message) return;

            // 流式响应（节点持久化由前端通过 REST /api/agent/turns 完成）
            try {
              const isQoderSession = qoderSessions.has(msg.sessionId);

              if (isQoderSession) {
                // Qoder 适配器流式
                for await (const event of getQoder().send(msg.sessionId, msg.message)) {
                  send(socket, { type: 'event', sessionId: msg.sessionId, event });
                }
              } else {
                // 内置 Agent（Pi）
                for await (const event of latticeAgent.core.prompt(msg.sessionId, msg.message)) {
                  send(socket, { type: 'event', sessionId: msg.sessionId, event });
                }
              }
            } catch (err) {
              send(socket, {
                type: 'session.error',
                sessionId: msg.sessionId,
                message: err instanceof Error ? err.message : String(err),
              });
            }
            break;
          }

          case 'session.abort': {
            if (msg.sessionId) {
              if (qoderSessions.has(msg.sessionId)) {
                await getQoder().abort(msg.sessionId);
              } else {
                latticeAgent.core.abort(msg.sessionId);
              }
            }
            break;
          }

          case 'session.destroy': {
            if (msg.sessionId) {
              if (qoderSessions.has(msg.sessionId)) {
                await getQoder().destroySession(msg.sessionId);
                qoderSessions.delete(msg.sessionId);
              } else {
                latticeAgent.core.destroySession(msg.sessionId);
              }
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
              (msg.mode as 'squash' | 'cherry-pick' | 'reference') ?? 'squash',
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
              latticeAgent.permission.respond(msg.requestId, msg.allowed ?? false);
            }
            break;
          }
        }
      });

      socket.on('close', () => {
        unsubPermission();
      });
      socket.on('error', () => {
        unsubPermission();
      });
    },
  );

  // REST: 获取对话树数据
  app.get('/api/agent/tree/:treeId', async (req) => {
    const { treeId } = req.params as { treeId: string };
    const username = await getUsername();
    const latticeAgent = getAgent(username);
    const tree = await latticeAgent.session.loadTree(treeId);
    if (!tree) return { error: 'not_found' };
    const nodes = latticeAgent.session.getNodes(treeId);
    return { tree, nodes };
  });

  // REST: 恢复最新对话（turn 持久化，JSONL 文件目录形式，存缓存层）
  app.get('/api/agent/turns/latest', async () => {
    const baseDir = getSessionsCacheDir();
    try {
      const entries = await readdir(baseDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      if (dirs.length === 0) return { treeId: null, turns: [] };

      // 按 mtime 找最新会话目录
      let latest: { name: string; mtime: number } | null = null;
      for (const d of dirs) {
        const s = await stat(join(baseDir, d.name));
        if (!latest || s.mtimeMs > latest.mtime) {
          latest = { name: d.name, mtime: s.mtimeMs };
        }
      }
      if (!latest) return { treeId: null, turns: [] };

      // 读取 turns.jsonl，按 id 去重（后写覆盖）
      const turnsPath = join(baseDir, latest.name, 'turns.jsonl');
      const raw = await readFile(turnsPath, 'utf-8').catch(() => '');
      const map = new Map<string, unknown>();
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const node = JSON.parse(line) as { id: string };
          map.set(node.id, node);
        } catch {
          /* 跳过损坏行 */
        }
      }
      return { treeId: latest.name, turns: [...map.values()] };
    } catch {
      return { treeId: null, turns: [] };
    }
  });

  // REST: 持久化一个 turn 节点（append-only JSONL）
  app.post('/api/agent/turns', async (req) => {
    const { treeId, node } = req.body as { treeId?: string; node?: { id?: string } };
    if (!treeId || !node?.id) return { error: 'invalid' };
    const dir = join(getSessionsCacheDir(), treeId);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'turns.jsonl'), JSON.stringify(node) + '\n', 'utf-8');
    return { ok: true };
  });
}
