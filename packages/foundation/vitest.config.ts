import { defineProject } from 'vitest/config';

/**
 * foundation 测试配置 — 零依赖基础层单测
 */
export default defineProject({
  test: {
    name: 'foundation',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
