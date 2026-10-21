#!/usr/bin/env node
/**
 * Generate Starlight pages from the repository docs (`docs/*.md`).
 *
 * The repo docs are the single source of truth. This script derives the site copy so the two can
 * never drift: frontmatter (title/description/sidebar order), the language switcher line, relative
 * links and the `*.zh-CN.md` → `zh-cn/` layout are all computed here.
 *
 * Generated output is git-ignored. `--check` verifies coverage, translations, orphans and freshness
 * without writing.
 *
 * Usage: node scripts/sync-docs.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentDir,
  defaultBranch,
  docItems,
  outputPath,
  repositoryUrl,
  routeSegments,
  translationSource,
} from './docs-nav.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(scriptDir, '..');
const repoRoot = resolve(siteRoot, '../..');
const contentRoot = join(siteRoot, 'src/content/docs');
const MARKER =
  '<!-- Generated from the repository docs by apps/site/scripts/sync-docs.mjs. Do not edit. -->';
const FENCE_RE = /^(```|~~~)/;

export class DocsSyncError extends Error {
  constructor(code, message) {
    super(`[docs-sync:${code}] ${message}`);
    this.code = code;
  }
}

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function isFence(line) {
  return FENCE_RE.test(line.trim());
}

/** Split YAML frontmatter off a document. Repo docs should not have any. */
function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { frontmatter: '', body: text };
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) return { frontmatter: '', body: text };
  return {
    frontmatter: text.slice(4, end),
    body: text.slice(end + '\n---\n'.length),
  };
}

function stripInlineMarkdown(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove the `> English | 简体中文` line that only makes sense on GitHub. */
export function stripLanguageSwitcher(lines) {
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isSwitcher =
      index < 15 && line.startsWith('>') && line.includes('English') && line.includes('简体中文');
    if (!isSwitcher) {
      output.push(line);
      continue;
    }
    if (output.length > 0 && output[output.length - 1] === '' && lines[index + 1] === '') {
      index += 1;
    }
  }
  return output;
}

/** First H1 outside code fences: it becomes the Starlight title. */
export function extractTitle(lines) {
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) return { index, title: stripInlineMarkdown(match[1]) };
  }
  return null;
}

/** Markdown links in repo docs are relative to `docs/`; site pages live one level deeper. */
export function rewriteLink(target, { locale, currentItem }) {
  const match = target.match(/^(\S+)(\s+["'][^"']*["'])?$/);
  if (!match) return target;
  const url = match[1];
  const suffix = match[2] ?? '';
  if (!url || /^(?:https?:|mailto:|tel:|#|\/)/i.test(url)) return target;

  const hashIndex = url.indexOf('#');
  const pathPart = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  if (!pathPart) return target;

  const resolved = posix.normalize(posix.join(posix.dirname(currentItem.source), pathPart));

  // A page under docs/ → another site page in the same locale.
  if (resolved.startsWith('docs/') && resolved.endsWith('.md')) {
    const logical = 'docs/' + resolved.slice('docs/'.length).replace(/\.zh-CN\.md$/, '.md');
    const targetItem = docItems.find((item) => item.source === logical);
    if (targetItem) {
      const from = '/' + routeSegments(currentItem, locale).join('/');
      const to = '/' + routeSegments(targetItem, locale).join('/');
      const relative = posix.relative(from, to) || '.';
      return `${relative === '.' ? './' : `${relative}/`}${hash}${suffix}`;
    }
  }

  // Everything else lives in the repo: point at GitHub.
  const repoPath = resolved.replace(/^\.\//, '');
  return `${repositoryUrl}/blob/${defaultBranch}/${repoPath}${hash}${suffix}`;
}

function linkify(line, context) {
  return line.replace(
    /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+["'][^"']*["'])?\))/g,
    (whole, head, target, tail) => {
      const rewritten = rewriteLink(target, context);
      return `${head}${rewritten}${tail}`;
    },
  );
}

