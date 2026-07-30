/**
 * connection 测试：退避算法 + 连接状态机 + **重连/心跳真实时序**
 *
 * 关于「WS 能不能测」：能。rxjs 的 `webSocket({ WebSocketCtor })` 官方就为
 * “mocking a WebSocket for testing purposes” 提供了构造器注入接缝，配合 vitest fake timers
 * 即可确定性驱动 open/message/close/error 与定时器，无需真实网络、也无需第三方 mock 库
 * （业内另有 vitest-websocket-mock / MSW 的 WS 拦截，适用于不暴露 ctor 的场景；
 *   我们既然能注入 ctor，就用最轻的方案）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  reconnectDelayMs,
  getConnectionState,
  connectAgentWs,
  disconnectAgentWs,
  sendWs,
  isWsReady,
  waitForSessionReady,
  __setWebSocketCtorForTest,
  __resetConnectionForTest,
} from './connection';
import { agentStore } from './store';

// ── 假 WebSocket：记录实例、可手动驱动 open/message/close/error ──

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static get last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed = false;

  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.onclose?.({ wasClean: true, code: 1000, reason: '' });
  }

  // ── 测试驱动 ──
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({ type: 'open' });
  }
  simulateMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  /** 服务端异常断开（非 clean）→ rxjs 会 error 出去，触发 retry */
  simulateAbnormalClose(): void {
    this.readyState = 3;
    this.onclose?.({ wasClean: false, code: 1006, reason: 'abnormal' });
  }
}

const asCtor = (): { new (url: string, protocols?: string | string[]): WebSocket } =>
  FakeWebSocket as unknown as { new (url: string, protocols?: string | string[]): WebSocket };

describe('reconnectDelayMs（指数退避 + 抖动）', () => {
  it('每次落在 [exp*0.5, exp] 区间（exp = min(500*2^n, 30000)）', () => {
    for (let attempt = 0; attempt <= 10; attempt++) {
      const exp = Math.min(500 * 2 ** attempt, 30000);
      for (let i = 0; i < 50; i++) {
        const d = reconnectDelayMs(attempt);
        expect(d).toBeGreaterThanOrEqual(Math.floor(exp * 0.5));
        expect(d).toBeLessThanOrEqual(exp);
      }
    }
  });

  it('封顶 30s：高 attempt 不超过 30000', () => {
    for (let i = 0; i < 50; i++) expect(reconnectDelayMs(20)).toBeLessThanOrEqual(30000);
  });
});

