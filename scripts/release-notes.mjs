#!/usr/bin/env node
/**
 * GitHub Release 正文生成：CHANGELOG.md 对应版本段 + 安装/包表/链接页脚。
 *
 * 用法：
 *   node scripts/release-notes.mjs v1.29.0 --out .release-notes.md
 *   node scripts/release-notes.mjs v1.29.0 --out .release-notes.md --asset packages/vscode/dist-vsix/lattice-context-0.4.2.vsix
 *
 * 由 `.github/workflows/release.yml` 在 tag 推送时调用；也可用于手动补发。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG_PATH = resolve(root, 'CHANGELOG.md');

export const normalizeVersion = (tagOrVersion) => String(tagOrVersion).replace(/^v/, '');

/** 取 `## [x.y.z]` 段正文；找不到返回空串 */
export function readChangelogSection(version) {
  const text = readFileSync(CHANGELOG_PATH, 'utf-8');
  const start = text.indexOf(`## [${normalizeVersion(version)}]`);
  if (start < 0) return '';
  const rest = text.slice(start);
  const end = rest.indexOf('\n## [', 1);
  return (end < 0 ? rest : rest.slice(0, end)).trimEnd();
}

function assetSection(version, assetPath) {
  const buf = readFileSync(assetPath);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const name = basename(assetPath);
  const size = `${(buf.length / 1024 / 1024).toFixed(2)} MB`;
  return [
    '## 附件 · Assets',
    '',
    '| 文件 · File | 大小 | sha256 |',
    '|---|---|---|',
    `| \`${name}\` | ${size} | \`${sha256}\` |`,
    '',
    `由 tag \`v${normalizeVersion(version)}\` 构建。离线安装：\`code --install-extension ${name}\`，或在 VS Code 扩展面板选择「从 VSIX 安装」。`,
    '',
    '> Built from the tag above. Install offline with `code --install-extension`, or “Install from VSIX…” in the Extensions view.',
    '',
  ].join('\n');
}

/** 拼出完整 release 正文 */
export function buildReleaseBody(tagOrVersion, assetPath) {
  const version = normalizeVersion(tagOrVersion);
  const section = readChangelogSection(version);
  const lines = [
    section || `## [${version}]\n\n- No curated notes for this tag; see the commit history.`,
    '',
    '## 安装 · Install',
    '',
    '```bash',
    'npm i -g @qcqx/lattice-cli',
    'npm i -g @qcqx/lattice-web    # Web 工作台',
    '```',
    '',
    '## 包 · Packages',
    '',
    '| Package | Version |',
    '|---|---|',
    `| [@qcqx/lattice-cli](https://www.npmjs.com/package/@qcqx/lattice-cli) | ${version} |`,
    `| [@qcqx/lattice-core](https://www.npmjs.com/package/@qcqx/lattice-core) | ${version} |`,
    `| [@qcqx/lattice-web](https://www.npmjs.com/package/@qcqx/lattice-web) | ${version} |`,
    '',
    '**官网** https://lattice.qcqx.cn · **文档** https://lattice.qcqx.cn/docs · **在线 Demo** https://lattice.qcqx.cn/demo/',
    '',
  ];
  if (assetPath) lines.push(assetSection(version, assetPath));
  return lines.join('\n');
}

// --- CLI ---
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = process.argv.slice(2);
  let tag = '';
  let out = '';
  let asset = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i] ?? '';
    else if (args[i] === '--asset') asset = args[++i] ?? '';
    else if (!args[i].startsWith('--')) tag = args[i];
  }
  if (!tag || !out) {
    console.error('用法: node scripts/release-notes.mjs <tag> --out <file> [--asset <vsix>]');
    process.exit(2);
  }
  const hasSection = Boolean(readChangelogSection(tag));
  writeFileSync(
    resolve(root, out),
    buildReleaseBody(tag, asset ? resolve(root, asset) : undefined),
  );
  console.log(`✔ release notes → ${out}${hasSection ? '' : '（CHANGELOG 无该版本段，已写占位）'}`);
}
