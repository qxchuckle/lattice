import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

/** core / services 源码入口：直接打包源（不依赖 dist 新鲜度），与 webview 的浏览器面保持一致的做法。 */
const coreEntry = fileURLToPath(new URL('../core/src/index.ts', import.meta.url));
const servicesEntry = fileURLToPath(new URL('../services/src/index.ts', import.meta.url));

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  clean: true,
  minify: false,
  /**
   * 不打包的依赖：
   * - better-sqlite3 / sqlite-vec / @huggingface/transformers 是原生/重型模块，扩展宿主不可用；
   *   core 的驱动探测与降级链会在运行时安全跳过（改用 Electron 内置 node:sqlite）。
   */
  external: ['vscode', 'node:sqlite', 'better-sqlite3', 'sqlite-vec', '@huggingface/transformers'],
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      '@qcqx/lattice-core': coreEntry,
      '@qcqx/lattice-services': servicesEntry,
    };
  },
});
