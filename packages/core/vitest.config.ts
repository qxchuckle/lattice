import { defineProject } from 'vitest/config';

/**
 * core 测试配置
 * - L1 单测：与源码同目录的 src 下 *.test.ts（纯逻辑，无 IO）
 * - L2 集成：tests 下 *.test.ts（真实 SQLite，每用例 mkdtemp 一次性 LATTICE_HOME）
 */
export default defineProject({
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