/** Starlight renders h2/h3 in the TOC; lift a stranded h4 so it stays reachable. */
export function normalizeHeadings(lines) {
  let inFence = false;
  let hasH3 = false;
  let lifted = 0;
  const output = lines.map((line) => {
    if (isFence(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      hasH3 = false;
      return line;
    }
    if (/^###\s+/.test(line) && !/^####/.test(line)) {
      hasH3 = true;
      return line;
    }
    if (/^####\s+/.test(line) && !hasH3) {
      lifted += 1;
      return line.replace(/^####\s+/, '### ');
    }
    return line;
  });
  return { lines: output, lifted };
}

/** First prose paragraph, used as the meta description. */
export function extractDescription(lines) {
  let inFence = false;
  const collected = [];
  for (const line of lines) {
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (!trimmed) {
      if (collected.length) break;
      continue;
    }
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('>') ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('-') ||
      /^\d+\.\s/.test(trimmed) ||
      trimmed.startsWith('<') ||
      trimmed.startsWith('![')
    ) {
      if (collected.length) break;
      continue;
    }
    collected.push(trimmed);
    if (collected.length === 2) break;
  }
  if (!collected.length) return '';
  const text = stripInlineMarkdown(collected.join(' '));
  if (text.length <= 155) return text;
  const cut = text.slice(0, 155);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > 120 ? cut.slice(0, lastSpace) : cut;
  return `${safe.replace(/[.,;:，。；：]$/, '')}…`;
}

function yamlString(value) {
  return JSON.stringify(value);
}

/**
 * Pure transform: repo doc text → generated site doc text.
 * Exported for unit tests.
 */
export function transformDoc(text, { locale, item }) {
  const { body } = splitFrontmatter(text);
  let lines = body.split('\n');
  const heading = extractTitle(lines);
  if (!heading) {
    throw new DocsSyncError('E6', `${item.source} has no H1 title`);
  }
  const title = heading.title;
  lines.splice(heading.index, 1);
  lines = stripLanguageSwitcher(lines);
  const context = { locale, currentItem: item };
  lines = lines.map((line) => linkify(line, context));
  const normalized = normalizeHeadings(lines);
  const description = extractDescription(normalized.lines);
  const bodyText = normalized.lines
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  const order = docItems.indexOf(item) + 1;
  const frontmatter = ['---', `title: ${yamlString(title)}`];
  if (description) frontmatter.push(`description: ${yamlString(description)}`);
  frontmatter.push('sidebar:', `  order: ${order}`, '---');
  return {
    title,
    description,
    liftedHeadings: normalized.lifted,
    content: `${frontmatter.join('\n')}\n${MARKER}\n\n${bodyText}\n`,
  };
}

function listMarkdownFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function relativePosix(root, file) {
  return file
    .slice(root.length + 1)
    .split('\\')
    .join('/');
}

/** Verify repo coverage: every docs page is mapped, translated, and no page is orphaned. */
export function checkCoverage(root = repoRoot) {
  const errors = [];
  const docsDir = join(root, 'docs');
  const english = readdirSync(docsDir)
    .filter((name) => name.endsWith('.md') && !name.endsWith('.zh-CN.md'))
    .sort();

  for (const name of english) {
    const source = `docs/${name}`;
    if (!docItems.some((item) => item.source === source)) {
      errors.push(`[docs-sync:E2] ${source} is not registered in apps/site/scripts/docs-nav.mjs`);
      continue;
    }
    const translation = translationSource(source);
    if (!existsSync(join(root, translation))) {
      errors.push(`[docs-sync:E3] ${source} is missing its translation ${translation}`);
    }
  }

  for (const item of docItems) {
    if (!existsSync(join(root, item.source))) {
      errors.push(`[docs-sync:E1] nav source is missing: ${item.source}`);
    }
    const translation = translationSource(item.source);
    if (!existsSync(join(root, translation))) {
      errors.push(`[docs-sync:E3] ${item.source} is missing its translation ${translation}`);
    }
  }

  return errors;
}

/** Build the full expected output map: relative generated path → content. */
export function buildExpectedOutputs(root = repoRoot) {
  const outputs = new Map();
  const warnings = [];
  for (const item of docItems) {
    for (const [locale, sourceSuffix] of [
      ['root', ''],
      ['zh-cn', '.zh-CN'],
    ]) {
      const source = item.source.replace(/\.md$/, `${sourceSuffix}.md`);
      const text = read(join(root, source));
      const rendered = transformDoc(text, { locale, item });
      if (rendered.liftedHeadings > 0) {
        warnings.push(
          `${source}: lifted ${rendered.liftedHeadings} stranded h4 heading(s) to h3 in the site copy`,
        );
      }
      outputs.set(outputPath(item, locale), rendered.content);
    }
  }
  return { outputs, warnings };
}

function findOrphans(outputs) {
  const expected = new Set(outputs.keys());
  const orphans = [];
  for (const locale of ['root', 'zh-cn']) {
    const dir = join(contentRoot, contentDir(locale));
    for (const file of listMarkdownFiles(dir)) {
      const rel = relativePosix(contentRoot, file);
      if (!expected.has(rel)) orphans.push(rel);
    }
  }
  return orphans;
}

function sameContent(left, right) {
  return left.replace(/\r\n/g, '\n') === right.replace(/\r\n/g, '\n');
}

export function verifySync() {
  const errors = checkCoverage();
  if (errors.length) return { errors, warnings: [] };
  const { outputs, warnings } = buildExpectedOutputs();
  for (const [rel, content] of outputs) {
    const target = join(contentRoot, rel);
    if (!existsSync(target)) {
      errors.push(`[docs-sync:E5] generated page is missing: ${rel}`);
      continue;
    }
    if (!sameContent(read(target), content)) {
      errors.push(`[docs-sync:E5] generated page is stale: ${rel} (run pnpm sync:docs)`);
    }
  }
  for (const rel of findOrphans(outputs)) {
    errors.push(`[docs-sync:E4] orphan generated page: ${rel} (not in docs-nav.mjs)`);
  }
  return { errors, warnings };
}

export function writeSync() {
  const errors = checkCoverage();
  if (errors.length) return { errors, warnings: [] };
  const { outputs, warnings } = buildExpectedOutputs();
  for (const [rel, content] of outputs) {
    const target = join(contentRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target) && sameContent(read(target), content)) continue;
    writeFileSync(target, content);
  }
  for (const rel of findOrphans(outputs)) {
    rmSync(join(contentRoot, rel));
  }
  return { errors, warnings };
}

function main() {
  const check = process.argv.includes('--check');
  let result;
  try {
    result = check ? verifySync() : writeSync();
  } catch (error) {
    if (error instanceof DocsSyncError) {
      console.error(`✖ docs sync failed:\n  - ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  const { errors, warnings } = result;
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (errors.length) {
    console.error(`✖ docs sync failed (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  const count = docItems.length * 2;
  console.log(
    check
      ? `✔ docs sync is up to date (${docItems.length} pages × 2 locales, ${count} files)`
      : `✔ docs synced (${docItems.length} pages × 2 locales, ${count} files)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
