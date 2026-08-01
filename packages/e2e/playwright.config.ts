/**
 * Playwright 配置 — E2E 测试入口
 *
 * 架构：
 *   webServer 启动 fixtures/server-setup.ts（tsx 运行 TypeScript 源码）
 *   → createE2EServer 构造 mock agent + Fastify + WS/REST 路由
 *   → 健康检查 /health 就绪后跑测试
 *
 * 约定：
 *   - 单 worker（共享 server 状态，多 client 操作同一棵树）
 *   - 不并行（E2E 测试有时序依赖）
 *   - chromium 优先（一期传统 E2E；多 browser context 已覆盖多客户端同步）
 */
import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const PORT = 14530;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'tsx fixtures/server-setup.ts',
    cwd: resolve(__dirname),
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
