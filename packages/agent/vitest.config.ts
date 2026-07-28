import { defineProject } from 'vitest/config';

/**
 * agent 测试配置
 * - 由 scripts/verify-*.mts 断言脚本规范化迁移而来
 * - mock source + mkdtemp 临时目录，验证对话树/状态机/持久化等业务语义
 */
export default defineProject({
  test: {
    name: 'agent',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
