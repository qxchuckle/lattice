#!/usr/bin/env node
/**
 * Lattice 统一发布脚本
 *
 * 用法:
 *   pnpm release patch          # 两个包同时 patch 升级 (0.7.0 → 0.7.1)
 *   pnpm release minor          # 两个包同时 minor 升级 (0.7.0 → 0.8.0)
 *   pnpm release major          # 两个包同时 major 升级 (0.7.0 → 1.0.0)
 *   pnpm release 1.2.3          # 两个包同时设为指定版本
 *   pnpm release patch --core   # 只发布 core
 *   pnpm release patch --cli    # 只发布 cli
 *   pnpm release patch --dry-run # 只打印将执行的操作，不实际执行
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const PACKAGES = {
  core: resolve(root, 'packages/core/package.json'),
  cli: resolve(root, 'packages/cli/package.json'),
};

// --- 解析参数 ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyCore = args.includes('--core');
const onlyCli = args.includes('--cli');
const versionArg = args.find((a) => !a.startsWith('--'));

if (!versionArg) {
  console.error('❌ 请指定版本: pnpm release <patch|minor|major|x.y.z> [--core|--cli] [--dry-run]');
  process.exit(1);
}

// --- 工具函数 ---
function readPkg(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writePkg(path, pkg) {
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}

function bumpVersion(current, bump) {
  // 如果是具体版本号则直接使用
  if (/^\d+\.\d+\.\d+/.test(bump)) return bump;

  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      console.error(`❌ 无效的版本参数: ${bump}`);
      process.exit(1);
  }
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  if (!dryRun) {
    execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
  }
}

// --- 确定要发布的包 ---
const targets = [];
if (!onlyCore && !onlyCli) {
  targets.push('core', 'cli');
} else {
  if (onlyCore) targets.push('core');
  if (onlyCli) targets.push('cli');
}

// --- 升版本 ---
const corePkg = readPkg(PACKAGES.core);
const newVersion = bumpVersion(corePkg.version, versionArg);

console.log(`\n📦 Lattice Release ${dryRun ? '(dry-run)' : ''}`);
console.log(`   版本: ${corePkg.version} → ${newVersion}`);
console.log(`   包:   ${targets.join(', ')}\n`);

for (const name of targets) {
  const pkgPath = PACKAGES[name];
  const pkg = readPkg(pkgPath);
  pkg.version = newVersion;
  console.log(`✏️  ${pkg.name} → ${newVersion}`);
  if (!dryRun) {
    writePkg(pkgPath, pkg);
  }
}

// --- 构建 ---
console.log('\n🔨 构建...');
if (targets.includes('core')) {
  run('pnpm run build:core');
}
if (targets.includes('cli')) {
  // cli 依赖 core，确保 core 先构建
  if (!targets.includes('core')) {
    run('pnpm run build:core');
  }
  run('pnpm run build:cli');
}

// --- 发布 ---
console.log('\n🚀 发布...');
for (const name of targets) {
  run(`pnpm --filter @qcqx/lattice-${name} publish --no-git-checks`);
}

// --- Git tag (可选) ---
console.log(`\n🏷️  创建 git tag: v${newVersion}`);
run(`git add packages/core/package.json packages/cli/package.json`);
run(`git commit -m "release: v${newVersion}"`);
run(`git tag v${newVersion}`);

console.log(`\n✅ 发布完成! v${newVersion}`);
if (dryRun) {
  console.log('   (dry-run 模式，以上命令未实际执行)');
}
console.log('   推送: git push && git push --tags\n');
