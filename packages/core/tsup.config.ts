import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  shims: true,
  clean: true,
  target: 'node18',
  publicDir: 'public',
});
