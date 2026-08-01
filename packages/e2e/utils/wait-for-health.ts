/**
 * 健康检查工具 — 等待 E2E server 就绪
 *
 * Playwright webServer 自带 health-check（url 探测），但测试中
 * 也可能需要手动等待特定端点就绪（如 agent 初始化完成）。
 */

/** 轮询健康检查端点直到就绪或超时 */
export async function waitForHealth(
  url: string,
  timeoutMs = 10_000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(intervalMs) });
      if (res.ok) return;
    } catch {
      // server 尚未就绪，继续轮询
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Health check timeout: ${url} not ready within ${timeoutMs}ms`);
}

/** 等待 WS 端点可连接（通过 HTTP upgrade 探测） */
export async function waitForWs(baseUrl: string, timeoutMs = 10_000): Promise<void> {
  const url = `${baseUrl}/api/agent/sources`;
  return waitForHealth(url, timeoutMs);
}
