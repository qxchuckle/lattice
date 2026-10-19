import { defineConfig } from 'vitest/config';

/**
 * 全仓统一测试入口（vitest projects）。
 *
 * - 单测/集成直测各包 src（跨包 alias 见 vitest.shared.ts，各包 project 配置显式引入）；CLI E2E 只读 dist（需先 pnpm build）
 * - projects 聚合各包（各包 vitest.config.ts 用 defineProject 声明 environment）
 * - coverage 仅在根配置（projects 不支持项目级 coverage）
 */
export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/services', 'packages/web', 'packages/vscode'],
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
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // 覆盖率门槛（防回退水位）：2026-10-19 基线 Stmts 15.27 / Br 12.55 / Funcs 17.02 / Lines 15.33
      // 策略：基线-1pt 起步，随补测（P2-P4）逐步上调，长期目标 lines≥85 / branches≥75
      thresholds: {
        statements: 14.2,
        branches: 11.5,
        functions: 16,
        lines: 14.3,
      },
    },
  },
});
