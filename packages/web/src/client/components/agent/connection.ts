/**
 * WebSocket 连接管理 + SourceEvent 流式处理
 */
import type { SourceEvent, ServerMessage } from '@qcqx/lattice-agent-protocol';
import { timer, retry, tap, BehaviorSubject, type Subscription } from 'rxjs';
import { webSocket, type WebSocketSubject } from 'rxjs/webSocket';
import { authStore } from '../../store';
import { agentStore } from './store';
import { loadTree, loadConversations } from './api';
import { applyStreamEvent } from './turnGraph';
import {
  applySnapshot,
  handleStreamEvent,
  handleStreamAborted,
  handlePresenceState,
  resetLastAppliedRev,
} from './sync';

// ── 流式状态（按 requestId 路由，支持并行） ──

const streamingMap = new Map<string, string>(); // requestId → turnId

/**
 * 设置流式路由目标（本端发起的流：legacy 'event' 按 requestId 路由到 turn）。
 * contentOnly 参数保留兼容旧调用方但不再使用——结构重建已统一由 server 快照广播承担。
 */
export function setStreamingTarget(
  turnId: string | null,
  requestId?: string,
  _contentOnly = true,
): void {
  if (!requestId) return;
  if (turnId) {
    streamingMap.set(requestId, turnId);
  } else {
    streamingMap.delete(requestId);
  }
}

/** 该 requestId 是否本端在途发起（供 sync 区分他端广播） */
export function isSelfRequest(requestId?: string): boolean {
  return !!requestId && streamingMap.has(requestId);
}

// ── 多端同步：per-tree 订阅 ──

const subscribedTrees = new Set<string>();

/** 订阅一棵树（server 下发快照 + 后续广播）；幂等 */
export function subscribeTree(treeId: string): void {
  if (!treeId || subscribedTrees.has(treeId)) return;
  subscribedTrees.add(treeId);
  sendWs({ type: 'tree.subscribe', treeId, clientKind: 'web' });
}

/** 退订（切换会话时调） */
export function unsubscribeTree(treeId: string): void {
  if (!subscribedTrees.delete(treeId)) return;
  sendWs({ type: 'tree.unsubscribe', treeId });
}

// ── SourceEvent → TurnNode（数据逻辑见 turnGraph.applyStreamEvent，可独立测试） ──

export function handleSourceEvent(event: SourceEvent, requestId?: string): void {
  const turnId = requestId ? streamingMap.get(requestId) : undefined;
  if (!turnId) return;
  const turn = agentStore.turns.get(turnId);
  if (!turn) return;

  // 只读防护：turn 已被撤销/删除（乐观标记或 tree.updated 重建）→ 丢弃迟到的流事件，
  // 尤其 done 不能把已删除节点的状态改回 'done' 导致节点复活
  if (turn.status === 'undone' || turn.status === 'hidden') {
    if ((event.type === 'done' || event.type === 'error') && requestId) {
      streamingMap.delete(requestId);
    }
    return;
  }

  // 内容累积 + 终态转换（纯函数，与 server 共用 applyEventToContent）
  applyStreamEvent(turn, event);

  // 仅终态（done/error）才 bump version 触发画布结构/边刷新；
  // 内容 delta 由 turn 级 proxy（store.putTurn）驱动对应节点重渲染，避免每个 delta 重建整画布
  if (event.type === 'done' || event.type === 'error') {
    if (requestId) streamingMap.delete(requestId);
    agentStore.version++;
  }
}

// ── WebSocket（rxjs：webSocket + retry 自动重连 + timer 心跳） ──

const HEARTBEAT_INTERVAL = 25000;
const HEARTBEAT_TIMEOUT = 60000; // 超过此时间未收到任何消息 → 判定死连接主动重连

/**
 * 连接状态机（显式判别联合，单一状态源）：替代旧 `connected` 布尔 + 散落的 reconnectAttempt。
 * disconnected（未连/主动断）→ connecting → connected → reconnecting（带 attempt）→ connecting …
 */
