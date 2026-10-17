// 打包 VSIX 到 dist-vsix/lattice-<version>.vsix（vsce 的 --out 指向目录时会产出无扩展名文件，故显式带版本文件名）。
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgRoot = join(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

mkdirSync(join(pkgRoot, 'dist-vsix'), { recursive: true });
execSync(`pnpm exec vsce package --no-dependencies --out dist-vsix/lattice-${version}.vsix`, {
  cwd: pkgRoot,
  stdio: 'inherit',
});
