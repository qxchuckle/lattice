/**
 * WebSocket 连接管理 + SourceEvent 流式处理
 */
import type { SourceEvent, ServerMessage } from '@qcqx/lattice-agent-protocol';
import { applyEventToContent } from '@qcqx/lattice-agent-protocol';
import { authStore } from '../../store';
import { agentStore } from './store';
import { loadTree, loadConversations } from './api';

// ── 流式状态（按 requestId 路由，支持并行） ──

const streamingMap = new Map<string, string>(); // requestId → turnId
/**
 * 本客户端发起的「仅内容」请求（send/continue）：其结果已由流式事件实时更新，
 * tree.updated 可跳过整树重载。结构性操作（retry 会标记后代 undone）不在此列，必须重载。
 */
const selfRequestIds = new Set<string>();

/**
 * 设置流式路由目标。
 * @param contentOnly true=仅目标 turn 内容变化（send/continue），完成后可跳过重载；
 *                    false=结构性变化（retry 影响后代），完成后必须重载。
 */
export function setStreamingTarget(
  turnId: string | null,
  requestId?: string,
  contentOnly = true,
): void {
  if (!requestId) return;
  if (turnId) {
    streamingMap.set(requestId, turnId);
    if (contentOnly) selfRequestIds.add(requestId);
  } else {
    streamingMap.delete(requestId);
  }
}

/**
 * 消费“本客户端发起的请求”标记：
 * 返回 true 表示该 tree.updated 对应的流式已由事件更新完毕，可跳过整树重载
 */
function consumeSelfRequest(requestId?: string): boolean {
  if (!requestId) return false;
  return selfRequestIds.delete(requestId);
}

// ── SourceEvent → TurnNode.blocks（与 server 共用 applyEventToContent） ──

export function handleSourceEvent(event: SourceEvent, requestId?: string): void {
  const turnId = requestId ? streamingMap.get(requestId) : undefined;
  if (!turnId) return;
  const turn = agentStore.turns.get(turnId);
  if (!turn) return;

  // 内容累积：直接作用于 valtio proxy 数组（响应式），转换逻辑与 server 唯一实现一致
  applyEventToContent(turn.blocks, event);

  // 仅终态（done/error）才 bump version 触发画布结构/边刷新；
  // 内容 delta 不 bump——节点内容经 valtio 响应式更新，避免每个 delta 重建整画布
  if (event.type === 'done') {
    turn.status = 'done';
    turn.usage = event.usage;
    if (requestId) streamingMap.delete(requestId);
    agentStore.version++;
  } else if (event.type === 'error') {
    turn.status = 'error';
    if (requestId) streamingMap.delete(requestId);
    agentStore.version++;
  }
}

// ── WebSocket ──

let ws: WebSocket | null = null;

/** 底层发送（供 actions 使用） */
export function sendWs(payload: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function isWsReady(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN && !!agentStore.sessionId;
}

export function connectAgentWs(): void {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = authStore.token ? `?token=${authStore.token}` : '';
  ws = new WebSocket(`${protocol}//${window.location.host}/api/agent/ws${token}`);

  ws.onopen = () => {
    agentStore.connected = true;
    if (!agentStore.sessionId) {
      sendWs({
        type: 'session.create',
        agentId: agentStore.activeSourceId,
        treeId: agentStore.treeId ?? undefined,
      });
    }
  };

  ws.onclose = () => {
    agentStore.connected = false;
    agentStore.sessionId = null; // 清除旧 session，重连后重新 session.create
    setTimeout(() => connectAgentWs(), 3000);
  };

  ws.onmessage = (raw) => {
    try {
      const msg = JSON.parse(raw.data) as ServerMessage;
      handleServerMessage(msg);
    } catch {
      /* ignore */
    }
  };
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'session.created':
      agentStore.sessionId = msg.sessionId;
      if (msg.treeId) {
        agentStore.treeId = msg.treeId;
        // turns 为空时加载树（切换历史 / 重新加载）；流式中新懒创建不清空
        if (agentStore.turns.size === 0) {
          loadTree(msg.treeId);
        }
        loadConversations();
      }
      break;
    case 'event':
      handleSourceEvent(msg.event, msg.requestId);
      break;
    case 'session.error': {
      // 尝试通过 requestId 定位，否则广播给所有活跃流
      const rid = msg.requestId;
      if (rid) {
        const turnId = streamingMap.get(rid);
        if (turnId) {
          const turn = agentStore.turns.get(turnId);
          if (turn) {
            turn.status = 'error';
            turn.blocks.push({ type: 'error', message: msg.message });
          }
          streamingMap.delete(rid);
        }
        // 清理跳过重载标记（server 提前报错不发 tree.updated 时避免陈旧残留）
        selfRequestIds.delete(rid);
      }
      agentStore.version++;
      break;
    }
    case 'tree.updated':
      // 本客户端发起的流式完成：turn 已由流式事件实时更新，跳过整树重载（避免每次完成的
      // 全量拉取+重建开销，也从根上消除并行流式时重载互冲）。undo/delete/fork/跨标签页等
      // 无 requestId 或非本端发起的变更才重载。
      if (msg.treeId && !consumeSelfRequest(msg.requestId)) loadTree(msg.treeId);
      loadConversations();
      break;
    case 'permission.request':
      break;
    case 'session.closed':
      agentStore.sessionId = null;
      break;
  }
}
