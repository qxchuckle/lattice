import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const webClient = resolve(here, '../../web-ui/src');

/**
 * VSCode Webview 应用构建（宿主包持有入口，组件来自 web 包 UI 面）。
 * - 产物直接写入 ../media/webview（VSIX 内路径）
 * - src/host.ts 等宿主桥代码只属于本包；对 web 包只做编译期引用（@lattice-web-ui）
 */
export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  resolve: {
    // 单份 React/antd 实例：web 源码与本包源码各自解析，必须 dedupe 防双副本。
    dedupe: [
      'react',
      'react-dom',
      'antd',
      '@ant-design/icons',
      '@tanstack/react-query',
      'react-router',
      'valtio',
    ],
    alias: {
      '@lattice-web-ui': resolve(webClient, 'ui.ts'),
      '@qcqx/lattice-core': resolve(here, '../../core/src/browser.ts'),
      '@qcqx/lattice-protocol': resolve(here, '../../protocol/src/index.ts'),
    },
  },
  build: {
    outDir: resolve(here, '../media/webview'),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: resolve(here, 'webview.html'),
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
