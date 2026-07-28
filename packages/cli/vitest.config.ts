import { defineProject } from 'vitest/config';

/**
 * cli 测试配置
 * - L3 E2E：tests/e2e 下 *.test.ts，子进程跑构建产物 dist/index.js（HOME 指向 mkdtemp 临时目录）
 * - 前置：先 pnpm build 再 pnpm test；测试中不触发构建
 */
export default defineProject({
  test: {
    name: 'cli',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // E2E 起子进程 + SQLite 初始化，放宽单用例超时
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
