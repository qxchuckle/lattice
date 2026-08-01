/**
 * 多客户端同步 E2E — Playwright 多 browser context
 *
 * 测试矩阵：
 *   1. presence sync：两端订阅同一树 → presence.state 互播
 *   2. session sync：一端 session.send → 他端收到 stream.event + tree.snapshot 广播
 *
 * 架构：两个 browser context 各自 page.evaluate 创建 WS 连接，
 * 通过 ws-interceptor 辅助发送 ClientMessage / 收集 ServerMessage。
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  connectWs,
  sendWs,
  waitForMessage,
  waitForMessageType,
  clearMessages,
  closeWs,
} from '../utils/ws-interceptor';

test.describe('multi-client sync', () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeEach(async ({ browser }) => {
    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();
  });

  test.afterEach(async () => {
    await closeWs(pageA).catch(() => {});
    await closeWs(pageB).catch(() => {});
    await ctxA.close();
    await ctxB.close();
  });

  test('presence sync：两端订阅同一树 → presence.state 互播', async () => {
    await connectWs(pageA);
    await connectWs(pageB);

    const treeId = `e2e-presence-${Date.now()}`;

    // Client A 订阅 + 发 presence.update
    await sendWs(pageA, { type: 'tree.subscribe', treeId, clientKind: 'web' });
    await sendWs(pageA, { type: 'presence.update', treeId, focusNodeId: null, typing: false });
    // A 收到含自己的 presence.state
    const presenceA1 = await waitForMessage(
      pageA,
      (m) => m.type === 'presence.state' && m.peers?.length === 1,
    );
    expect(presenceA1.peers).toHaveLength(1);

    // Client B 订阅 + 发 presence.update → 触发互播
    await sendWs(pageB, { type: 'tree.subscribe', treeId, clientKind: 'web' });
    await sendWs(pageB, { type: 'presence.update', treeId, focusNodeId: null, typing: false });

    // A 收到含两端在线的 presence.state
    const presenceA2 = await waitForMessage(
      pageA,
      (m) => m.type === 'presence.state' && m.peers?.length === 2,
    );
    expect(presenceA2.peers).toHaveLength(2);

    // B 也收到含两端在线的 presence.state
    const presenceB = await waitForMessage(
      pageB,
      (m) => m.type === 'presence.state' && m.peers?.length === 2,
    );
    expect(presenceB.peers).toHaveLength(2);
  });

  test('session sync：一端 session.send → 他端收到 stream.event + tree.snapshot', async () => {
    await connectWs(pageA);
    await connectWs(pageB);

    // ── Client A 创建 session ──
    await sendWs(pageA, { type: 'session.create', agentId: 'mock' });
    const sessionCreated = await waitForMessageType(pageA, 'session.created');
    const sessionId = sessionCreated.sessionId as string;
    expect(sessionId).toBeTruthy();

    // ── Client A 发送首条消息（建树） ──
    await sendWs(pageA, {
      type: 'session.send',
      sessionId,
      message: 'Hello from E2E',
    });

    // 等待 onTreeCreated → session.created 携 treeId
    const treeCreated = await waitForMessage(
      pageA,
      (m) => m.type === 'session.created' && typeof m.treeId === 'string' && m.treeId !== '',
    );
    const treeId = treeCreated.treeId as string;
    expect(treeId).toBeTruthy();

    // 等待 event（source 事件）+ tree.updated（轮次完成）
    await waitForMessageType(pageA, 'event');
    await waitForMessageType(pageA, 'tree.updated');

    // ── 两端订阅同一棵树 ──
    await sendWs(pageA, { type: 'tree.subscribe', treeId, clientKind: 'web' });
    await sendWs(pageB, { type: 'tree.subscribe', treeId, clientKind: 'web' });

    // 两端都应收到 tree.snapshot（subscribe 时 buildSnapshot 下发）
    await waitForMessageType(pageA, 'tree.snapshot');
    await waitForMessageType(pageB, 'tree.snapshot');

    // 清空消息缓冲，便于区分第二轮
    await clearMessages(pageA);
    await clearMessages(pageB);

    // ── Client A 发送第二条消息（树已存在 → 广播给订阅者） ──
    const requestId = `e2e-req-${Date.now()}`;
    await sendWs(pageA, {
      type: 'session.send',
      sessionId,
      message: 'Second message',
      requestId,
    });

    // Client B 应收到 stream.event 广播（他端在途流事件）
    const streamEvent = await waitForMessage(
      pageB,
      (m) => m.type === 'stream.event' && m.requestId === requestId,
    );
    expect(streamEvent).toBeTruthy();
    expect(streamEvent.event).toBeTruthy();

    // Client B 应收到 tree.snapshot 广播（轮次完成后 broadcastSnapshot）
    await waitForMessageType(pageB, 'tree.snapshot');

    // Client A 自身应收到 event + tree.updated
    await waitForMessage(pageA, (m) => m.type === 'event' && m.requestId === requestId);
    await waitForMessage(pageA, (m) => m.type === 'tree.updated' && m.requestId === requestId);
  });
});
