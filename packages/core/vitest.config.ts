import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    // 硬离线：测试环境禁用语义模型加载，避免下载/初始化模型拖慢或访问网络
    env: { LATTICE_DISABLE_SEMANTIC: '1' },
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
