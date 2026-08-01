/**
 * Seed test — Playwright Test Agents 环境种子文件
 *
 * 由 `npx playwright init-agents` 生成，已定制适配本仓库 e2e 环境。
 * Generator agent 会将此文件作为初始化模板复制进每个生成的测试。
 * 同时本身作为最小「环境就绪」冒烟测试（baseURL 可达 + health 端点 ok）。
 *
 * Playwright agents 约定：
 *   - 生成测试文件头部标注 `// spec: specs/<plan>.md` 与 `// seed: tests/seed.spec.ts`
 *   - 使用韧性定位器（getByRole/getByText/getByLabel），符合 Healer 推荐实践，
 *     降低选择器变化导致的脆弱性（Healer 自愈在 AI 编码助手中运行，需 LLM）。
 */
import { test, expect } from '@playwright/test';

test.describe('seed', () => {
  test('环境就绪：baseURL 可达 + health 端点 ok', async ({ page, request }) => {
    // 访问 baseURL（最小 HTML 占位页或 web 客户端构建，均返回 200）
    await page.goto('/');

    // 健康检查端点（Playwright webServer 探测同一端点）
    const health = await request.get('/health');
    expect(health.ok()).toBeTruthy();
    const body = await health.json();
    expect(body.status).toBe('ok');
  });
});
