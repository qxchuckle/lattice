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
    projects: [
      'packages/core',
      'packages/services',
      'packages/web',
      'packages/vscode',
      'packages/cli',
      'packages/web-ui',
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
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // 覆盖率门槛（防回退水位）：一期 2026-10-19 首测基线 Stmts 15.27 / Br 12.55 / Funcs 17.02 / Lines 15.33，
      // 终值 16.5 / 13.0 / 18.5 / 16.5（232 用例）；
      // 二期 P1 上探（core 深挖，274 用例，实测 21.9 / 17.53 / 22.62 / 22.01）；
      // 二期 P2 上探（cli 进程内 harness，315 用例，实测 27.91 / 21.89 / 27.37 / 28.33）；
      // 二期 P3 上探（web-ui 图逻辑/树/http/hooks，377 用例，实测 31.28 / 25.6 / 30.89 / 31.72）。
      // 策略：水位 = 当前基线-~0.5pt，只升不降（长期目标 lines≥85 / branches≥75）
      thresholds: {
        statements: 30.8,
        branches: 25.1,
        functions: 30.3,
        lines: 31.2,
      },
    },
  },
});
