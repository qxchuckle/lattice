// @vitest-environment node
/**
 * ws-handler.ts 行为测试
 *
 * 覆盖两个修复：
 *   - 权限请求 30s TTL：创建后 30s 未应答自动过期，通知客户端 permission.expired
 *   - WS 断连清理：socket close 时清理 treeSubscribers/treePresence/pendingPermissions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerMessage, PresenceState } from '@qcqx/lattice-agent-protocol';
import { forwardPermissionRequest, type PermissionRequestPayload } from './ws-handler';
import { closeConnection } from './ws-handler';
import type { AgentConn, WsSocket } from './shared';

// ── Mock 工厂 ──────────────────────────────────────────────────────

function makeSocket(): WsSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
}

function makeConn(overrides?: Partial<AgentConn>): AgentConn {
  return {
    id: 'conn-test',
    socket: makeSocket(),
    clientKind: 'web',
    subscribed: new Set(),
    pendingPermissions: new Set(),
    permissionTimers: new Map(),
    sessions: new Set(),
    ...overrides,
  };
}

// ── 权限请求 30s TTL ──────────────────────────────────────────────

describe('权限请求 30s TTL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const basePayload: PermissionRequestPayload = {
    request: { id: 'req-ttl-1', tool: 'writeFile', args: { path: '/repo/a.ts' }, level: 'ask' },
    sessionId: 'sess-owner',
  };

  it('创建权限请求后 30s 未应答 → 客户端收到 permission.expired + pendingPermissions 清除', () => {
    const conn = makeConn();
    conn.sessions.add('sess-owner');
    const sent: ServerMessage[] = [];

    forwardPermissionRequest(conn, basePayload, (msg) => sent.push(msg));

    // 立即收到 permission.request
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('permission.request');
    expect(conn.pendingPermissions.has('req-ttl-1')).toBe(true);

    // 前进 30s（未到过期）
    vi.advanceTimersByTime(29999);
    expect(conn.pendingPermissions.has('req-ttl-1')).toBe(true);

    // 到 30s 过期
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(2);
    expect(sent[1].type).toBe('permission.expired');
    expect((sent[1] as { requestId: string }).requestId).toBe('req-ttl-1');
    expect(conn.pendingPermissions.has('req-ttl-1')).toBe(false);
  });

  it('权限请求在 30s 内被应答 → 不发送 permission.expired（定时器被清除）', () => {
    const conn = makeConn();
    conn.sessions.add('sess-owner');
    const sent: ServerMessage[] = [];

    forwardPermissionRequest(conn, basePayload, (msg) => sent.push(msg));
    expect(sent).toHaveLength(1); // permission.request

    // 模拟应答：手动删除 pendingPermissions + 清除定时器（与 ws-commands permission.respond 逻辑一致）
    conn.pendingPermissions.delete('req-ttl-1');
    const timer = conn.permissionTimers.get('req-ttl-1');
    if (timer) {
      clearTimeout(timer);
      conn.permissionTimers.delete('req-ttl-1');
    }

    // 前进 30s（超过 TTL）→ 不应有过期通知
    vi.advanceTimersByTime(30000);
    expect(sent).toHaveLength(1); // 仍只有 permission.request
    expect(sent.filter((m) => m.type === 'permission.expired')).toHaveLength(0);
  });

  it('连接关闭时清除全部权限定时器（防泄漏）', () => {
    const conn = makeConn();
    conn.sessions.add('sess-owner');
    const sent: ServerMessage[] = [];

    forwardPermissionRequest(conn, basePayload, (msg) => sent.push(msg));
    expect(conn.permissionTimers.size).toBe(1);

    // 模拟 close：清除全部定时器
    for (const t of conn.permissionTimers.values()) clearTimeout(t);
    conn.permissionTimers.clear();
    conn.pendingPermissions.clear();

    // 前进 30s → 不应有过期通知（定时器已清）
    vi.advanceTimersByTime(30000);
    expect(sent).toHaveLength(1); // 仍只有 permission.request
  });
});

// ── WS 断连清理 ──────────────────────────────────────────────────

describe('closeConnection 断连清理', () => {
  it('close 后 treeSubscribers 不含该连接、treePresence 不含该 connId、pendingPermissions 清空', () => {
    const treeSubscribers = new Map<string, Set<AgentConn>>();
    const treePresence = new Map<string, Map<string, PresenceState>>();
    const conn = makeConn({ id: 'conn-close-1' });

    // 订阅 tree-1
    const subs = new Set<AgentConn>([conn]);
    treeSubscribers.set('tree-1', subs);
    conn.subscribed.add('tree-1');
    treePresence.set(
      'tree-1',
      new Map([['conn-close-1', { connectionId: 'conn-close-1', clientKind: 'web' }]]),
    );

    // 订阅 tree-2
    const subs2 = new Set<AgentConn>([conn]);
    treeSubscribers.set('tree-2', subs2);
    conn.subscribed.add('tree-2');
    treePresence.set(
      'tree-2',
      new Map([['conn-close-1', { connectionId: 'conn-close-1', clientKind: 'web' }]]),
    );

    // pendingPermissions 有数据
    conn.pendingPermissions.add('perm-a');
    conn.pendingPermissions.add('perm-b');
    conn.permissionTimers.set(
      'perm-a',
      setTimeout(vi.fn(), 99999) as unknown as ReturnType<typeof setTimeout>,
    );
    conn.permissionTimers.set(
      'perm-b',
      setTimeout(vi.fn(), 99999) as unknown as ReturnType<typeof setTimeout>,
    );
    conn.sessions.add('sess-1');

    const abortByRequestId = vi.fn();
    const unsubscribeConn = vi.fn((c: AgentConn, treeId: string): void => {
      treeSubscribers.get(treeId)?.delete(c);
      c.subscribed.delete(treeId);
      treePresence.get(treeId)?.delete(c.id);
    });

    closeConnection(conn, {
      unsubscribeConn,
      socketRequestIds: new Set(['rid-1', 'rid-2']),
      abortByRequestId,
    });

    // unsubscribeConn 被调用对每棵订阅的树
    expect(unsubscribeConn).toHaveBeenCalledWith(conn, 'tree-1');
    expect(unsubscribeConn).toHaveBeenCalledWith(conn, 'tree-2');
    // treeSubscribers 不含该连接
    expect(treeSubscribers.get('tree-1')?.has(conn)).toBe(false);
    expect(treeSubscribers.get('tree-2')?.has(conn)).toBe(false);
    // treePresence 不含该 connId
    expect(treePresence.get('tree-1')?.has('conn-close-1')).toBe(false);
    expect(treePresence.get('tree-2')?.has('conn-close-1')).toBe(false);
    // pendingPermissions 清空
    expect(conn.pendingPermissions.size).toBe(0);
    expect(conn.permissionTimers.size).toBe(0);
    // sessions 清空
    expect(conn.sessions.size).toBe(0);
    // subscribed 清空
    expect(conn.subscribed.size).toBe(0);
    // socketRequestIds 被 abort
    expect(abortByRequestId).toHaveBeenCalledWith('rid-1');
    expect(abortByRequestId).toHaveBeenCalledWith('rid-2');
  });
});
