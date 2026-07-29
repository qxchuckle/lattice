import { defineConfig } from 'vitest/config';

/**
 * 全仓统一测试入口（vitest projects）
 *
 * - core / cli / agent：node 环境（各包 vitest.config.ts 用 defineProject 声明）
 * - web：jsdom 环境（配置在 packages/web/vite.config.ts 的 test 段）
 * - 运行：pnpm test（全量）/ pnpm vitest --project <name>（单包）
 * - 约定：先 pnpm build 再 pnpm test（cli E2E 只读 dist，不触发构建）
 * - coverage 仅在根配置（projects 不支持局部 coverage）
 */
export default defineConfig({
  test: {
    projects: [
      'packages/core',
      'packages/cli',
      'packages/agent',
      'packages/agent-source',
      'packages/web',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: [
        '**/dist/**',
        '**/*.d.ts',
        '**/*.test.*',
        '**/test/**',
        '**/tests/**',
        // 模板资产与纯类型
        'packages/core/src/template-assets.ts',
        'packages/core/src/types/**',
      ],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
