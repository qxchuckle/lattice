import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = import.meta.dirname;
const webClient = resolve(here, '../../web-ui/src');

/**
 * Webview 冒烟构建（仅本地验证，不进 VSIX）：
 * - SSR/node 目标，产物跑到 Node + jsdom（tests/smoke/run.mjs）
 * - cytoscape / cytoscape-fcose 替换为替身（真实画布在 jsdom 中不可用；数据管线不受影响）
 * - noExternal: true → 依赖全部打进单文件，避免宿主 node_modules 解析差异
 */
export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  /**
   * node core 的模板资产模块用 CJS 的 __dirname 定位模板目录；SSR 产物是 ESM，
   * 这里把 __dirname 映射为等价物（冒烟不触发模板读取，仅保证模块可加载）。
   */
  define: {
    __dirname: 'import.meta.dirname',
  },
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'antd',
      '@ant-design/icons',
      '@tanstack/react-query',
      'react-router',
      'valtio',
    ],
    alias: [
      { find: /^@ant-design\/icons$/, replacement: resolve(here, 'src/smoke/icons-entry.ts') },
      { find: /^cytoscape$/, replacement: resolve(here, 'src/smoke/cytoscape-stub.ts') },
      {
        find: /^cytoscape-fcose$/,
        replacement: resolve(here, 'src/smoke/cytoscape-fcose-stub.ts'),
      },
      { find: '@lattice-web-ui', replacement: resolve(webClient, 'ui.ts') },
      // 冒烟跑完整 node core（数据服务在扩展宿主侧），而非浏览器面 browser.ts
      { find: '@qcqx/lattice-core', replacement: resolve(here, '../../core/src/index.ts') },
      { find: '@qcqx/lattice-services', replacement: resolve(here, '../../services/src/index.ts') },
      { find: '@qcqx/lattice-protocol', replacement: resolve(here, '../../protocol/src/index.ts') },
    ],
  },
  ssr: {
    noExternal: true,
    /** 原生/重型模块外置：冒烟环境用 node:sqlite（Node ≥22.5）或降级，不打包这些模块。 */
    external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers'],
  },
  build: {
    ssr: resolve(here, 'src/smoke/entry.tsx'),
    outDir: resolve(here, '../.vscode-test/smoke-bundle'),
    emptyOutDir: true,
    sourcemap: 'inline',
    chunkSizeWarningLimit: 8192,
    rollupOptions: {
      output: { entryFileNames: 'entry.js' },
    },
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
      },
    },
  },
});