export type ConnectionState =
  | { type: 'disconnected' }
  | { type: 'connecting'; attempt: number }
  | { type: 'connected' }
  | { type: 'reconnecting'; attempt: number };

/** 连接状态单一真相（BehaviorSubject：持有当前值，可被 UI/逻辑订阅） */
export const connectionState$ = new BehaviorSubject<ConnectionState>({ type: 'disconnected' });

function setConnState(next: ConnectionState): void {
  connectionState$.next(next);
  agentStore.connected = next.type === 'connected';
}

let socket$: WebSocketSubject<ServerMessage> | null = null;
let connSub: Subscription | null = null;
let heartbeatSub: Subscription | null = null;
let lastPongAt = 0;

/**
 * 可注入的 WebSocket 构造器（测试接缝）。
 * rxjs 的 `webSocket({ WebSocketCtor })` 官方就为「mocking a WebSocket for testing purposes」提供此项，
 * 故重连/心跳时序可在单测中确定性验证（无需真实网络与第三方 mock 库）。
 * 生产置 null ⇒ 交给 rxjs 用全局 WebSocket。
 */
type WsCtor = { new (url: string, protocols?: string | string[]): WebSocket };
let wsCtorOverride: WsCtor | null = null;

/** 仅测试用：注入假 WebSocket 构造器（传 null 恢复默认） */
export function __setWebSocketCtorForTest(ctor: WsCtor | null): void {
  wsCtorOverride = ctor;
}

/** 仅测试用：重置连接模块内部状态（退订、清空状态机） */
export function __resetConnectionForTest(): void {
  connSub?.unsubscribe();
  connSub = null;
  stopHeartbeat();
  socket$ = null;
  lastPongAt = 0;
  setConnState({ type: 'disconnected' });
}

/** 当前重连尝试次数（从状态机派生，不再单独维护变量） */
function currentAttempt(): number {
  const s = connectionState$.value;
  return s.type === 'reconnecting' || s.type === 'connecting' ? s.attempt : 0;
}

/** 指数退避 + 抖动（防 server 重启惊群）：500ms 起、封顶 30s、抖动 50%~100% */
export function reconnectDelayMs(attempt: number): number {
  const exp = Math.min(500 * 2 ** attempt, 30000);
  return Math.floor(exp * (0.5 + Math.random() * 0.5));
}

/** 底层发送（供 actions 使用）；未连接时丢弃（与旧 readyState 检查一致） */
export function sendWs(payload: Record<string, unknown>): void {
  if (socket$ && connectionState$.value.type === 'connected') {
    socket$.next(payload as unknown as ServerMessage);
  }
}

export function isWsReady(): boolean {
  return !!socket$ && connectionState$.value.type === 'connected' && !!agentStore.sessionId;
}

/** 应用层心跳：定期 ping + 检测对端存活（半开连接/NAT 静默断开时快速发现并触发重连） */
function startHeartbeat(): void {
  stopHeartbeat();
  lastPongAt = Date.now();
  heartbeatSub = timer(HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL).subscribe(() => {
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT) {
      // 死连接：error 当前 socket → retry 触发重连
      socket$?.error(new Error('heartbeat timeout'));
      return;
    }
    sendWs({ type: 'ping' });
  });
}

function stopHeartbeat(): void {
  heartbeatSub?.unsubscribe();
  heartbeatSub = null;
}

function onOpen(): void {
  setConnState({ type: 'connected' }); // 连上：重置退避计数（状态不再携 attempt）
  startHeartbeat();
  if (!agentStore.sessionId) {
    sendWs({
      type: 'session.create',
      agentId: agentStore.activeSourceId,
      treeId: agentStore.treeId ?? undefined,
    });
  }
}

