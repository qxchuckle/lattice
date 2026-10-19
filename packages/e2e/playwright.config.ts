import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const HOME = resolve(here, '.tmp-e2e-home');
const PORT = 14529;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // 共享单实例服务器与同一数据根：串行执行，避免写操作相互干扰
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/prepare-fixture.mjs && node scripts/web-server.mjs',
    url: `${BASE_URL}/api/stats`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      LATTICE_HOME: HOME,
      LATTICE_WEB_NO_OPEN: '1',
    },
  },
});
