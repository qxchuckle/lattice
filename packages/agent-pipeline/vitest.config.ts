import { defineProject } from 'vitest/config';

/**
 * agent-pipeline 测试配置
 * - 策略表穷尽性 / profile 解析 / 管线相位与流透明 / 通用 middleware
 */
export default defineProject({
  test: {
    name: 'agent-pipeline',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
