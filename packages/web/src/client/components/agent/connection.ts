/**
 * WebSocket 连接管理 + SourceEvent 流式处理
 */
import type { SourceEvent, ServerMessage } from '@qcqx/lattice-agent-protocol';
import { authStore } from '../../store';
import { agentStore } from './store';
import { loadTree, loadConversations } from './api';

// ── 流式状态（按 requestId 路由，支持并行） ──

const streamingMap = new Map<string, string>(); // requestId → turnId

export function setStreamingTarget(turnId: string | null, requestId?: string): void {
  if (!requestId) return;
  if (turnId) {
    streamingMap.set(requestId, turnId);
  } else {
    streamingMap.delete(requestId);
  }
}

// ── SourceEvent → TurnNode.blocks ──

export function handleSourceEvent(event: SourceEvent, requestId?: string): void {
  const turnId = requestId ? streamingMap.get(requestId) : undefined;
  if (!turnId) return;
  const turn = agentStore.turns.get(turnId);
  if (!turn) return;

  switch (event.type) {
    case 'text': {
      const last = turn.blocks[turn.blocks.length - 1];
      if (last && last.kind === 'text') {
        last.text += event.content;
      } else {
        turn.blocks.push({ kind: 'text', text: event.content });
      }
      break;
    }
    case 'thinking': {
      const last = turn.blocks[turn.blocks.length - 1];
      if (last && last.kind === 'thinking') {
        last.text += event.content;
      } else {
        turn.blocks.push({ kind: 'thinking', text: event.content });
      }
      break;
    }
    case 'tool_call':
      turn.blocks.push({
        kind: 'tool_call',
        id: event.id,
        name: event.name,
        args: event.args,
        status: 'running',
      });
      break;
    case 'tool_result': {
      const tc = turn.blocks.find((b) => b.kind === 'tool_call' && b.id === event.id);
      if (tc && tc.kind === 'tool_call') tc.status = event.isError ? 'error' : 'done';
      turn.blocks.push({
        kind: 'tool_result',
        id: event.id,
        name: event.name,
        result: event.result,
        isError: event.isError,
      });
      break;
    }
    case 'file_edit':
      turn.blocks.push({ kind: 'file_edit', path: event.path, diff: event.diff });
      break;
    case 'terminal':
      turn.blocks.push({ kind: 'terminal', command: event.command, output: event.output });
      break;
    case 'done':
      turn.status = 'done';
      turn.usage = event.usage;
      if (requestId) streamingMap.delete(requestId);
      break;
    case 'error':
      turn.blocks.push({ kind: 'error', message: event.message, suggestion: event.suggestion });
      turn.status = 'error';
      if (requestId) streamingMap.delete(requestId);
      break;
  }
  agentStore.version++;
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
      const rid = (msg as { requestId?: string }).requestId;
      if (rid && streamingMap.has(rid)) {
        const turn = agentStore.turns.get(streamingMap.get(rid)!);
        if (turn) {
          turn.status = 'error';
          turn.blocks.push({ kind: 'error', message: msg.message });
        }
        streamingMap.delete(rid);
      }
      agentStore.version++;
      break;
    }
    case 'tree.updated':
      loadConversations(); // 标题/节点数变更后刷新历史列表
      break;
    case 'permission.request':
      break;
    case 'session.closed':
      agentStore.sessionId = null;
      break;
  }
}
