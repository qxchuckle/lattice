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
      // 二期 P3 上探（web-ui 图逻辑/树/http/hooks，377 用例，实测 31.28 / 25.6 / 30.89 / 31.72）；
      // 二期 P4 上探（web 路由 20 + services 写用例 9，406 用例，实测 36.74 / 30.29 / 36.54 / 37.17）；
      // 二期 P5 分档（按包实测 −0.5pt）：core/services/web 高档，cli 中档，web-ui 起步档，vscode 低位防倒退。
      // 三期 P6（core 深挖 I：profile/git-ops/footprint/lookup/register/merge/relation/fast-start-log，444 用例，
      //   实测 40.40 / 33.43 / 39.23 / 40.96；core 80.23）。
      // 三期 P10（web 深水 + services 收口：server/index、git/domains、terminal、rag、scan，
      //   566 用例，实测 54.02 / 45.43 / 48.68 / 54.97；web 90.19、services 97.53）。
      // 策略：水位 = 当前基线-~0.5pt，只升不降（长期目标 lines≥85 / branches≥75）
      thresholds: {
        // 全局兜底（跨包汇总；单包水位见下）
        statements: 53.5,
        branches: 44.9,
        functions: 48.2,
        lines: 54.5,
        // 高档：领域能力 + 宿主共享用例（P1/P4/P6/P7/P8 深挖后）
        'packages/core/**': { lines: 92.2, branches: 76.9, functions: 90.4 },
        'packages/services/**': { lines: 97.0, branches: 78.5, functions: 88.8 },
        'packages/web/**': { lines: 89.7, branches: 69.5, functions: 92.0 },
        // 中档：CLI（进程内 harness 覆盖装配与逻辑；E2E 子进程不计 v8）
        'packages/cli/**': { lines: 77.6, branches: 66.2, functions: 82.0 },
        // 起步档：web-ui（纯逻辑/hooks 优先；组件深渲与 cytoscape 像素不在口径）
        'packages/web-ui/**': { lines: 18.4, branches: 16.9, functions: 16.7 },
        // 低位防倒退：vscode（宿主外集成；不 mock vscode API 换覆盖率）
        'packages/vscode/**': { lines: 7.9, branches: 9.7, functions: 9.9 },
      },
    },
  },
});