function onClose(): void {
  agentStore.sessionId = null; // 清除旧 session，重连后重新 session.create
  subscribedTrees.clear(); // server 已丢失订阅，清空以便重连后重新订阅（否则广播收不到）
  stopHeartbeat();
  // 状态置 disconnected（若因错误将进入 reconnecting，retry.delay 会接管）
  if (connectionState$.value.type === 'connected') setConnState({ type: 'disconnected' });
}

export function connectAgentWs(): void {
  const st = connectionState$.value.type;
  if (socket$ && (st === 'connected' || st === 'connecting')) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = authStore.token ? `?token=${authStore.token}` : '';
  setConnState({ type: 'connecting', attempt: currentAttempt() });
  socket$ = webSocket<ServerMessage>({
    url: `${protocol}//${window.location.host}/api/agent/ws${token}`,
    openObserver: { next: () => onOpen() },
    closeObserver: { next: () => onClose() },
    ...(wsCtorOverride ? { WebSocketCtor: wsCtorOverride } : {}),
  });

  // retry：网络错误/心跳超时 → 指数退避重连（webSocket 重订阅即重建底层连接，socket$ 引用稳定供 sendWs）
  connSub = socket$
    .pipe(
      tap(() => {
        lastPongAt = Date.now(); // 任何消息都证明对端存活
      }),
      retry({
        delay: () => {
          const attempt = currentAttempt() + 1;
          onClose();
          setConnState({ type: 'reconnecting', attempt }); // 退避计数随状态机派生
          return timer(reconnectDelayMs(attempt));
        },
      }),
    )
    .subscribe({
      next: (msg) => handleServerMessage(msg),
    });
}

/** 主动断开（登出/卸载时）：停止重连与心跳 */
export function disconnectAgentWs(): void {
  connSub?.unsubscribe();
  connSub = null;
  stopHeartbeat();
  socket$?.complete();
  socket$ = null;
  setConnState({ type: 'disconnected' });
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'session.created':
      agentStore.sessionId = msg.sessionId;
      // 竞态防护：仅匹配当前树或懒建树（treeId 空）时接管，避免切换会话后旧 session 在途响应把 treeId 拉回
      if (msg.treeId && (agentStore.treeId === msg.treeId || !agentStore.treeId)) {
        agentStore.treeId = msg.treeId;
        // 订阅该树：server 下发快照（替代原 REST loadTree）+ 后续多端广播
        subscribeTree(msg.treeId);
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
      }
      agentStore.version++;
      break;
    }
    case 'tree.updated':
      // 结构重建 + 会话列表均由 tree.snapshot 承担（快照捎带 conversation 元数据增量更新）；
      // 此处仅留订阅补齐（懒建树），不再走 REST，消除 per-commit 冗余拉取。
      // 竞态防护：仅匹配当前树或懒建树（treeId 空）时接管，避免切换会话后旧树在途消息把 treeId 拉回
      if (msg.treeId && (agentStore.treeId === msg.treeId || !agentStore.treeId)) {
        agentStore.treeId = msg.treeId;
        subscribeTree(msg.treeId);
      }
      break;
    case 'permission.request':
      break;
    case 'session.closed':
      agentStore.sessionId = null;
      break;
    // ── 多端同步广播（他端变更；发起端自身走 legacy 路径，server 已排除发起连接） ──
    case 'tree.snapshot':
      applySnapshot(msg);
      break;
    case 'stream.event':
      handleStreamEvent(msg);
      break;
    case 'stream.aborted':
      handleStreamAborted(msg);
      break;
    case 'presence.state':
      handlePresenceState(msg);
      break;
    case 'tree.event':
      break; // S6 精化：增量 op
    case 'tree.reject':
      // 命令被拒绝（只读守卫/并发冲突）→ 强制重建回滚本端乐观态（重置 rev 基线绕过守卫）
      resetLastAppliedRev();
      if (msg.treeId) loadTree(msg.treeId);
      break;
    case 'pong':
      break; // 心跳响应（存活检测已在 onmessage 统一更新 lastPongAt）
  }
}
