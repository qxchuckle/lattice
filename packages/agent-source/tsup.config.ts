import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // 兄弟包显式 external：tsconfig paths 指向其源码（类型检查/dev 用），
  // 打包时不内联，保持 import 从 node_modules 解析
  external: ['@qcqx/lattice-agent-protocol', '@qcqx/lattice-agent-protocol/schemas'],
});
