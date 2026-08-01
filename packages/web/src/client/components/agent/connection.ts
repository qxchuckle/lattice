/**
 * WebSocket 连接管理 + SourceEvent 流式处理
 */
import type { SourceEvent, ServerMessage, ClientMessage } from '@qcqx/lattice-agent-protocol';
import { isTerminalViewStatus } from '@qcqx/lattice-agent-protocol';
import {
  timer,
  retry,
  tap,
  BehaviorSubject,
  Subject,
  firstValueFrom,
  timeout,
  throwIfEmpty,
  type Observable,
  type Subscription,
} from 'rxjs';
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
  handleQueueState,
  resetLastAppliedRev,
  clearLiveStream,
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

/** 订阅一棵树（server 下发快照 + 后续广播）；幂等（重连后 subscribedTrees 保留，仍需发送） */
export function subscribeTree(treeId: string): void {
  if (!treeId) return;
  const isNew = !subscribedTrees.has(treeId);
  subscribedTrees.add(treeId);
  if (isNew) sendWs({ type: 'tree.subscribe', treeId, clientKind: 'web' });
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

  // 只读防护（状态机单一真相）：turn 已被撤销/删除（乐观标记或 tree.updated 重建）→ 丢弃迟到的流事件，
  // 尤其 done 不能把已删除节点的状态改回 'done' 导致节点复活
  if (isTerminalViewStatus(turn.status)) {
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

/** 重连触发源：区分「connected 后断链 / connecting 建链失败 / 心跳超时判死」，便于日志排查 */
export type ReconnectReason = 'connection-lost' | 'connect-failed' | 'heartbeat-timeout';

/**
 * 连接状态机（显式判别联合，单一状态源）：替代旧 `connected` 布尔 + 散落的 reconnectAttempt。
 * disconnected（未连/主动断）→ connecting → connected → reconnecting（带 attempt + reason）→ connecting …
 */
export type ConnectionState =
  | { type: 'disconnected' }
  | { type: 'connecting'; attempt: number }
  | { type: 'connected' }
  | { type: 'reconnecting'; attempt: number; reason: ReconnectReason };

/**
 * 连接状态单一真相。Subject 保持**私有**，对外只给只读流与快照读取器——
 * 避开 RxJS 头号反模式「对外暴露可写 Subject」（外部 next() 能篡改状态机，使转换不可推断）。
 */
const connectionStateSubject = new BehaviorSubject<ConnectionState>({ type: 'disconnected' });

/** 连接状态（只读流）：外部只能订阅，不能 next */
export const connectionState$: Observable<ConnectionState> = connectionStateSubject.asObservable();

/** 当前连接状态快照（同步读） */
export function getConnectionState(): ConnectionState {
  return connectionStateSubject.value;
}

/**
 * session 就绪信号（事件驱动，替代轮询）：server 回 session.created 时发出 sessionId。
 * Subject 私有，对外只给只读流（避开「暴露可写 Subject」反模式）。
 */
const sessionReadySubject = new Subject<string>();
export const sessionReady$: Observable<string> = sessionReadySubject.asObservable();

/**
 * 等 session 就绪：已就绪立即返回；否则等 session.created 事件，超时则 reject。
 * 代替旧的「每 300ms 轮询、最多 5 次」：事件驱动 ⇒ 建立即继续（不再等下个 tick），
 * 边界由 timeout operator 显式表达（而非隐含在重试次数里）。
 */
export function waitForSessionReady(timeoutMs = 1500): Promise<string> {
  if (agentStore.sessionId) return Promise.resolve(agentStore.sessionId);
  // 空流防御：若 sessionReady$ 在 timeout 触发前异常 complete，firstValueFrom 会抛无语义的
  // EmptyError；throwIfEmpty 转为可读错误，保持 reject 语义（调用方以 reject 落 error turn）。
  return firstValueFrom(
    sessionReady$.pipe(
      timeout({ each: timeoutMs }),
      throwIfEmpty(() => new Error('session ready stream completed without a session')),
    ),
  );
}

function setConnState(next: ConnectionState): void {
  connectionStateSubject.next(next);
  agentStore.connected = next.type === 'connected';
}

// webSocket 单泛型同时用于收发：用 ServerMessage|ClientMessage 联合，避免发送侧类型谎言
let socket$: WebSocketSubject<ServerMessage | ClientMessage> | null = null;
let connSub: Subscription | null = null;

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

/** 仅测试用：注入连接状态（接缝函数，模拟状态机转换供 hook 行为测试验证） */
export function __setConnStateForTest(state: ConnectionState): void {
  setConnState(state);
}

/** 仅测试用：重置连接模块内部状态（退订、清空状态机；心跳随状态转 disconnected 联动停止） */
export function __resetConnectionForTest(): void {
  connSub?.unsubscribe();
  connSub = null;
  socket$ = null;
  heartbeatTimedOut = false;
  connectionEpoch = 0; // 重置连接代数
  setConnState({ type: 'disconnected' });
  // 状态订阅一并退订（防泄漏），再重绑保持「心跳随状态联动」对后续测试可用
  stateSubscription?.unsubscribe();
  stateSubscription = null;
  bindHeartbeatToState();
}

/** 当前重连尝试次数（从状态机派生，不再单独维护变量） */
function currentAttempt(): number {
  const s = connectionStateSubject.value;
  return s.type === 'reconnecting' || s.type === 'connecting' ? s.attempt : 0;
}

/** 指数退避 + 抖动（防 server 重启惊群）：500ms 起、封顶 30s、抖动 50%~100% */
export function reconnectDelayMs(attempt: number): number {
  const exp = Math.min(500 * 2 ** attempt, 30000);
  return Math.floor(exp * (0.5 + Math.random() * 0.5));
}

/** 底层发送（供 actions 使用）；未连接时丢弃（与旧 readyState 检查一致）。
 * 入参用 ClientMessage 而非 Record<string,unknown>：编译期校验消息形状，去除 as unknown as 类型谎言。 */
export function sendWs(payload: ClientMessage): void {
  if (socket$ && connectionStateSubject.value.type === 'connected') {
    socket$.next(payload);
  }
}

export function isWsReady(): boolean {
  return !!socket$ && connectionStateSubject.value.type === 'connected' && !!agentStore.sessionId;
}

// ── 应用层心跳：定期 ping + 检测对端存活（半开连接/NAT 静默断开时快速发现并触发重连） ──
// 生命周期由下方状态订阅统一管理：仅 connected 态运行，离开 connected 即停，不在各回调里手工启停。

let heartbeatSub: Subscription | null = null;
let lastPongAt = 0;
// 心跳超时主动 error 的标记：供 retry.delay 判定触发源（error 对象会被 rxjs webSocket 包装，不可靠）
let heartbeatTimedOut = false;

/** 连接代数：每次 onOpen 递增，heartbeat 回调检查代数匹配，防旧 timer 误判新连接 */
let connectionEpoch = 0;

function startHeartbeat(): void {
  stopHeartbeat();
  lastPongAt = Date.now();
  const epoch = connectionEpoch; // 捕获本次连接的代数
  heartbeatSub = timer(HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL).subscribe(() => {
    // 代数不匹配：当前连接已不是 heartbeat 启动时的连接，静默退出
    if (epoch !== connectionEpoch) return;
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT) {
      // 死连接：error 当前 socket → retry 触发重连
      heartbeatTimedOut = true;
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

// 心跳与状态机显式绑定：任何转出 connected 的转换（断链/重连/主动断/测试重置）同步停表，
// 杜绝「连接已不在 connected 心跳仍在跑」的幽灵 timer；心跳超时自身的 error 路径亦经此停表。
// Subscription 持有于模块级变量，测试重置时退订防泄漏。
let stateSubscription: Subscription | null = null;

function bindHeartbeatToState(): void {
  stateSubscription = connectionStateSubject.subscribe((s) => {
    if (s.type === 'connected') startHeartbeat();
    else stopHeartbeat();
  });
}
bindHeartbeatToState();

function onOpen(): void {
  connectionEpoch++; // 新连接代数
  setConnState({ type: 'connected' }); // 连上：重置退避计数（状态不再携 attempt）；心跳随状态订阅启动
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
  // 断连后 server closeConnection 已清 TTL timer，不再发 permission.expired →
  // 客户端须主动清 pendingPermissions，防权限对话框成孤儿
  agentStore.pendingPermissions.clear();
  // 保留 subscribedTrees：server 侧订阅已丢失，但 client 侧记录需重连后恢复
  // 状态置 disconnected（若因错误将进入 reconnecting，retry.delay 会接管）；心跳随状态订阅停止
  if (connectionStateSubject.value.type === 'connected') setConnState({ type: 'disconnected' });
}

export function connectAgentWs(): void {
  const st = connectionStateSubject.value.type;
  if (socket$ && (st === 'connected' || st === 'connecting')) return;

  // disconnectAgentWs 全量清理会退订状态订阅：重连前按需重绑，保证心跳继续随状态联动
  if (!stateSubscription) bindHeartbeatToState();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = authStore.token ? `?token=${authStore.token}` : '';
  setConnState({ type: 'connecting', attempt: currentAttempt() });
  socket$ = webSocket<ServerMessage | ClientMessage>({
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
          // 触发源判定须在 onClose 改写状态前读取：
          // 断链时 closeObserver 已先行把 connected → disconnected（connecting/reconnecting 则保持原状），
          // 故 connecting/reconnecting ⇒ 建链失败，其余 ⇒ 建链成功后断开（心跳判死由标记单独区分）。
          const prevType = connectionStateSubject.value.type;
          const reason: ReconnectReason = heartbeatTimedOut
            ? 'heartbeat-timeout'
            : prevType === 'connecting' || prevType === 'reconnecting'
              ? 'connect-failed'
              : 'connection-lost';
          heartbeatTimedOut = false;
          const attempt = currentAttempt() + 1;
          onClose();
          // 此处状态转换是安全的：即使返回的退避 timer 在触发前被取消（如卸载时 disconnectAgentWs
          // 退订 connSub），disconnectAgentWs 会把状态重置为 disconnected，不会残留 reconnecting。
          setConnState({ type: 'reconnecting', attempt, reason }); // 退避计数随状态机派生
          return timer(reconnectDelayMs(attempt));
        },
      }),
    )
    .subscribe({
      // 入向必为 ServerMessage（联合仅为容纳发送侧 ClientMessage）。
      // handleServerMessage 为纯同步分发（switch 路由到各 store/sync 处理器），无需 mergeMap/from 包装；
      // 内部 loadTree/loadConversations 虽为 async 但属 fire-and-forget 且各自 try/catch 兜底，不影响本流。
      next: (msg) => handleServerMessage(msg as ServerMessage),
    });
}

/** 主动断开（登出/卸载时）：停止重连；心跳随状态转 disconnected 联动停止；
 * 全量清理所有活跃订阅（connSub / socket$ / 心跳 timer / 状态订阅），防页面卸载后泄漏。
 * 状态订阅退订后由 connectAgentWs 按需重绑，重连路径不受影响。 */
export function disconnectAgentWs(): void {
  connSub?.unsubscribe();
  connSub = null;
  socket$?.complete();
  socket$ = null;
  heartbeatTimedOut = false;
  setConnState({ type: 'disconnected' }); // 心跳先随状态联动停止
  stopHeartbeat(); // 双保险：即使状态订阅已失效也确保 timer 停止
  stateSubscription?.unsubscribe();
  stateSubscription = null;
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'session.created':
      agentStore.sessionId = msg.sessionId;
      sessionReadySubject.next(msg.sessionId); // 唤醒等待者（事件驱动，不再轮询）
      // 竞态防护：仅匹配当前树或懒建树（treeId 空）时接管，避免切换会话后旧 session 在途响应把 treeId 拉回
      if (msg.treeId && (agentStore.treeId === msg.treeId || !agentStore.treeId)) {
        agentStore.treeId = msg.treeId;
        // 仅维护 set（幂等）；不调 subscribeTree——其 isNew 幂等在重连场景下会漏发主树订阅
        subscribedTrees.add(msg.treeId);
        // P1-#7 修复：重连后 server 侧订阅已丢失（socket close 时 unsubscribeConn 清空），
        // 需对全部 subscribedTrees（含主树）统一重发 tree.subscribe，不能依赖 isNew 幂等判断
        for (const tid of subscribedTrees) {
          sendWs({ type: 'tree.subscribe', treeId: tid, clientKind: 'web' });
        }
        loadConversations();
      }
      break;
    case 'event':
      handleSourceEvent(msg.event, msg.requestId);
      break;
    case 'session.error': {
      // 尝试通过 requestId 定位，否则广播给所有活跃流
      // TODO(预留): validation_error 能力——session.error 携带 validationError 字段时走专用 UX 路径（归批次四）
      const rid = msg.requestId;
      if (rid) {
        clearLiveStream(rid); // 主动清理他端在途流缓冲（防御：requestId 可能对应他端流残留）
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
      // 挂起权限请求：UI 据此渲染权限确认对话框；30s TTL 或 permission.respond 后移除
      // 批次四已实现：PermissionDialog 组件渲染允许/拒绝按钮 → sendWs permission.respond + 移除 pendingPermissions 条目
      agentStore.pendingPermissions.set(msg.requestId, {
        requestId: msg.requestId,
        tool: msg.tool,
        args: msg.args,
        level: msg.level,
      });
      break;
    case 'permission.expired':
      // server 30s TTL 到期：按 requestId 移除挂起的权限请求，UI 对话框自动关闭
      agentStore.pendingPermissions.delete(msg.requestId);
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
    case 'queue.state':
      handleQueueState(msg);
      break;
    case 'tree.event':
      break; // S6 精化：增量 op
    case 'tree.reject':
      // 命令被拒绝（只读守卫/并发冲突）→ 强制重建回滚本端乐观态（重置 rev 基线绕过守卫）
      resetLastAppliedRev();
      if (msg.treeId) loadTree(msg.treeId);
      break;
    case 'tree.error':
      break; // 树级错误提示（fork 降级告知等）：由发起端操作路径自行处理，广播侧暂不呈现
    case 'pong':
      break; // 心跳响应（存活检测已在 onmessage 统一更新 lastPongAt）
    default:
      // 滚动发布容错：未来版本出现未知 ServerMessage type 时不抛错断连，仅 warn 后忽略，
      // 保 client/server 版本不一致时旧 client 不因新消息类型崩溃（assertNever 会击穿 rxjs 流）
      console.warn('[agent] unknown ServerMessage type, ignoring', (msg as { type?: string }).type);
      break;
  }
}
