import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'cli',
    environment: 'node',
    // tests/e2e：子进程跑构建产物 dist/index.js（测试不触发构建，先 pnpm build:cli）
    // tests/in-process：进程内 harness（register* + parseAsync），计入 v8 覆盖率
    include: ['tests/e2e/**/*.test.ts', 'tests/in-process/**/*.test.ts'],
    // 每个用例都要 spawn CLI 子进程（init 约 3-8s），放宽超时
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
