import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'cli',
    environment: 'node',
    // CLI E2E：子进程跑构建产物 dist/index.js（测试不触发构建，先 pnpm build:cli）
    include: ['tests/e2e/**/*.test.ts'],
    // 每个用例都要 spawn CLI 子进程（init 约 3-8s），放宽超时
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
