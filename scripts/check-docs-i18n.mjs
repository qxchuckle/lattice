#!/usr/bin/env node
/**
 * Public documentation bilingual gate.
 *
 * Source of truth: i18n-manifest.json (language pairs).
 * Checks:
 * 1. every source/translation file exists;
 * 2. both directions contain a language-switcher link;
 * 3. heading-depth sequences match (code fences/frontmatter ignored);
 * 4. internal link targets match after language normalization;
 * 5. every internal link exists on disk;
 * 6. command/option tokens match (quoted values normalized);
 * 7. line-count ratio is sane (0.5~2.0);
 * 8. English sources contain almost no CJK (language switcher excepted by ratio);\n * 9. `linkCheck` files (community docs / extra public docs) have no broken relative links;\n * 10. `templates/spec/{zh,en}` have identical template/file sets, English files contain no CJK,\n *     and `template.json` routing fields match.
 *
 * Usage: node scripts/check-docs-i18n.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const manifestPath = join(repoRoot, 'i18n-manifest.json');
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

function read(path) {
  return readFileSync(path, 'utf8');
}

function splitFrontmatter(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { frontmatter: '', body: text };
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { frontmatter: '', body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

function stripFences(text) {
  return splitFrontmatter(text).body.replace(FENCE_RE, '');
}

function headingDepths(text) {
  return stripFences(text)
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,6})\s+/)?.[1].length)
    .filter(Boolean);
}

function cleanTarget(raw) {
  let target = raw.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  // Strip an optional Markdown title: [x](url "title")
  target = target.split(/\s+["']/)[0].trim();
  return target;
}

function isExternal(target) {
  return /^(https?:|mailto:|tel:|file:|#)/i.test(target);
}

function extractLinkTargets(text) {
  const body = stripFences(text).replace(/`[^`]*`/g, '');
  const targets = [];
  for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    targets.push(cleanTarget(match[1]));
  }
  for (const match of body.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)=["']([^"']+)["']/gi)) {
    targets.push(cleanTarget(match[1]));
  }
  return targets;
}

function resolveInternalTarget(filePath, target) {
  const pathPart = target.split('#')[0].split('?')[0];
  if (!pathPart || isExternal(target)) return undefined;
  return resolve(dirname(filePath), pathPart);
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function normalizeForParity(filePath) {
  // filePath is absolute; normalize to a repo-relative logical path.
  let rel = toPosix(relative(repoRoot, filePath));
  rel = rel.replace(/\.zh-CN\.md$/i, '.md');
  rel = rel.replace(/\/(en|zh)\//g, '/<lang>/');
  return rel;
}

function diffSets(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  return {
    onlyLeft: [...a].filter((item) => !b.has(item)),
    onlyRight: [...b].filter((item) => !a.has(item)),
  };
}

function normalizeToken(token) {
  return token
    .replace(/<[^>]*>/g, '<...>')
    .replace(/"[^"]*"/g, '"..."')
    .replace(/'[^']*'/g, "'...'")
    .replace(/\.zh-CN\.md$/i, '.md')
    .replace(/\/(en|zh)\//g, '/<lang>/')
    .replace(/\s+/g, ' ')
    .trim();
}

function commandTokens(text) {
  const body = splitFrontmatter(text).body;
  const tokens = new Set();

  // Inline code: commands, options, paths.
  const inline = body.replace(FENCE_RE, '');
  for (const match of inline.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim();
    if (!token) continue;
    if (
      /^(ltc\b|lattice\b|--|~\/|packages\/|spec-|cp_|rel_)/.test(token) ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(token)
    ) {
      tokens.add(normalizeToken(token));
    }
  }

  // Fenced code blocks: command lines and long options only.
  for (const block of body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^(ltc\b|lattice\b)/.test(trimmed)) {
        tokens.add(normalizeToken(trimmed.replace(/\s+#.*$/, '')));
      }
      for (const match of trimmed.matchAll(/--[a-z][\w-]*/g)) tokens.add(match[0]);
    }
  }

  return [...tokens].sort();
}

function cjkRatio(text) {
  const stripped = stripFences(text).replace(/\s+/g, '');
  if (!stripped) return 0;
  const cjk = stripped.match(CJK_RE)?.length ?? 0;
  return cjk / stripped.length;
}

function lineCount(text) {
  return splitFrontmatter(text).body.split(/\r?\n/).length;
}

function linkExists(absPath) {
  if (existsSync(absPath)) return true;
  // Markdown links may point at a path without its extension.
  return existsSync(`${absPath}.md`);
}

