import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  /**
   * core 与原生/重型模块外置：宿主各自解析（CLI/web 走 node_modules；
   * VSCode 扩展在打包时把 core/services 别名到源码并外置原生模块）。
   */
  external: ['@qcqx/lattice-core', 'better-sqlite3', 'sqlite-vec', '@huggingface/transformers'],
});
