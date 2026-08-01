/**
 * 断线重连恢复 E2E — 客户端断连后重新订阅恢复树快照
 *
 * 验证：
 *   1. 建立 session + 首条消息建树 → 订阅获取 snapshot
 *   2. 关闭 WS（断线）→ 重新连接 → 订阅同一棵树 → 恢复相同 snapshot
 *   3. 重连后可继续 session.send → 收到 stream.event + tree.updated
 *
 * 架构：单 browser context，通过 connectWs/closeWs 模拟断线重连。
 */
import { test, expect } from '@playwright/test';
import {
  connectWs,
  sendWs,
  waitForMessage,
  waitForMessageType,
  clearMessages,
  closeWs,
} from '../utils/ws-interceptor';

test.describe('recovery', () => {
  test('断线重连后恢复树快照 + 继续对话', async ({ page }) => {
    // ── 第一阶段：建立 session + 树 ──
    await connectWs(page);

    await sendWs(page, { type: 'session.create', agentId: 'mock' });
    const sessionCreated = await waitForMessageType(page, 'session.created');
    const sessionId = sessionCreated.sessionId as string;
    expect(sessionId).toBeTruthy();

    await sendWs(page, {
      type: 'session.send',
      sessionId,
      message: 'Before disconnect',
    });

    // 等 onTreeCreated
    const treeCreated = await waitForMessage(
      page,
      (m) => m.type === 'session.created' && typeof m.treeId === 'string' && m.treeId !== '',
    );
    const treeId = treeCreated.treeId as string;
    expect(treeId).toBeTruthy();

    // 等轮次完成
    await waitForMessageType(page, 'tree.updated');

    // 订阅获取 snapshot
    await sendWs(page, { type: 'tree.subscribe', treeId, clientKind: 'web' });
    const snap1 = await waitForMessageType(page, 'tree.snapshot');
    const rev1 = snap1.rev as number;
    const nodeCount1 = (snap1.nodes as unknown[]).length;
    expect(nodeCount1).toBeGreaterThan(0);

    // 记录 session agentId（重连后重新 create session 用同一 sourceId）
    const agentId = sessionCreated.agentId as string;

    // ── 第二阶段：断线 ──
    await closeWs(page);
    // 给 server 一点时间处理 close（unsubscribe + grace timer 启动）
    await page.waitForTimeout(500);

    // ── 第三阶段：重连 ──
    await connectWs(page);

    // 重新创建 session（新连接、新 session，但同一 sourceId → 同一 mock 源）
    await sendWs(page, { type: 'session.create', agentId });
    const session2 = await waitForMessageType(page, 'session.created');
    const sessionId2 = session2.sessionId as string;
    expect(sessionId2).toBeTruthy();

    // 订阅之前的树 → 恢复 snapshot
    await sendWs(page, { type: 'tree.subscribe', treeId, clientKind: 'web' });
    const snap2 = await waitForMessageType(page, 'tree.snapshot');

    // 快照一致：rev 和 nodes 数量应与断线前相同
    expect(snap2.treeId).toBe(treeId);
    expect(snap2.rev).toBe(rev1);
    expect((snap2.nodes as unknown[]).length).toBe(nodeCount1);

    // ── 第四阶段：重连后继续对话 ──
    await clearMessages(page);
    await sendWs(page, {
      type: 'session.send',
      sessionId: sessionId2,
      message: 'After reconnect',
    });

    // 新连接的 session 是新 session → 会建新树，不会在旧树上继续
    // 但 session.send 应成功 → 收到 event + tree.updated
    await waitForMessageType(page, 'event');
    await waitForMessageType(page, 'tree.updated');

    await closeWs(page);
  });
});
