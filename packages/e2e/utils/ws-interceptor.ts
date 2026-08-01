/**
 * WS 测试辅助工具 — 在浏览器 page 上下文中创建/管理 WS 连接
 *
 * Playwright page.evaluate 在浏览器中执行函数；本模块封装了：
 *   - connectWs：建立 WS 连接 + 消息收集器（存于 window.__messages）
 *   - sendWs：发送 ClientMessage
 *   - getMessages / waitForMessage：查询/等待特定消息
 *   - closeWs：关闭连接
 */
import type { Page } from '@playwright/test';

interface WsMessage {
  type: string;
  // biome-ignore lint/suspicious/noExplicitAny: test utility — WS 消息字段类型多变，用 any 便于断言
  [key: string]: any;
}

/** 在浏览器中建立 WS 连接 + 初始化消息收集器 */
export async function connectWs(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    const ws = new WebSocket(`ws://${location.host}/api/agent/ws`);
    (window as unknown as Record<string, unknown>).__ws = ws;
    (window as unknown as Record<string, unknown>).__messages = [] as unknown[];
    ws.onmessage = (e: MessageEvent) => {
      const msgs = (window as unknown as Record<string, unknown[]>).__messages;
      msgs.push(JSON.parse(e.data as string));
    };
    (window as unknown as Record<string, unknown>).__wsReady = new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
    });
  });
  const ready = await page.evaluate(
    () => (window as unknown as { __wsReady: Promise<boolean> }).__wsReady,
  );
  if (!ready) throw new Error('WS connection failed');
}

/** 发送 ClientMessage */
export async function sendWs(page: Page, msg: Record<string, unknown>): Promise<void> {
  await page.evaluate((m) => {
    const ws = (window as unknown as { __ws: WebSocket }).__ws;
    ws.send(JSON.stringify(m));
  }, msg);
}

/** 获取当前已收集的全部消息 */
export async function getMessages(page: Page): Promise<WsMessage[]> {
  return page.evaluate(() => (window as unknown as { __messages: WsMessage[] }).__messages ?? []);
}

/** 等待匹配特定条件的消息（轮询，超时抛错） */
export async function waitForMessage(
  page: Page,
  predicate: (msg: WsMessage) => boolean,
  timeoutMs = 10_000,
): Promise<WsMessage> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const msgs = await getMessages(page);
    const found = msgs.find(predicate);
    if (found) return found;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timeout waiting for message matching predicate after ${timeoutMs}ms`);
}

/** 等待特定 type 的消息 */
export async function waitForMessageType(
  page: Page,
  type: string,
  timeoutMs = 10_000,
): Promise<WsMessage> {
  return waitForMessage(page, (m) => m.type === type, timeoutMs);
}

/** 清空已收集的消息（测试分阶段时重置消息缓冲） */
export async function clearMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown[]>).__messages = [];
  });
}

/** 关闭 WS 连接 */
export async function closeWs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ws = (window as unknown as { __ws?: WebSocket }).__ws;
    ws?.close();
  });
}