function checkPair(pair, lang, errors) {
  const sourcePath = join(repoRoot, pair.source);
  const translationPath = join(repoRoot, pair.translations[lang]);
  const label = `${pair.source} ⇄ ${pair.translations[lang]}`;

  if (!existsSync(sourcePath)) {
    errors.push(`${label}: source file missing`);
    return;
  }
  if (!existsSync(translationPath)) {
    errors.push(`${label}: translation file missing`);
    return;
  }

  const source = read(sourcePath);
  const translation = read(translationPath);

  // 1. Reciprocal language switcher.
  const sourceLinks = extractLinkTargets(source)
    .map((target) => resolveInternalTarget(sourcePath, target))
    .filter(Boolean);
  const translationLinks = extractLinkTargets(translation)
    .map((target) => resolveInternalTarget(translationPath, target))
    .filter(Boolean);
  const sourceHasTranslation = sourceLinks.some((target) => target === translationPath);
  const translationHasSource = translationLinks.some((target) => target === sourcePath);
  if (!sourceHasTranslation) {
    errors.push(`${label}: source is missing a link to the translation (language switcher)`);
  }
  if (!translationHasSource) {
    errors.push(`${label}: translation is missing a link to the source (language switcher)`);
  }

  // 2. Heading depth sequence.
  const sourceHeadings = headingDepths(source);
  const translationHeadings = headingDepths(translation);
  if (sourceHeadings.join(',') !== translationHeadings.join(',')) {
    errors.push(
      `${label}: heading depth sequence differs (${sourceHeadings.join(',')} vs ${translationHeadings.join(',')})`,
    );
  }

  // 3. Internal link targets (normalized across languages).
  const sourceTargets = extractLinkTargets(source)
    .map((target) => resolveInternalTarget(sourcePath, target))
    .filter(Boolean)
    .map((target) => normalizeForParity(target))
    .sort();
  const translationTargets = extractLinkTargets(translation)
    .map((target) => resolveInternalTarget(translationPath, target))
    .filter(Boolean)
    .map((target) => normalizeForParity(target))
    .sort();
  const linkDiff = diffSets(sourceTargets, translationTargets);
  if (linkDiff.onlyLeft.length || linkDiff.onlyRight.length) {
    errors.push(
      `${label}: link targets differ (source only: ${linkDiff.onlyLeft.join(', ') || '-'}; translation only: ${linkDiff.onlyRight.join(', ') || '-'})`,
    );
  }

  // 4. Every internal link must resolve to an existing file/directory.
  for (const [filePath, text, role] of [
    [sourcePath, source, 'source'],
    [translationPath, translation, 'translation'],
  ]) {
    for (const target of extractLinkTargets(text)) {
      if (isExternal(target)) continue;
      const abs = resolveInternalTarget(filePath, target);
      if (abs && !linkExists(abs)) {
        errors.push(`${label}: ${role} has a broken link: ${target}`);
      }
    }
  }

  // 5. Command/option token parity.
  const tokenDiff = diffSets(commandTokens(source), commandTokens(translation));
  if (tokenDiff.onlyLeft.length || tokenDiff.onlyRight.length) {
    errors.push(
      `${label}: command tokens differ (source only: ${tokenDiff.onlyLeft.join(' | ') || '-'}; translation only: ${tokenDiff.onlyRight.join(' | ') || '-'})`,
    );
  }

  // 6. Length sanity.
  const sourceLines = lineCount(source);
  const translationLines = lineCount(translation);
  if (sourceLines > 0) {
    const ratio = translationLines / sourceLines;
    if (ratio < 0.5 || ratio > 2.0) {
      errors.push(`${label}: line ratio ${ratio.toFixed(2)} outside 0.5~2.0`);
    }
  }

  // 7. English source should not contain prose in CJK.
  if (lang === 'zh-CN') {
    const ratio = cjkRatio(source);
    if (ratio > 0.02) {
      errors.push(`${label}: source CJK ratio ${(ratio * 100).toFixed(1)}% > 2%`);
    }
  }
}

function listRelativeFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const child of listRelativeFiles(full)) {
        files.push(toPosix(join(entry.name, child)));
      }
    } else {
      files.push(entry.name);
    }
  }
  return files.sort();
}

