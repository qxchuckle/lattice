import { defineProject } from 'vitest/config';

/**
 * agent-source 测试配置
 * - 映射纯函数（mapQoderMessage / mapPiEvent）：SDK 消息 → SourceEvent 契约
 */
export default defineProject({
  test: {
    name: 'agent-source',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
