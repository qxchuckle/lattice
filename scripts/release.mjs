#!/usr/bin/env node
/**
 * Lattice 统一发布脚本
 *
 * 用法:
 *   pnpm release patch          # 三个包同时 patch 升级
 *   pnpm release minor          # 三个包同时 minor 升级
 *   pnpm release major          # 三个包同时 major 升级
 *   pnpm release 1.2.3          # 三个包同时设为指定版本
 *   pnpm release patch --core   # 只发布 core
 *   pnpm release patch --cli    # 只发布 cli
 *   pnpm release patch --web    # 只发布 web
 *   pnpm release patch --core --web  # 发布 core 和 web
 *   pnpm release patch --dry-run # 只打印将执行的操作，不实际执行
 *   pnpm release continue        # 发布失败后继续（跳过版本bump和构建，重试发布+git）
 *   pnpm release patch --no-push # 不推送到远端（tag 不上去，CI 也就不会建 Release）
 *
 * 完整流程：bump → 写入 CHANGELOG → 构建 → npm 发布 → 提交 + tag → 推送。
 * 推送后由 `.github/workflows/release.yml` 在 tag 上构建 VSIX 并建 GitHub Release
 * （正文 = CHANGELOG 对应版本段 + 安装/包表/链接，附件 = 同一 tag 构建的 VSIX）。
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
  web: resolve(root, 'packages/web/package.json'),
};

const CHANGELOG_PATH = resolve(root, 'CHANGELOG.md');

// --- 解析参数 ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipPush = args.includes('--no-push');
const onlyCore = args.includes('--core');
const onlyCli = args.includes('--cli');
const onlyWeb = args.includes('--web');
const versionArg = args.find((a) => !a.startsWith('--'));

if (!versionArg) {
  console.error(
    '❌ 请指定版本: pnpm release <patch|minor|major|x.y.z|continue> [--core|--cli|--web] [--dry-run]',
  );
  process.exit(1);
}

const isContinue = versionArg === 'continue';

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

// --- CHANGELOG ---

const SECTION_TYPES = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  refactor: 'Changed',
  revert: 'Changed',
  docs: 'Documentation',
};
const SECTION_ORDER = ['Added', 'Changed', 'Fixed', 'Documentation'];
// 纯内部提交不进 CHANGELOG
const SKIP_TYPES = new Set(['test', 'chore', 'ci', 'build', 'style']);
const PLACEHOLDER = '- No user-facing changes.';

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
}

function previousTag() {
  try {
    return git('git describe --tags --abbrev=0');
  } catch {
    return '';
  }
}

// 上一个 tag → HEAD 的非 merge 提交，按 Conventional Commits 类型归组
function collectEntries(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
  const messages = git(`git log --no-merges --reverse --format=%s ${range}`)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^release: v?\d/.test(line));

  const groups = new Map();
  for (const raw of messages) {
    const match = raw.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
    if (match && SKIP_TYPES.has(match[1])) continue;
    const section = (match && SECTION_TYPES[match[1]]) || 'Changed';
    const scope = match?.[2];
    const text = match ? match[3] : raw;
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(scope ? `**${scope}**: ${text}` : text);
  }
  return groups;
}

// 不带标题的版本段落正文（用于拼到 `## [x.y.z] - date` 之后）
function renderBody(groups) {
  const lines = [];
  const emitted = SECTION_ORDER.filter((title) => groups.get(title)?.length);
  if (!emitted.length) return PLACEHOLDER;
  for (const title of emitted) {
    lines.push(`### ${title}`, '');
    for (const entry of groups.get(title)) lines.push(`- ${entry}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// 取 [Unreleased] 段正文；只有占位符时视为空
function readUnreleased(text) {
  const start = text.indexOf('## [Unreleased]');
  if (start < 0) return { start: -1, end: -1, body: '' };
  const end = text.indexOf('\n## [', start + 1);
  const body = (end < 0 ? text.slice(start) : text.slice(start, end))
    .replace('## [Unreleased]', '')
    .trim();
  return { start, end, body: body === PLACEHOLDER ? '' : body };
}

// 优先搬 [Unreleased] 里手写的条目；没写则从 commit 生成（并提示去润色）
function updateChangelog(version) {
  const date = new Date().toISOString().slice(0, 10);
  const text = readFileSync(CHANGELOG_PATH, 'utf-8');
  const { start, end, body } = readUnreleased(text);
  if (start < 0) throw new Error('CHANGELOG.md 缺少 `## [Unreleased]` 段落');

  const curated = body.length > 0;
  const sectionBody = curated ? body : renderBody(collectEntries(previousTag()));
  if (!curated && sectionBody === PLACEHOLDER) {
    console.log('⚠ [Unreleased] 与 commit 都没有可写条目，段落写占位');
  } else if (!curated) {
    console.log('⚠ [Unreleased] 为空，已从 commit 自动生成；建议发布后润色该段');
  }

  const head = `## [Unreleased]\n\n`;
  const section = `## [${version}] - ${date}\n\n${sectionBody}\n\n`;
  const tail = end < 0 ? '' : text.slice(end + 1);
  const next = `${text.slice(0, start)}${head}${section}${tail}`;

  console.log(`✏️  CHANGELOG.md → [${version}]（${curated ? '手写要点' : 'commit 自动生成'}）`);
  if (dryRun) {
    console.log(section.replace(/^/gm, '   | '));
    return;
  }
  writeFileSync(CHANGELOG_PATH, next);
}

// --- 确定要发布的包 ---
const targets = [];
const hasFlag = onlyCore || onlyCli || onlyWeb;
if (!hasFlag) {
  targets.push('core', 'cli', 'web');
} else {
  if (onlyCore) targets.push('core');
  if (onlyCli) targets.push('cli');
  if (onlyWeb) targets.push('web');
}

// --- 升版本（continue 模式跳过） ---
const corePkg = readPkg(PACKAGES.core);
let newVersion;

if (isContinue) {
  newVersion = corePkg.version;
  console.log(`\n📦 Lattice Release --continue ${dryRun ? '(dry-run)' : ''}`);
  console.log(`   版本: ${newVersion}（沿用当前 package.json）`);
  console.log(`   包:   ${targets.join(', ')}\n`);
} else {
  newVersion = bumpVersion(corePkg.version, versionArg);

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

  // --- CHANGELOG ---
  console.log('\n📝 更新 CHANGELOG...');
  updateChangelog(newVersion);

  // --- 构建 ---
  console.log('\n🔨 构建...');
  // core 是 cli 和 web 的共同依赖，有任一在 targets 中就需要先构建 core
  if (targets.includes('cli') || targets.includes('web')) {
    if (!targets.includes('core')) {
      run('pnpm run build:core');
    }
  }
  if (targets.includes('core')) {
    run('pnpm run build:core');
  }
  if (targets.includes('cli')) {
    run('pnpm run build:cli');
  }
  if (targets.includes('web')) {
    run('pnpm run build:web');
  }
}

// --- 发布 ---
console.log('\n🚀 发布...');
for (const name of targets) {
  const cmd = `pnpm --filter @qcqx/lattice-${name} publish --no-git-checks`;
  if (dryRun) {
    run(cmd);
    continue;
  }
  try {
    run(cmd);
  } catch {
    // continue 模式下容忍"已发布过"错误，跳过该包继续
    if (isContinue) {
      console.log(`⚠️  @qcqx/lattice-${name} 发布失败（可能已发布过），跳过继续`);
    } else {
      throw new Error(`发布 @qcqx/lattice-${name} 失败，可运行 pnpm release continue 重试`);
    }
  }
}

// --- Git tag + 推送 ---
console.log(`\n🏷️  创建 git tag: v${newVersion}`);
const pkgPaths = `${targets.map((name) => `packages/${name}/package.json`).join(' ')} CHANGELOG.md`;
run(`git add ${pkgPaths}`);
run(`git commit -m "release: v${newVersion}"`);
run(`git tag v${newVersion}`);

if (skipPush) {
  console.log(`\nℹ 未推送：推上去后由 Actions 构建 VSIX 并建 Release`);
  console.log(`   git push origin HEAD && git push origin v${newVersion}\n`);
} else {
  console.log('\n📤 推送...');
  run('git push origin HEAD');
  run(`git push origin v${newVersion}`);
}

console.log(`\n✅ 发布完成! v${newVersion}`);
if (dryRun) {
  console.log('   (dry-run 模式，以上命令未实际执行)');
} else if (!skipPush) {
  console.log('   GitHub Release 由 Actions 在 tag 上构建并创建：');
  console.log(`   https://github.com/qxchuckle/lattice/actions/workflows/release.yml\n`);
}
