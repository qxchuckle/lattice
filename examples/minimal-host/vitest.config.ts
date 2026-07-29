import { defineProject } from 'vitest/config';

/**
 * minimal-host 验收测试配置
 * - 用脚本化 driver 验证「三包 + 会话簿记 = 完整宿主」，宿主代码零源判断
 */
export default defineProject({
  test: {
    name: 'minimal-host',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
