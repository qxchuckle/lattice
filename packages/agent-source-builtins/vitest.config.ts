import { defineProject } from 'vitest/config';

/**
 * agent-source-builtins 测试配置
 * - 内置源（Pi / Qoder / ACP）实现行为测试
 */
export default defineProject({
  test: {
    name: 'agent-source-builtins',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
