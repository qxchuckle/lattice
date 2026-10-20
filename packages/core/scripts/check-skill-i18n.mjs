#!/usr/bin/env node
/**
 * 注入文档双语一致性门禁（skill / platforms / commands / agents）。
 *
 * 真源：packages/core/public/templates/languages.json 声明支持语言与默认语言。
 * 校验项：
 * 1. 语言包文件集一一对应；
 * 2. markdown 标题层级序列一致；
 * 3. 跨文档链接目标文件一致；
 * 4. 反引号内命令/选项/路径 token 一致（占位符与引号内容归一化）；
 * 5. frontmatter 键一致、`name` 值一致；
 * 6. 正文体积比在合理区间（防截断/漏译）；
 * 7. 英文包正文 CJK 比例上限（frontmatter 除外）。
 *
 * 用法：node packages/core/scripts/check-skill-i18n.mjs [--root <core/public>]
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANGUAGE_SCOPED_KINDS = ['skills', 'platforms', 'commands', 'agents'];

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

export async function listFiles(root) {
  const result = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else result.push(full);
    }
  }
  await walk(root);
  return result.sort();
}

export function splitFrontmatter(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { frontmatter: '', body: text };
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { frontmatter: '', body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

export function frontmatterKeys(frontmatter) {
  return frontmatter
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z0-9_-]+):/)?.[1])
    .filter(Boolean);
}

export function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return undefined;
  return match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
}

export function headingDepths(body) {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,6})\s+/)?.[1].length)
    .filter(Boolean);
}

export function linkTargets(body) {
  const targets = new Set();
  const add = (raw) => {
    const target = raw.trim().split('#')[0].trim();
    if (target.endsWith('.md')) targets.add(target);
  };
  for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+\.md(?:#[^)]*)?)\)/g)) add(match[1]);
  for (const match of body.matchAll(/\[([^\]]+\.md(?:#[^\]]*)?)\]/g)) add(match[1]);
  return [...targets].sort();
}

function normalizeToken(token) {
  return token
    .replace(/<[^>]*>/g, '<...>')
    .replace(/"[^"]*"/g, '"..."')
    .replace(/'[^']*'/g, "'...'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function commandTokens(body) {
  const tokens = new Set();

  // 行内代码：命令、选项、路径等
  const inlineBody = body.replace(/```[\s\S]*?```/g, '');
  for (const match of inlineBody.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim();
    if (!token) continue;
    if (
      /^(ltc\b|--|~\/|packages\/|\.\/|spec-|cp_|rel_)/.test(token) ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(token)
    ) {
      tokens.add(normalizeToken(token));
    }
  }

  // 围栏代码块：只取命令行与选项，避免把注释/目录树等说明文字当成 token
  for (const block of body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^(ltc\b|ID=\$\(ltc\b|[A-Z_]+=\$\(ltc\b)/.test(trimmed)) {
        tokens.add(normalizeToken(trimmed.replace(/\s+#.*$/, '')));
      }
      for (const match of trimmed.matchAll(/--[a-z][\w-]*/g)) tokens.add(match[0]);
    }
  }

  return [...tokens].sort();
}

export function cjkRatio(text) {
  const stripped = text.replace(/\s+/g, '');
  if (!stripped) return 0;
  const cjk = stripped.match(CJK_RE)?.length ?? 0;
  return cjk / stripped.length;
}

function diffSets(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  return {
    onlyLeft: [...a].filter((item) => !b.has(item)),
    onlyRight: [...b].filter((item) => !a.has(item)),
  };
}

async function readPair(root, kind, file, defaultLanguage, otherLanguage) {
  const defaultPath = join(root, 'templates', kind, defaultLanguage, file);
  const otherPath = join(root, 'templates', kind, otherLanguage, file);
  return {
    defaultPath,
    otherPath,
    defaultText: await readFile(defaultPath, 'utf8'),
    otherText: await readFile(otherPath, 'utf8'),
  };
}