function checkSpecTemplates(errors) {
  const specRoot = join(repoRoot, 'packages/core/public/templates/spec');
  const zhRoot = join(specRoot, 'zh');
  const enRoot = join(specRoot, 'en');
  if (!existsSync(zhRoot) || !existsSync(enRoot)) {
    errors.push('spec templates: expected both spec/zh and spec/en');
    return 0;
  }

  const templateNames = (root) =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  const zhTemplates = templateNames(zhRoot);
  const enTemplates = templateNames(enRoot);
  const templateDiff = diffSets(zhTemplates, enTemplates);
  if (templateDiff.onlyLeft.length || templateDiff.onlyRight.length) {
    errors.push(
      `spec templates: template sets differ (zh only: ${templateDiff.onlyLeft.join(', ') || '-'}; en only: ${templateDiff.onlyRight.join(', ') || '-'})`,
    );
  }

  for (const name of zhTemplates.filter((item) => enTemplates.includes(item))) {
    const zhDir = join(zhRoot, name);
    const enDir = join(enRoot, name);
    const fileDiff = diffSets(listRelativeFiles(zhDir), listRelativeFiles(enDir));
    if (fileDiff.onlyLeft.length || fileDiff.onlyRight.length) {
      errors.push(
        `spec template ${name}: file sets differ (zh only: ${fileDiff.onlyLeft.join(', ') || '-'}; en only: ${fileDiff.onlyRight.join(', ') || '-'})`,
      );
    }

    for (const file of listRelativeFiles(enDir)) {
      const filePath = join(enDir, file);
      const content = read(filePath);
      if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(content)) {
        errors.push(`spec template ${name}: English file contains CJK: ${file}`);
      }
      if (file.endsWith('.md')) {
        const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (frontmatter) {
          for (const line of frontmatter[1].split(/\r?\n/)) {
            const match = line.match(/^(title|description):\s+(.*)$/);
            if (match && /:\s/.test(match[2]) && !/^["'>|]/.test(match[2])) {
              errors.push(
                `spec template ${name}: ${file} frontmatter ${match[1]} contains unquoted ': '`,
              );
            }
          }
        }
      }
      if (file === 'template.json') {
        try {
          const enManifest = JSON.parse(content);
          const zhManifest = JSON.parse(read(join(zhDir, file)));
          for (const key of ['defaultScope', 'source']) {
            if (enManifest[key] !== zhManifest[key]) {
              errors.push(`spec template ${name}: template.json ${key} differs`);
            }
          }
          const keyDiff = diffSets(Object.keys(zhManifest), Object.keys(enManifest));
          if (keyDiff.onlyLeft.length || keyDiff.onlyRight.length) {
            errors.push(`spec template ${name}: template.json keys differ`);
          }
        } catch (error) {
          errors.push(`spec template ${name}: invalid template.json (${error.message})`);
        }
      }
    }
  }

  return enTemplates.length;
}

function checkLinkFile(relPath, errors) {
  const filePath = join(repoRoot, relPath);
  if (!existsSync(filePath)) {
    errors.push(`linkCheck: file missing: ${relPath}`);
    return;
  }
  const text = read(filePath);
  for (const target of extractLinkTargets(text)) {
    if (isExternal(target)) continue;
    const abs = resolveInternalTarget(filePath, target);
    if (abs && !linkExists(abs)) {
      errors.push(`linkCheck: ${relPath} has a broken link: ${target}`);
    }
  }
}

function main() {
  let manifest;
  try {
    manifest = JSON.parse(read(manifestPath));
  } catch (error) {
    console.error(`✖ cannot read i18n-manifest.json: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const errors = [];
  const pairs = Array.isArray(manifest.pairs) ? manifest.pairs : [];
  if (pairs.length === 0) {
    console.error('✖ i18n-manifest.json has no pairs');
    process.exitCode = 1;
    return;
  }

  for (const pair of pairs) {
    const translations = pair.translations ?? {};
    for (const [lang, target] of Object.entries(translations)) {
      if (typeof target !== 'string' || !target) {
        errors.push(`${pair.source}: empty ${lang} translation path`);
        continue;
      }
      checkPair(pair, lang, errors);
    }
  }

  const linkCheckFiles = Array.isArray(manifest.linkCheck) ? manifest.linkCheck : [];
  for (const relPath of linkCheckFiles) {
    if (typeof relPath !== 'string' || !relPath) {
      errors.push('linkCheck: empty file path');
      continue;
    }
    checkLinkFile(relPath, errors);
  }

  const specTemplateCount = checkSpecTemplates(errors);

  if (errors.length) {
    console.error(`✖ docs i18n gate failed (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `✔ docs i18n gate passed (${pairs.length} pairs, ${linkCheckFiles.length} link-check files, ${specTemplateCount} spec templates)`,
  );
}

main();
