import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // web 入口薄壳 → web-ui 的浏览器 boot（TS 源码，由 vite 直接编译）
      {
        find: /^@qcqx\/lattice-web-ui\/boot$/,
        replacement: resolve(__dirname, '../web-ui/src/main.tsx'),
      },
      { find: /^@qcqx\/lattice-web-ui$/, replacement: resolve(__dirname, '../web-ui/src/ui.ts') },
      // 指向 core 浏览器安全入口（只导出纯函数 + 类型，零 Node.js 依赖）
      {
        find: /^@qcqx\/lattice-core$/,
        replacement: resolve(__dirname, '../core/src/browser.ts'),
      },
    ],
  },
  server: {
    port: 5173,
    // monorepo：允许 dev server 读取仓库内其它包（web-ui / core 源码）
    fs: {
      allow: [resolve(__dirname, '../..')],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:14527',
        changeOrigin: true,
        // WebSocket 支持（内置终端组件）
        ws: true,
        // SSE 支持：阻止后端返回压缩响应，避免流被压缩后无法分段推送
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Accept-Encoding', 'identity');
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
      },
    },
  },
});
