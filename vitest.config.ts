import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * 全仓统一测试入口（vitest projects）
 *
 * - core / cli / agent：node 环境（各包 vitest.config.ts 用 defineProject 声明）
 * - examples/minimal-host：三包宿主故事线的验收测试（脚本化 driver，不碰真实 SDK）
 * - web：jsdom 环境（配置在 packages/web/vite.config.ts 的 test 段）
 * - 运行：pnpm test（全量）/ pnpm vitest --project <name>（单包）
 * - 跨包引用通过 resolve.alias 直指源码，改完即测，无需先 build
 * - coverage 仅在根配置（projects 不支持局部 coverage）
 */
export default defineConfig({
  resolve: {
    alias: {
      // 子路径在前（前缀匹配优先）
      '@qcqx/lattice-agent-protocol/schemas': resolve(
        __dirname,
        'packages/agent-protocol/src/schemas.ts',
      ),
      '@qcqx/lattice-agent-source/testing': resolve(
        __dirname,
        'packages/agent-source/src/testing/index.ts',
      ),
      '@qcqx/lattice-agent-protocol': resolve(__dirname, 'packages/agent-protocol/src/index.ts'),
      '@qcqx/lattice-agent-source': resolve(__dirname, 'packages/agent-source/src/index.ts'),
      '@qcqx/lattice-agent-pipeline': resolve(__dirname, 'packages/agent-pipeline/src/index.ts'),
      '@qcqx/lattice-foundation': resolve(__dirname, 'packages/foundation/src/index.ts'),
      '@qcqx/lattice-core': resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
  test: {
    // e2e 包走 Playwright（pnpm e2e），不进 vitest；此 exclude 为纵深防御
    exclude: ['packages/e2e/**'],
    projects: [
      'packages/foundation',
      'packages/core',
      'packages/cli',
      'packages/agent',
      'packages/agent-protocol',
      'packages/agent-source',
      'packages/agent-source-builtins',
      'packages/agent-pipeline',
      'packages/web',
      'examples/minimal-host',
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
      // 覆盖率门槛（防回退水位）：目标 lines≥85% / branches≥75%
      // 当前基线（2026-07-31）：Stmts 16.45% / Branch 15.49% / Funcs 19.6% / Lines 16.48%
      // cli 为 E2E 只测 dist 子进程（src 无插桩）、web 客户端组件覆盖不足，现状远低于目标，
      // 故先按略低于现状设防回退门槛，随覆盖率提升逐步上调至目标值
      thresholds: {
        statements: 15.5,
        branches: 14.5,
        functions: 18.5,
        lines: 15.5,
      },
    },
  },
});
