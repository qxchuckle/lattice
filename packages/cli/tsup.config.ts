import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  shims: true,
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __createRequire } from "module";',
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  publicDir: 'public',
});
