// 打包 VSIX 到 dist-vsix/<name>-<version>.vsix（name 取自 package.json）（vsce 的 --out 指向目录时会产出无扩展名文件，故显式带版本文件名）。
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgRoot = join(import.meta.dirname, '..');
const { name, version } = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

// 强制先构建：避免「package 单跑」时把陈旧 dist/media 打进 VSIX（曾导致新清单 + 旧运行时）
console.log('▸ build (webview + extension) ...');
execSync('pnpm run build', { cwd: pkgRoot, stdio: 'inherit' });

mkdirSync(join(pkgRoot, 'dist-vsix'), { recursive: true });
execSync(`pnpm exec vsce package --no-dependencies --out dist-vsix/${name}-${version}.vsix`, {
  cwd: pkgRoot,
  stdio: 'inherit',
});
