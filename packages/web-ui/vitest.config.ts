import { defineProject } from 'vitest/config';
import { sharedAliases } from '../../vitest.shared';

export default defineProject({
  // Vite 8 默认由 oxc 处理 .tsx（automatic JSX），无需 React 插件 / esbuild 覆盖
  resolve: { alias: sharedAliases },
  test: {
    name: 'web-ui',
    // 硬离线：测试环境禁用语义模型加载，避免下载/初始化模型拖慢或访问网络
    env: { LATTICE_DISABLE_SEMANTIC: '1' },
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
