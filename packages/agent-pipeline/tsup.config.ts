import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // 兄弟包显式 external：tsconfig paths 指向其源码（类型检查/dev 用），打包时不内联
  external: ['@qcqx/lattice-agent-protocol'],
});
