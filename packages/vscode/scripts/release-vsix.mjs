// 本地发布流水（无 CI）：版本—CHANGELOG 一致性检查 → 构建 → vsce 打包 → sha256 → 打印双渠道发布命令。
// publish 由维护者手动执行并携带 token（仓库不落凭据）。
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const pkgRoot = join(here, '..');

const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const version = pkg.version;

const changelog = readFileSync(join(pkgRoot, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`[${version}]`)) {
  console.error(`✗ CHANGELOG.md 缺少 [${version}] 段落，请先补写变更记录`);
  process.exit(1);
}

console.log(`▸ 构建 v${version} ...`);
execSync('pnpm run build', { cwd: pkgRoot, stdio: 'inherit' });

console.log('▸ vsce package ...');
execSync('node scripts/package.mjs', {
  cwd: pkgRoot,
  stdio: 'inherit',
});

const distDir = join(pkgRoot, 'dist-vsix');
const vsix = readdirSync(distDir)
  .filter((f) => f.endsWith('.vsix'))
  .map((f) => ({
    name: f,
    mtime: statSync(join(distDir, f)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime)[0];

if (!vsix) {
  console.error('✗ 未找到打包产物');
  process.exit(1);
}

const buf = readFileSync(join(distDir, vsix.name));
const sha256 = createHash('sha256').update(buf).digest('hex');

console.log(`\n✔ ${vsix.name}（${(buf.length / 1024 / 1024).toFixed(2)} MB）`);
console.log(`  sha256: ${sha256}`);
console.log('\n手动发布（token 由你提供）：');
console.log(`  Open VSX:     pnpm dlx ovsx publish dist-vsix/${vsix.name} -p <OVSX_TOKEN>`);
console.log(
  `  Marketplace:  pnpm exec vsce publish --packagePath dist-vsix/${vsix.name} -p <AZURE_PAT>`,
);
