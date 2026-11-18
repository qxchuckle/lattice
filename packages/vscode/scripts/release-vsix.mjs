// 本地发布流水（无 CI）：版本—CHANGELOG 一致性检查 → 构建 → vsce 打包 → sha256
// →（可选 --publish）读取凭据并发布 Open VSX 与 VS Marketplace。
//
// 凭据约定：
// - 仓库根 `.env.release`（**已 git-ignored**，模板见 `.env.release.example`）：
//     OVSX_PAT=...   # Open VSX 个人访问令牌
//     VSCE_PAT=...   # VS Marketplace PAT（Azure DevOps，Scopes ≥ Marketplace: Manage）
// - 环境变量优先于文件值；凭据只经环境传给对应发布工具。
// - npm 包凭据不在此文件：使用 npm 原生 ~/.npmrc（npm login / granular access token）。
//
// 用法：
//   pnpm --filter lattice-context run release          → 构建 + 打包 + sha256 + 发布指引
//   pnpm --filter lattice-context run release:publish  → 使用两个渠道的凭据发布
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
const credentials = Object.fromEntries(
  ['OVSX_PAT', 'VSCE_PAT'].map((key) => [key, process.env[key] || fileEnv[key] || '']),
);

/**
 * 部分发布工具在出错时可能打印请求详情，统一清除令牌。
 */
function redact(text) {
  return Object.values(credentials)
    .filter(Boolean)
    .reduce((message, secret) => message.split(secret).join('****'), String(text));
}

// 防呆：凭据文件不得进入 git 索引
function assertNotGitTracked() {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '.env.release'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    return;
  }
  throw new Error('.env.release 已被 git 跟踪。请移出 Git 索引并轮换其中的凭据。');
}

function runPnpm(args, options) {
  // pnpm supplies its JS entry point for package scripts, including on Windows.
  const pnpm = process.env.npm_execpath;
  return execFileSync(pnpm ? process.execPath : 'pnpm', pnpm ? [pnpm, ...args] : args, {
    cwd: pkgRoot,
    ...options,
  });
}

// ── 版本 / 变更记录一致性 ──

const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const version = pkg.version;
const vsixName = `${pkg.name}-${version}.vsix`;
const vsixPath = join('dist-vsix', vsixName);

const changelog = readFileSync(join(pkgRoot, 'CHANGELOG.md'), 'utf8');
if (!changelog.split('\n').some((line) => line.startsWith(`## [${version}]`))) {
  console.error(`✗ CHANGELOG.md 缺少 [${version}] 段落，请先补写变更记录`);
  process.exit(1);
}

assertNotGitTracked();
if (shouldPublish) {
  const missing = Object.keys(credentials).filter((key) => !credentials[key]);
  if (missing.length) {
    console.error(`缺少发布凭据 ${missing.join('、')}。配置方法见 .env.release.example。`);
    process.exit(1);
  }
}

// ── 构建 + 打包 ──

console.log(`▸ 构建并打包 v${version} ...`);
runPnpm(['run', 'package'], { stdio: 'inherit' });

const buf = readFileSync(join(pkgRoot, vsixPath));
const sha256 = createHash('sha256').update(buf).digest('hex');

console.log(`\n✔ ${vsixName}（${(buf.length / 1024 / 1024).toFixed(2)} MB）`);
console.log(`  sha256: ${sha256}`);

// ── 发布（可选） ──

// 已发布判定：同一行内必须同时出现「already published/exists」与**当前版本号**——
// vsce 的「名称已存在」错误（无版本号）不得被吞掉（曾因此把真实的 name-conflict 静默跳过）。
function isAlreadyPublished(text) {
  return text
    .split('\n')
    .some(
      (line) =>
        /already (published|exists)/i.test(line) &&
        line.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/g)?.includes(version),
    );
}

function publish(name, key, args) {
  console.log(`  ▸ ${name} 发布中…`);
  try {
    runPnpm(args, {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, [key]: credentials[key] },
    });
    console.log(`  ✔ ${name} 已发布`);
    return true;
  } catch (error) {
    const text = redact([error.stdout, error.stderr, error.message].filter(Boolean).join('\n'));
    if (isAlreadyPublished(text)) {
      console.log(`  ℹ ${name}：该版本已发布`);
      return true;
    }
    console.error(`  ✘ ${name} 发布失败：\n${text.trim().split('\n').slice(-6).join('\n')}`);
    return false;
  }
}

if (shouldPublish) {
  console.log('\n▸ 发布到双渠道 ...');
  const openVsx = publish('Open VSX', 'OVSX_PAT', ['dlx', 'ovsx@0.10.9', 'publish', vsixPath]);
  const marketplace = publish('VS Marketplace', 'VSCE_PAT', [
    'exec',
    'vsce',
    'publish',
    '--packagePath',
    vsixPath,
  ]);
  if (!openVsx || !marketplace) process.exitCode = 1;
} else {
  console.log('\n发布方式（凭据不入库）：');
  console.log(`  1. 配置凭据：复制 .env.release.example → .env.release，填入 OVSX_PAT / VSCE_PAT`);
  console.log(`     （该文件已被 .gitignore 忽略；也可用环境变量注入）`);
  console.log('  2. 执行：     pnpm --filter lattice-context run release:publish');
}
