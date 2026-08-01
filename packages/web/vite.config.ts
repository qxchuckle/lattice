import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/client'),
      // 零依赖基础层：dev 直接走源码，免去改动后手动 build dist
      '@qcqx/lattice-foundation': resolve(__dirname, '../foundation/src/index.ts'),
      // 指向 core 浏览器安全入口（只导出纯函数 + 类型，零 Node.js 依赖）
      '@qcqx/lattice-core': resolve(__dirname, '../core/src/browser.ts'),
      // 先于根出口 alias（前缀匹配）：/schemas 子出口直指源码，供 server 侧测试解析；
      // client 代码禁止 import 本子出口（双出口约定：浏览器 bundle 零 zod）
      '@qcqx/lattice-agent-protocol/schemas': resolve(
        __dirname,
        '../agent-protocol/src/schemas.ts',
      ),
      // dev 直接走源码（零依赖纯函数包），免去改动后手动 build dist
      '@qcqx/lattice-agent-protocol': resolve(__dirname, '../agent-protocol/src/index.ts'),
    },
  },
  server: {
    port: 5173,
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
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/client/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