describe('WS 连接生命周期（注入 WebSocketCtor + fake timers）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    __setWebSocketCtorForTest(asCtor());
    agentStore.sessionId = null;
  });

  afterEach(() => {
    __resetConnectionForTest();
    __setWebSocketCtorForTest(null);
    vi.useRealTimers();
  });

  it('connect → connecting；open 后 → connected 且自动发 session.create', () => {
    connectAgentWs();
    expect(getConnectionState().type).toBe('connecting');

    FakeWebSocket.last.simulateOpen();
    expect(getConnectionState().type).toBe('connected');
    expect(agentStore.connected).toBe(true);

    // 无 sessionId 时握手：自动 session.create
    const payloads = FakeWebSocket.last.sent.map((s) => JSON.parse(s) as { type: string });
    expect(payloads.some((p) => p.type === 'session.create')).toBe(true);
  });

  it('未连接时 sendWs 丢弃；connected 后才真正发送', () => {
    connectAgentWs();
    sendWs({ type: 'ping' }); // connecting 态 → 丢弃
    const beforeOpen = FakeWebSocket.last.sent.length;
    FakeWebSocket.last.simulateOpen();
    const afterOpenBaseline = FakeWebSocket.last.sent.length;
    sendWs({ type: 'ping' });
    expect(beforeOpen).toBe(0);
    expect(FakeWebSocket.last.sent.length).toBe(afterOpenBaseline + 1);
  });

  it('心跳：每 25s 发一次 ping', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();
    const base = FakeWebSocket.last.sent.length;

    vi.advanceTimersByTime(25_000);
    vi.advanceTimersByTime(25_000);

    const pings = FakeWebSocket.last.sent
      .slice(base)
      .map((s) => JSON.parse(s) as { type: string })
      .filter((p) => p.type === 'ping');
    expect(pings.length).toBe(2);
  });

  it('🔴 死连接检测：60s 无任何消息 → 关闭当前 socket 触发重连（新实例建立）', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();
    const first = FakeWebSocket.last;
    expect(FakeWebSocket.instances).toHaveLength(1);

    // 推进超过 HEARTBEAT_TIMEOUT（心跳每 25s 检查一次，第 75s 那次检测到 >60s 无消息）
    vi.advanceTimersByTime(75_000);
    expect(getConnectionState().type).not.toBe('connected');

    // 退避后重连：产生第二个 socket 实例
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    expect(FakeWebSocket.last).not.toBe(first);
  });

  it('🔴 心跳被消息刷新：期间有消息则不触发死连接重连', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();

    // 每 25s 来一条消息刷新 lastPongAt，共 100s，不应判死
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(25_000);
      FakeWebSocket.last.simulateMessage({ type: 'pong' });
    }
    expect(getConnectionState().type).toBe('connected');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('🔴 异常断开 → reconnecting（带 attempt 递增）→ 退避后重连', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();
    expect(getConnectionState().type).toBe('connected');

    FakeWebSocket.last.simulateAbnormalClose();
    const st = getConnectionState();
    expect(st.type).toBe('reconnecting');
    if (st.type === 'reconnecting') expect(st.attempt).toBe(1);

    // 退避上限 500ms*2^1 → 最多 1s；推进足够时间后应重连出新实例
    vi.advanceTimersByTime(2_000);
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('🔴 重连触发源：connected 后断链 → reason=connection-lost', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.last.simulateAbnormalClose();

    const st = getConnectionState();
    expect(st).toMatchObject({ type: 'reconnecting', reason: 'connection-lost' });
  });

  it('🔴 重连触发源：connecting 建链失败（从未 open）→ reason=connect-failed', () => {
    connectAgentWs();
    expect(getConnectionState().type).toBe('connecting');

    FakeWebSocket.last.simulateAbnormalClose(); // 握手阶段就失败
    const st = getConnectionState();
    expect(st).toMatchObject({ type: 'reconnecting', reason: 'connect-failed' });

    // 重连后再次失败：仍是 connect-failed（reconnecting → 失败属建链失败）
    vi.advanceTimersByTime(2_000);
    FakeWebSocket.last.simulateAbnormalClose();
    expect(getConnectionState()).toMatchObject({ type: 'reconnecting', reason: 'connect-failed' });
  });

  it('🔴 重连触发源：心跳判死 → reason=heartbeat-timeout；后续建链失败不残留该标记', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();

    vi.advanceTimersByTime(75_000); // 第 75s 那次检测到 >60s 无消息 → 判死
    expect(getConnectionState()).toMatchObject({
      type: 'reconnecting',
      reason: 'heartbeat-timeout',
    });

    // 标记已消费：重连后建链失败应判为 connect-failed 而非残留的 heartbeat-timeout
    vi.advanceTimersByTime(60_000);
    FakeWebSocket.last.simulateAbnormalClose();
    expect(getConnectionState()).toMatchObject({ type: 'reconnecting', reason: 'connect-failed' });
  });

  it('🔴 心跳超时临界：快判死前收到 pong 刷新 → 不触发重连', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();

    vi.advanceTimersByTime(50_000); // 距上次消息 50s，下个 tick（75s）就会判死
    FakeWebSocket.last.simulateMessage({ type: 'pong' }); // 临界前刷新存活
    vi.advanceTimersByTime(25_000); // 75s tick：距 pong 仅 25s → 不判死

    expect(getConnectionState().type).toBe('connected');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('🔴 主动断开后心跳随状态停止：不再发 ping、不再触发重连', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();
    disconnectAgentWs();
    const sentAtClose = FakeWebSocket.last.sent.length;

    vi.advanceTimersByTime(120_000); // 若残留幽灵心跳，早已发 ping 或判死重连
    expect(FakeWebSocket.last.sent.length).toBe(sentAtClose);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(getConnectionState().type).toBe('disconnected');
  });

  it('🔴 快速重连不产生双心跳：新连接上每 25s 恰好一次 ping', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.last.simulateAbnormalClose();

    vi.advanceTimersByTime(2_000); // 退避后重建 socket
    const second = FakeWebSocket.last;
    second.simulateOpen(); // 快速重连成功 → 心跳重启（旧表应已停）
    const base = second.sent.length;

    vi.advanceTimersByTime(25_000);
    const pings = second.sent
      .slice(base)
      .map((s) => JSON.parse(s) as { type: string })
      .filter((p) => p.type === 'ping');
    expect(pings.length).toBe(1); // 双心跳会是 2
  });

  it('断开时清 sessionId（重连后需重新 session.create）+ isWsReady 反映真实可用性', () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();
    agentStore.sessionId = 'sess-1';
    expect(isWsReady()).toBe(true);

    FakeWebSocket.last.simulateAbnormalClose();
    expect(agentStore.sessionId).toBeNull();
    expect(isWsReady()).toBe(false);
  });

  it('🔴 waitForSessionReady：session.created 到达即唤醒（事件驱动，不等轮询 tick）', async () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();

    const waiting = waitForSessionReady(1500);
    // 立即推送 session.created（不推进任何定时器）
    FakeWebSocket.last.simulateMessage({ type: 'session.created', sessionId: 's-9', treeId: '' });
    await expect(waiting).resolves.toBe('s-9');
  });

  it('🔴 waitForSessionReady：超时未就绪 → reject（边界由 timeout 显式表达）', async () => {
    connectAgentWs();
    FakeWebSocket.last.simulateOpen();

    const waiting = waitForSessionReady(1000);
    const assertion = expect(waiting).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
  });

  it('waitForSessionReady：已就绪则立即 resolve（不等事件）', async () => {
    agentStore.sessionId = 'already';
    await expect(waitForSessionReady(10)).resolves.toBe('already');
  });
});
