/**
 * 权限应答链 E2E — permission.respond 守卫 + 心跳
 *
 * 验证：
 *   1. permission.respond 对未知 requestId → session.error "Unauthorized permission response"
 *   2. ping → pong（连接存活心跳）
 *
 * 注：mock scripted driver 不声明 permissionModes（false），不触发 permission.request。
 * 完整 permission.request → respond 闭环测试需要 mock source 声明 toolCalling + permissionModes，
 * 作为后续增量在二期 AI+E2E 中接入。
 */
import { test, expect } from '@playwright/test';
import {
  connectWs,
  sendWs,
  waitForMessageType,
  waitForMessage,
  closeWs,
} from '../utils/ws-interceptor';

test.describe('permissions', () => {
  test('permission.respond 对未知 requestId → session.error', async ({ page }) => {
    await connectWs(page);

    // 发送对不存在 requestId 的 permission.respond → 守卫拒绝
    await sendWs(page, {
      type: 'permission.respond',
      requestId: 'nonexistent-req-id',
      allowed: true,
    });

    const errMsg = await waitForMessage(
      page,
      (m) => m.type === 'session.error' && typeof m.message === 'string',
    );
    expect(errMsg.message).toContain('Unauthorized permission response');

    await closeWs(page);
  });

  test('ping → pong（心跳存活）', async ({ page }) => {
    await connectWs(page);

    await sendWs(page, { type: 'ping' });
    const pong = await waitForMessageType(page, 'pong');
    expect(pong.type).toBe('pong');

    await closeWs(page);
  });
});
