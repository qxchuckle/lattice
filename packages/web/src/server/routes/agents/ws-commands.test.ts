// @vitest-environment node
/**
 * ws-commands.ts 安全测试
 *
 * 覆盖两个安全修复：
 *   - P1-#11：入站参数守卫（超长/超大 payload 拦截）
 *   - P1-#12：permission.respond 归属校验（只允许持有对应 requestId 的连接应答）
 */
import { describe, it, expect, vi } from 'vitest';
import type { ServerMessage, ClientMessage } from '@qcqx/lattice-agent-protocol';
import type { LatticeAgent } from '@qcqx/lattice-agent';
import { handleWsCommand, type WsCommandContext } from './ws-commands';
import { forwardPermissionRequest, type PermissionRequestPayload } from './ws-handler';
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
    sessions: new Set(),
    ...overrides,
  };
}

function makeLatticeAgent() {
  const permissionRespond = vi.fn();
  const conversationSend = vi.fn();
  const latticeAgent = {
    conversation: {
      send: conversationSend,
      createSession: vi.fn(),
      getSession: vi.fn(),
      abort: vi.fn(),
      destroySession: vi.fn(),
      fork: vi.fn(),
      undo: vi.fn(),
      delete: vi.fn(),
      continue: vi.fn(),
      retry: vi.fn(),
      abortTreeStreams: vi.fn(),
      abortByRequestId: vi.fn(),
      turnCapabilities: vi.fn(),
    },
    session: {
      loadTree: vi.fn(),
      getTree: vi.fn(),
      getNodes: vi.fn(),
      canBatchDelete: vi.fn(),
      deleteNodes: vi.fn(),
      merge: vi.fn(),
      switchHead: vi.fn(),
      setDefaultBranch: vi.fn(),
      getInterruptedStreams: vi.fn(),
    },
    sources: {
      registry: { getSource: vi.fn() },
    },
    permission: {
      respond: permissionRespond,
    },
    events: {
      on: vi.fn(() => vi.fn()),
    },
  } as unknown as LatticeAgent;
  return { latticeAgent, permissionRespond, conversationSend };
}

function makeCtx(overrides?: Partial<WsCommandContext>) {
  const sent: ServerMessage[] = [];
  const send = (msg: ServerMessage) => sent.push(msg);
  const conn = makeConn();
  const { latticeAgent, permissionRespond, conversationSend } = makeLatticeAgent();
  const ctx: WsCommandContext = {
    socket: conn.socket,
    conn,
    latticeAgent,
    send,
    broadcastTree: vi.fn(),
    broadcastPresence: vi.fn(),
    broadcastSnapshot: vi.fn(),
    buildSnapshot: vi.fn(async () => null),
    makeHooks: vi.fn(() => ({
      onEvent: vi.fn(),
      onError: vi.fn(),
      onTreeUpdated: vi.fn(),
      onTreeCreated: vi.fn(),
      onReject: vi.fn(),
      onStreamAborted: vi.fn(),
    })),
    unsubscribeConn: vi.fn(),
    cancelGrace: vi.fn(),
    treeSubscribers: new Map(),
    treePresence: new Map(),
    socketRequestIds: new Set(),
    ...overrides,
  };
  return { ctx, sent, conn, latticeAgent, permissionRespond, conversationSend };
}

// ── P1-#11: WS 参数验证（zod schema 入口守卫，parse don't validate） ──────

