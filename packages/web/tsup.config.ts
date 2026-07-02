import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server/index.ts'],
  outDir: 'dist/server',
  format: ['esm'],
  dts: true,
  target: 'es2022',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // 所有 dependencies 不打包，运行时从 node_modules 解析
  external: [/^[^./]/],
});
