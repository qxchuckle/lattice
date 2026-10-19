import { defineProject } from 'vitest/config';
import { sharedAliases } from '../../vitest.shared';

export default defineProject({
  // Vite 8 默认由 oxc 处理 .tsx（automatic JSX），无需 React 插件 / esbuild 覆盖
  resolve: { alias: sharedAliases },
  test: {
    name: 'web-ui',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