export async function checkSkillI18n(root) {
  const manifestPath = join(root, 'templates', 'languages.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const supportedLanguages = Array.isArray(manifest.supportedLanguages)
    ? manifest.supportedLanguages.filter((lang) => typeof lang === 'string')
    : [];
  const defaultLanguage = manifest.defaultLanguage;

  const errors = [];
  if (supportedLanguages.length === 0) {
    errors.push('languages.json：supportedLanguages 为空');
    return { errors, checked: 0, manifest };
  }
  if (!supportedLanguages.includes(defaultLanguage)) {
    errors.push(`languages.json：defaultLanguage (${defaultLanguage}) 不在 supportedLanguages 中`);
    return { errors, checked: 0, manifest };
  }

  const otherLanguages = supportedLanguages.filter((lang) => lang !== defaultLanguage);
  let checked = 0;

  for (const kind of LANGUAGE_SCOPED_KINDS) {
    const filesByLanguage = {};
    for (const lang of supportedLanguages) {
      const dir = join(root, 'templates', kind, lang);
      filesByLanguage[lang] = (await listFiles(dir)).map((file) => relative(dir, file));
    }

    const defaultFiles = filesByLanguage[defaultLanguage];
    for (const otherLanguage of otherLanguages) {
      const otherFiles = filesByLanguage[otherLanguage];
      const { onlyLeft, onlyRight } = diffSets(defaultFiles, otherFiles);
      for (const file of onlyLeft) {
        errors.push(`${kind}/${otherLanguage}：缺少 ${file}（${defaultLanguage} 存在）`);
      }
      for (const file of onlyRight) {
        errors.push(`${kind}/${otherLanguage}：多出 ${file}（${defaultLanguage} 不存在）`);
      }

      for (const file of defaultFiles.filter((item) => otherFiles.includes(item))) {
        const pair = await readPair(root, kind, file, defaultLanguage, otherLanguage);
        const label = `${kind}/${file}`;
        const left = splitFrontmatter(pair.defaultText);
        const right = splitFrontmatter(pair.otherText);

        const leftKeys = frontmatterKeys(left.frontmatter);
        const rightKeys = frontmatterKeys(right.frontmatter);
        const keyDiff = diffSets(leftKeys, rightKeys);
        if (keyDiff.onlyLeft.length || keyDiff.onlyRight.length) {
          errors.push(
            `${label}：frontmatter 键不一致（${defaultLanguage} 独有 ${keyDiff.onlyLeft.join(', ') || '-'}；${otherLanguage} 独有 ${keyDiff.onlyRight.join(', ') || '-'}）`,
          );
        }

        if (leftKeys.includes('name') && rightKeys.includes('name')) {
          const leftName = frontmatterValue(left.frontmatter, 'name');
          const rightName = frontmatterValue(right.frontmatter, 'name');
          if (leftName !== rightName) {
            errors.push(`${label}：frontmatter name 不一致（${leftName} vs ${rightName}）`);
          }
        }

        const leftHeadings = headingDepths(left.body);
        const rightHeadings = headingDepths(right.body);
        if (leftHeadings.join(',') !== rightHeadings.join(',')) {
          errors.push(
            `${label}：标题层级序列不一致（${defaultLanguage}=${leftHeadings.join(',')}；${otherLanguage}=${rightHeadings.join(',')}）`,
          );
        }

        const linkDiff = diffSets(linkTargets(left.body), linkTargets(right.body));
        if (linkDiff.onlyLeft.length || linkDiff.onlyRight.length) {
          errors.push(
            `${label}：链接目标不一致（${defaultLanguage} 独有 ${linkDiff.onlyLeft.join(', ') || '-'}；${otherLanguage} 独有 ${linkDiff.onlyRight.join(', ') || '-'}）`,
          );
        }

        const tokenDiff = diffSets(commandTokens(left.body), commandTokens(right.body));
        if (tokenDiff.onlyLeft.length || tokenDiff.onlyRight.length) {
          errors.push(
            `${label}：命令/选项 token 不一致（${defaultLanguage} 独有 ${tokenDiff.onlyLeft.join(' | ') || '-'}；${otherLanguage} 独有 ${tokenDiff.onlyRight.join(' | ') || '-'}）`,
          );
        }

        const leftLength = left.body.replace(/\s+/g, '').length;
        const rightLength = right.body.replace(/\s+/g, '').length;
        if (leftLength > 0) {
          const ratio = rightLength / leftLength;
          if (ratio < 0.4 || ratio > 2.5) {
            errors.push(
              `${label}：正文体积比异常（${otherLanguage}/${defaultLanguage}=${ratio.toFixed(2)}，期望 0.4~2.5）`,
            );
          }
        }

        if (otherLanguage === 'en') {
          const ratio = cjkRatio(right.body);
          if (ratio > 0.05) {
            errors.push(
              `${label}：英文包正文 CJK 比例 ${(ratio * 100).toFixed(1)}% 超过 5%（疑似未翻译）`,
            );
          }
        }

        checked++;
      }
    }
  }

  return { errors, checked, manifest };
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const root = rootIndex >= 0 ? args[rootIndex + 1] : join(scriptDir, '..', 'public');

  try {
    const { errors, checked } = await checkSkillI18n(root);
    if (errors.length) {
      console.error(`✖ skill 双语门禁失败（${errors.length} 项）：`);
      for (const error of errors) console.error(`  - ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✔ skill 双语门禁通过（${checked} 个文件对）`);
  } catch (error) {
    console.error(`✖ skill 双语门禁执行失败：${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
