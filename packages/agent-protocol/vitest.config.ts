import { defineProject } from 'vitest/config';

/**
 * agent-protocol 测试配置
 * - 共享纯函数（errorCategory / projectNodeCapabilities / content-builder）与 EventStream 语义
 */
export default defineProject({
  test: {
    name: 'agent-protocol',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