describe('handleWsCommand 参数验证 (P1-#11 / zod schema)', () => {
  it('treeId 超长（>256 字符）返回 session.error', async () => {
    const { ctx, sent } = makeCtx();
    const longTreeId = 'x'.repeat(300);
    const msg = { type: 'session.create', treeId: longTreeId } as ClientMessage;

    await handleWsCommand(ctx, msg);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('session.error');
    expect((sent[0] as { message: string }).message).toContain('treeId');
  });

  it('sessionId 超长（>256 字符）返回 session.error', async () => {
    const { ctx, sent } = makeCtx();
    const longSessionId = 'x'.repeat(300);
    const msg = {
      type: 'session.send',
      sessionId: longSessionId,
      message: 'hello',
    } as ClientMessage;

    await handleWsCommand(ctx, msg);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('session.error');
    expect((sent[0] as { message: string }).message).toContain('sessionId');
  });

  it('nodeIds 超数量（>1000）返回 session.error', async () => {
    const { ctx, sent } = makeCtx();
    const manyNodeIds = Array.from({ length: 1001 }, (_, i) => `node-${i}`);
    const msg = {
      type: 'tree.delete',
      treeId: 'tree-1',
      nodeIds: manyNodeIds,
    } as ClientMessage;

    await handleWsCommand(ctx, msg);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('session.error');
    expect((sent[0] as { message: string }).message).toContain('nodeIds');
  });

  it('message 超大（>200K 字符）返回 session.error', async () => {
    const { ctx, sent } = makeCtx();
    const hugeMessage = 'x'.repeat(200_001);
    const msg = {
      type: 'session.send',
      sessionId: 'sess-1',
      message: hugeMessage,
    } as ClientMessage;

    await handleWsCommand(ctx, msg);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('session.error');
    expect((sent[0] as { message: string }).message).toContain('message');
  });

  it('正常长度消息通过验证，进入命令处理', async () => {
    const { ctx, sent, conversationSend } = makeCtx();
    const msg = {
      type: 'session.send',
      sessionId: 'sess-ok',
      message: 'hello world',
    } as ClientMessage;

    await handleWsCommand(ctx, msg);

    // 未被拦截：session.error 不应出现
    const errors = sent.filter((m) => m.type === 'session.error');
    expect(errors).toHaveLength(0);
    // conversation.send 被调用（说明进入了 case 分支）
    expect(conversationSend).toHaveBeenCalledOnce();
  });

  it("非字符串 treeId（number）被 schema 拒绝，返回 session.error（parse, don't validate）", async () => {
    const { ctx, sent } = makeCtx();
    // 旧手写守卫对非 string 放行留给业务判断；zod 化后类型不符在入口即拒
    const msg = { type: 'session.create', treeId: 12345 } as unknown as ClientMessage;

    await expect(handleWsCommand(ctx, msg)).resolves.not.toThrow();
    const validationErrors = sent.filter(
      (m) => m.type === 'session.error' && (m as { message: string }).message.includes('treeId'),
    );
    expect(validationErrors).toHaveLength(1);
    expect((validationErrors[0] as { message: string }).message).toContain('Invalid parameters');
  });

  it('非字符串 treeId（null）被 schema 拒绝，不崩溃', async () => {
    const { ctx, sent } = makeCtx();
    const msg = { type: 'session.create', treeId: null } as unknown as ClientMessage;

    await expect(handleWsCommand(ctx, msg)).resolves.not.toThrow();
    const validationErrors = sent.filter(
      (m) => m.type === 'session.error' && (m as { message: string }).message.includes('treeId'),
    );
    expect(validationErrors).toHaveLength(1);
  });

  it('嵌套 segments 递归校验：未知段 type 被拒绝', async () => {
    const { ctx, sent, conversationSend } = makeCtx();
    const msg = {
      type: 'session.send',
      sessionId: 's1',
      message: 'hi',
      segments: [{ type: 'bogus', text: 'x' }],
    } as unknown as ClientMessage;

    await handleWsCommand(ctx, msg);

    expect(conversationSend).not.toHaveBeenCalled();
    const errors = sent.filter((m) => m.type === 'session.error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toContain('segments');
    // 保留现有错误响应形态：session.error 带 'sessionId' in msg 提取的 sessionId
    expect((errors[0] as { sessionId: string }).sessionId).toBe('s1');
  });

  it('safeParse 失败的 session.error 透传原消息 requestId（携带时回传，便于客户端路由到对应 turn）', async () => {
    const { ctx, sent } = makeCtx();
    // session.send 带 requestId 但 message 超长 → safeParse 失败
    const msg = {
      type: 'session.send',
      sessionId: 'sess-rid',
      message: 'x'.repeat(200_001),
      requestId: 'req-xyz',
    } as ClientMessage;

    await handleWsCommand(ctx, msg);

    const errors = sent.filter((m) => m.type === 'session.error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { requestId?: string }).requestId).toBe('req-xyz');
  });

  it('safeParse 失败且原消息无 requestId → session.error.requestId 为 undefined（类型可选，不报错）', async () => {
    const { ctx, sent } = makeCtx();
    // session.create 无 requestId 字段，且 treeId 超长 → safeParse 失败
    const msg = { type: 'session.create', treeId: 'x'.repeat(300) } as ClientMessage;

    await handleWsCommand(ctx, msg);

    const errors = sent.filter((m) => m.type === 'session.error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { requestId?: string }).requestId).toBeUndefined();
  });
});

// ── P1-#12: permission.respond 归属校验 ────────────────────────────

describe('permission.respond 归属校验 (P1-#12)', () => {
  it('合法归属的 permission.respond 正常转发，并从 pendingPermissions 中移除', async () => {
    const conn = makeConn();
    conn.pendingPermissions.add('req-123');
    const { ctx, sent, permissionRespond } = makeCtx({ conn });

    const msg = {
      type: 'permission.respond',
      requestId: 'req-123',
      allowed: true,
    } as ClientMessage;

    await handleWsCommand(ctx, msg);

    expect(permissionRespond).toHaveBeenCalledWith('req-123', true);
    expect(conn.pendingPermissions.has('req-123')).toBe(false);
    // 不应发出 session.error
    expect(sent.filter((m) => m.type === 'session.error')).toHaveLength(0);
  });

  it('非归属连接的 permission.respond 被拒绝，返回 Unauthorized session.error', async () => {
    const conn = makeConn();
    // pendingPermissions 不含 'req-456'
    const { ctx, sent, permissionRespond } = makeCtx({ conn });

    const msg = {
      type: 'permission.respond',
      requestId: 'req-456',
      allowed: true,
    } as ClientMessage;

    await handleWsCommand(ctx, msg);

    expect(permissionRespond).not.toHaveBeenCalled();
    const errors = sent.filter((m) => m.type === 'session.error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toContain('Unauthorized');
  });

  it('重复 respond：第一次成功，第二次被拒绝（pendingPermissions 已删除）', async () => {
    const conn = makeConn();
    conn.pendingPermissions.add('req-789');
    const { ctx, sent, permissionRespond } = makeCtx({ conn });

    const msg = {
      type: 'permission.respond',
      requestId: 'req-789',
      allowed: true,
    } as ClientMessage;

    // 第一次：合法
    await handleWsCommand(ctx, msg);
    expect(permissionRespond).toHaveBeenCalledTimes(1);
    expect(conn.pendingPermissions.has('req-789')).toBe(false);

    // 第二次：已被删除，应被拒绝
    await handleWsCommand(ctx, msg);
    expect(permissionRespond).toHaveBeenCalledTimes(1); // 未增加
    const errors = sent.filter((m) => m.type === 'session.error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toContain('Unauthorized');
  });

  it('无 requestId 的 permission.respond 被 schema 拒绝（入口即拒，不进入 switch）', async () => {
    const conn = makeConn();
    const { ctx, sent, permissionRespond } = makeCtx({ conn });

    const msg = { type: 'permission.respond', allowed: true } as unknown as ClientMessage;

    await expect(handleWsCommand(ctx, msg)).resolves.not.toThrow();
    expect(permissionRespond).not.toHaveBeenCalled();
    // zod 化后缺必填在入口回 session.error（旧手写守卫是静默 break）
    const errors = sent.filter((m) => m.type === 'session.error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toContain('Invalid parameters');
  });
});

// ── P1-#12 fix: 多连接权限请求归属过滤 ──────────────────────────

describe('forwardPermissionRequest session 归属过滤 (P1-#12 fix)', () => {
  const basePayload: PermissionRequestPayload = {
    request: { id: 'req-perm-1', tool: 'writeFile', args: { path: '/repo/a.ts' }, level: 'ask' },
    sessionId: 'sess-owner',
  };

  it('持有 session 的连接收到权限请求，pendingPermissions 记录 requestId', () => {
    const conn = makeConn();
    conn.sessions.add('sess-owner');
    const sent: ServerMessage[] = [];

    forwardPermissionRequest(conn, basePayload, (msg) => sent.push(msg));

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('permission.request');
    expect((sent[0] as { requestId: string }).requestId).toBe('req-perm-1');
    expect(conn.pendingPermissions.has('req-perm-1')).toBe(true);
  });

  it('不持有 session 的连接不收到权限请求，pendingPermissions 不记录', () => {
    const conn = makeConn();
    // conn.sessions 为空，不含 'sess-owner'
    const sent: ServerMessage[] = [];

    forwardPermissionRequest(conn, basePayload, (msg) => sent.push(msg));

    expect(sent).toHaveLength(0);
    expect(conn.pendingPermissions.has('req-perm-1')).toBe(false);
  });

  it('无 sessionId 的请求不转发（fail-closed）', () => {
    const conn = makeConn();
    conn.sessions.add('sess-owner');
    const sent: ServerMessage[] = [];
    const noSessionPayload: PermissionRequestPayload = {
      request: { id: 'req-no-sess', tool: 'writeFile', args: {}, level: 'ask' },
    };

    forwardPermissionRequest(conn, noSessionPayload, (msg) => sent.push(msg));

    expect(sent).toHaveLength(0);
    expect(conn.pendingPermissions.has('req-no-sess')).toBe(false);
  });
});

describe('多连接场景：权限请求只发给发起连接 (P1-#12 fix)', () => {
  it('connA 持有 session → 只有 connA 能 respond，connB 被拒绝', async () => {
    const connA = makeConn({ id: 'conn-a' });
    const connB = makeConn({ id: 'conn-b' });
    connA.sessions.add('sess-shared');
    // connB 不持有 'sess-shared'

    const payload: PermissionRequestPayload = {
      request: { id: 'req-multi', tool: 'writeFile', args: { path: '/repo/b.ts' }, level: 'ask' },
      sessionId: 'sess-shared',
    };

    // 模拟全局事件广播：两个连接的 listener 都被触发
    const fwdA: ServerMessage[] = [];
    const fwdB: ServerMessage[] = [];
    forwardPermissionRequest(connA, payload, (msg) => fwdA.push(msg));
    forwardPermissionRequest(connB, payload, (msg) => fwdB.push(msg));

    // 只有 connA 收到 permission.request
    expect(fwdA).toHaveLength(1);
    expect(fwdB).toHaveLength(0);
    expect(connA.pendingPermissions.has('req-multi')).toBe(true);
    expect(connB.pendingPermissions.has('req-multi')).toBe(false);

    // connB 尝试 respond → 被拒绝（Unauthorized）
    const { ctx: ctxB, sent: sentB, permissionRespond: permRespondB } = makeCtx({ conn: connB });
    const errorsBefore = sentB.filter((m) => m.type === 'session.error');
    await handleWsCommand(ctxB, {
      type: 'permission.respond',
      requestId: 'req-multi',
      allowed: true,
    } as ClientMessage);
    const errorsAfter = sentB.filter((m) => m.type === 'session.error');
    expect(errorsAfter.length - errorsBefore.length).toBe(1);
    expect((errorsAfter[errorsAfter.length - 1] as { message: string }).message).toContain(
      'Unauthorized',
    );
    expect(permRespondB).not.toHaveBeenCalled();

    // connA 尝试 respond → 正常转发
    const { ctx: ctxA, permissionRespond: permRespondA } = makeCtx({ conn: connA });
    await handleWsCommand(ctxA, {
      type: 'permission.respond',
      requestId: 'req-multi',
      allowed: true,
    } as ClientMessage);
    expect(permRespondA).toHaveBeenCalledWith('req-multi', true);
    expect(connA.pendingPermissions.has('req-multi')).toBe(false);
  });

  it('两个连接持有不同 session → 各自只收到自己 session 的权限请求', () => {
    const connA = makeConn({ id: 'conn-a' });
    const connB = makeConn({ id: 'conn-b' });
    connA.sessions.add('sess-a');
    connB.sessions.add('sess-b');

    const payloadA: PermissionRequestPayload = {
      request: { id: 'req-a', tool: 'writeFile', args: {}, level: 'ask' },
      sessionId: 'sess-a',
    };
    const payloadB: PermissionRequestPayload = {
      request: { id: 'req-b', tool: 'runCommand', args: {}, level: 'ask' },
      sessionId: 'sess-b',
    };

    const sentA: ServerMessage[] = [];
    const sentB: ServerMessage[] = [];
    // 广播 payloadA
    forwardPermissionRequest(connA, payloadA, (msg) => sentA.push(msg));
    forwardPermissionRequest(connB, payloadA, (msg) => sentB.push(msg));
    // 广播 payloadB
    forwardPermissionRequest(connA, payloadB, (msg) => sentA.push(msg));
    forwardPermissionRequest(connB, payloadB, (msg) => sentB.push(msg));

    // connA 只收到 req-a，connB 只收到 req-b
    expect(sentA).toHaveLength(1);
    expect((sentA[0] as { requestId: string }).requestId).toBe('req-a');
    expect(sentB).toHaveLength(1);
    expect((sentB[0] as { requestId: string }).requestId).toBe('req-b');
    expect(connA.pendingPermissions.has('req-a')).toBe(true);
    expect(connA.pendingPermissions.has('req-b')).toBe(false);
    expect(connB.pendingPermissions.has('req-b')).toBe(true);
    expect(connB.pendingPermissions.has('req-a')).toBe(false);
  });
});

describe('session 归属追踪 (P1-#12 fix)', () => {
  it('session.create 后 conn.sessions 包含新 sessionId', async () => {
    const { ctx, sent, latticeAgent } = makeCtx();
    (latticeAgent.sources.registry.getSource as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await handleWsCommand(ctx, { type: 'session.create', agentId: 'qoder' } as ClientMessage);

    const created = sent.find((m) => m.type === 'session.created') as
      | { sessionId: string }
      | undefined;
    expect(created).toBeTruthy();
    expect(ctx.conn.sessions.has(created!.sessionId)).toBe(true);
  });

  it('session.send 后 conn.sessions 包含该 sessionId', async () => {
    const { ctx } = makeCtx();

    await handleWsCommand(ctx, {
      type: 'session.send',
      sessionId: 'sess-send-1',
      message: 'hello',
    } as ClientMessage);

    expect(ctx.conn.sessions.has('sess-send-1')).toBe(true);
  });
});
