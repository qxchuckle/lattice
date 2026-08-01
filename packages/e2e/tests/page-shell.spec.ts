// spec: specs/rest-api-and-page-shell.md
// seed: tests/seed.spec.ts
//
// 由 Playwright Test Generator 工作流生成（自然语言计划 → 静态代码，commit 模式）。
// CI 纯执行：playwright test 直接运行，无需 LLM。
// 覆盖一期未触及的「页面壳 + 同源 REST 可达性」——浏览器加载页面壳后可同源 fetch API。
import { test, expect } from '@playwright/test';

test.describe('页面壳同源可达性', () => {
  test('baseURL 加载页面壳且同源 REST 可达', async ({ page }) => {
    // 1. page.goto('/')
    // Expected: 页面加载不抛错（响应 200）— goto 默认等 load 并在非 2xx 抛错
    await page.goto('/');

    // 2. 在浏览器上下文 fetch('/health')（同源请求）
    const result = await page.evaluate(async () => {
      const res = await fetch('/health');
      const body = (await res.json()) as { status: string };
      return { ok: res.ok, status: body.status };
    });

    // Expected: 同源 fetch /health 返回 res.ok() 且 body.status === 'ok'
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
  });
});
