// 本地发布流水（无 CI）：版本—CHANGELOG 一致性检查 → 构建 → vsce 打包 → sha256
// →（可选 --publish）读取凭据并发布 Open VSX 与 VS Marketplace。
//
// 凭据约定：
// - 仓库根 `.env.release`（**已 git-ignored**，模板见 `.env.release.example`）：
//     OVSX_PAT=...   # Open VSX 个人访问令牌
//     VSCE_PAT=...   # VS Marketplace PAT（Azure DevOps，Scopes ≥ Marketplace: Manage）
// - 环境变量优先于文件值（便于未来接入其他注入方式）；输出一律掩码。
// - npm 包凭据不在此文件：使用 npm 原生 ~/.npmrc（npm login / granular access token）。
//
// 用法：
//   pnpm --filter lattice run release          → 构建 + 打包 + sha256 + 发布指引
//   pnpm --filter lattice run release:publish  → 同上并自动发布（缺凭据的渠道自动跳过）
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = import.meta.dirname;
const pkgRoot = join(here, '..');
const repoRoot = resolve(here, '..', '..', '..');
const shouldPublish = process.argv.includes('--publish');

// ── 凭据加载（文件 < 环境变量） ──

function loadReleaseEnv() {
  const file = join(repoRoot, '.env.release');
  const env = {};
  if (!existsSync(file)) return env;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

const fileEnv = loadReleaseEnv();
const getSecret = (key) => process.env[key] || fileEnv[key] || '';

function mask(secret) {
  if (!secret) return '(未配置)';
  return secret.length <= 8 ? '****' : `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

// 防呆：凭据文件不得进入 git 索引
function assertNotGitTracked() {
  const file = join(repoRoot, '.env.release');
  if (!existsSync(file)) return;
  try {
    execSync('git ls-files --error-unmatch .env.release', { cwd: repoRoot, stdio: 'pipe' });
    console.warn(
      '⚠ 危险：.env.release 已被 git 跟踪！立即执行 `git rm --cached .env.release` 并轮换其中凭据。',
    );
  } catch {
    // 未被跟踪 = 正常
  }
}

// ── 版本 / 变更记录一致性 ──

const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const version = pkg.version;

const changelog = readFileSync(join(pkgRoot, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`[${version}]`)) {
  console.error(`✗ CHANGELOG.md 缺少 [${version}] 段落，请先补写变更记录`);
  process.exit(1);
}

assertNotGitTracked();

// ── 构建 + 打包 ──

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

// ── 发布（可选） ──

// 已发布判定：同一行内必须同时出现「already published/exists」与**当前版本号**——
// vsce 的「名称已存在」错误（无版本号）不得被吞掉（曾因此把真实的 name-conflict 静默跳过）。
function isAlreadyPublished(text) {
  for (const line of String(text).split('\n')) {
    if (/already (published|exists)/i.test(line) && line.includes(version)) return true;
  }
  return false;
}

function publishOpenVsx(vsixPath) {
  const pat = getSecret('OVSX_PAT');
  if (!pat) {
    console.log('  ⚠ 跳过 Open VSX：未配置 OVSX_PAT（.env.release 或环境变量）');
    return true;
  }
  console.log(`  ▸ Open VSX 发布中（PAT ${mask(pat)}）…`);
  try {
    execSync(`pnpm dlx ovsx publish "${vsixPath}" -p ${pat}`, {
      cwd: pkgRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    console.log(
      `  ✔ Open VSX 已发布 → https://open-vsx.org/extension/${pkg.publisher}/${pkg.name}`,
    );
    return true;
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`;
    if (isAlreadyPublished(text)) {
      console.log('  ℹ Open VSX：该版本已发布，跳过');
      return true;
    }
    console.error(`  ✘ Open VSX 发布失败：\n${text.trim().split('\n').slice(-4).join('\n')}`);
    return false;
  }
}

function publishMarketplace(vsixPath) {
  const pat = getSecret('VSCE_PAT');
  if (!pat) {
    console.log('  ⚠ 跳过 VS Marketplace：未配置 VSCE_PAT（.env.release 或环境变量）');
    return true;
  }
  console.log(`  ▸ VS Marketplace 发布中（PAT ${mask(pat)}）…`);
  try {
    execSync(`pnpm exec vsce publish --packagePath "${vsixPath}" -p ${pat}`, {
      cwd: pkgRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    console.log('  ✔ VS Marketplace 已发布');
    return true;
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`;
    if (isAlreadyPublished(text)) {
      console.log('  ℹ VS Marketplace：该版本已发布，跳过');
      return true;
    }
    console.error(`  ✘ VS Marketplace 发布失败：\n${text.trim().split('\n').slice(-6).join('\n')}`);
    return false;
  }
}

let publishOk = true;
if (shouldPublish) {
  console.log('\n▸ 发布到双渠道 ...');
  publishOk =
    publishOpenVsx(join(distDir, vsix.name)) && publishMarketplace(join(distDir, vsix.name));
} else {
  console.log('\n发布方式（凭据不入库）：');
  console.log(`  1. 配置凭据：复制 .env.release.example → .env.release，填入 OVSX_PAT / VSCE_PAT`);
  console.log(`     （该文件已被 .gitignore 忽略；也可用环境变量注入）`);
  console.log('  2. 执行：     pnpm --filter lattice run release:publish');
  console.log(`  或单独执行：  pnpm dlx ovsx publish dist-vsix/${vsix.name} -p <OVSX_PAT>`);
  console.log(
    `                pnpm exec vsce publish --packagePath dist-vsix/${vsix.name} -p <VSCE_PAT>`,
  );
}

if (!publishOk) process.exit(1);
