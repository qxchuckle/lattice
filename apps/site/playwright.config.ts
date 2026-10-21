import { defineConfig, devices } from '@playwright/test';

const port = 4321;
const origin = `http://127.0.0.1:${port}`;
const previewURL = `${origin}/lattice/`;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Astro auto-backgrounds preview servers when it detects an agent; keep it foreground.
    command: `pnpm preview --host 127.0.0.1 --port ${port} --ignore-lock`,
    url: previewURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
