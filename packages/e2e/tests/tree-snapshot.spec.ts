/**
 * Tree Snapshot 一致性 E2E — 快照字段完整性与事件一致性
 *
 * 验证：
 *   1. session.send 建树后 subscribe → 收到 tree.snapshot
 *   2. snapshot 字段一致性（rev / nodes / branches / headNodeId / conversation）
 *   3. 第二轮 send 后 snapshot rev 递增、nodes 增长
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

test.describe('tree snapshot', () => {
  test('snapshot 字段一致性 + rev 递增', async ({ page }) => {
    await connectWs(page);

    // 创建 session
    await sendWs(page, { type: 'session.create', agentId: 'mock' });
    const sessionCreated = await waitForMessageType(page, 'session.created');
    const sessionId = sessionCreated.sessionId as string;

    // 发首条消息建树
    await sendWs(page, {
      type: 'session.send',
      sessionId,
      message: 'First turn',
    });

    // 等 onTreeCreated
    const treeCreated = await waitForMessage(
      page,
      (m) => m.type === 'session.created' && typeof m.treeId === 'string' && m.treeId !== '',
    );
    const treeId = treeCreated.treeId as string;

    // 等轮次完成
    await waitForMessageType(page, 'tree.updated');

    // 订阅树 → 收到 snapshot
    await sendWs(page, { type: 'tree.subscribe', treeId, clientKind: 'web' });
    const snap1 = await waitForMessageType(page, 'tree.snapshot');

    // 字段一致性
    expect(snap1.treeId).toBe(treeId);
    expect(typeof snap1.rev).toBe('number');
    expect(Array.isArray(snap1.nodes)).toBe(true);
    expect(snap1.nodes.length).toBeGreaterThan(0);
    expect(snap1.conversation).toBeTruthy();
    expect(snap1.conversation.treeId).toBe(treeId);
    expect(typeof snap1.conversation.nodeCount).toBe('number');
    expect(typeof snap1.expectedNextRev).toBe('number');
    expect(snap1.expectedNextRev).toBe((snap1.rev as number) + 1);
    expect(typeof snap1.snapshotTakenAt).toBe('number');

    const rev1 = snap1.rev as number;
    const nodeCount1 = snap1.nodes.length;

    // 清空消息，发第二轮
    await clearMessages(page);
    await sendWs(page, {
      type: 'session.send',
      sessionId,
      message: 'Second turn',
    });

    // 等待新 snapshot（rev 递增）
    const snap2 = await waitForMessage(
      page,
      (m) => m.type === 'tree.snapshot' && typeof m.rev === 'number' && m.rev > rev1,
    );

    expect(snap2.rev).toBeGreaterThan(rev1);
    expect(snap2.nodes.length).toBeGreaterThan(nodeCount1);

    await closeWs(page);
  });
});
