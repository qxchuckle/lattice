import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DocsSyncError,
  extractDescription,
  extractTitle,
  normalizeHeadings,
  rewriteLink,
  stripLanguageSwitcher,
  transformDoc,
} from '../sync-docs.mjs';
import { docItems, outputPath } from '../docs-nav.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../../..');
const item = (slug) => docItems.find((entry) => entry.slug === slug);
const context = (slug, locale = 'root') => ({ locale, currentItem: item(slug) });

test('extractTitle ignores headings inside code fences', () => {
  const lines = ['```bash', '# not a title', '```', '', '# Real title'];
  assert.deepEqual(extractTitle(lines), { index: 4, title: 'Real title' });
});

test('extractTitle reports a missing H1', () => {
  assert.equal(extractTitle(['## Only a section']), null);
});

test('stripLanguageSwitcher removes the GitHub-only line and collapses the gap', () => {
  const lines = ['# Doc', '', '> English | [简体中文](./x.zh-CN.md)', '', 'Body'];
  assert.deepEqual(stripLanguageSwitcher(lines), ['# Doc', '', 'Body']);
});

test('relative doc links become site links in the same locale', () => {
  assert.equal(rewriteLink('./quick-start.md#install', context('docs')), 'quick-start/#install');
  assert.equal(
    rewriteLink('./quick-start.md#install', context('docs/concepts')),
    '../quick-start/#install',
  );
  assert.equal(
    rewriteLink('./quick-start.md', context('docs/concepts', 'zh-cn')),
    '../quick-start/',
  );
  assert.equal(
    rewriteLink('./architecture.md', context('docs/concepts', 'zh-cn')),
    '../architecture/',
  );
});

test('links outside docs become GitHub blob URLs', () => {
  assert.equal(
    rewriteLink('../packages/core/README.md', context('docs')),
    'https://github.com/qxchuckle/lattice/blob/master/packages/core/README.md',
  );
  assert.equal(
    rewriteLink('../README.zh-CN.md', context('docs', 'zh-cn')),
    'https://github.com/qxchuckle/lattice/blob/master/README.zh-CN.md',
  );
  assert.equal(rewriteLink('https://example.com/x', context('docs')), 'https://example.com/x');
});

test('transformDoc derives frontmatter, strips the H1 and switches line, rewrites links', () => {
  const source = [
    '# Core concepts',
    '',
    '> English | [简体中文](./concepts.zh-CN.md)',
    '',
    'Intro with [quick start](./quick-start.md).',
    '',
    '## Specs',
    '',
    'Body.',
  ].join('\n');
  const { content, title, description } = transformDoc(source, {
    locale: 'root',
    item: item('docs/concepts'),
  });
  assert.equal(title, 'Core concepts');
  assert.match(description, /Intro with quick start/);
  assert.match(content, /^---\ntitle: "Core concepts"/);
  assert.match(content, /sidebar:\n {2}order: 3/);
  assert.match(content, /\[quick start\]\(\.\.\/quick-start\/\)/);
  assert.doesNotMatch(content, /简体中文/);
  assert.equal(content.match(/^# /gm), null);
});

test('transformDoc lifts a stranded h4 so the TOC can reach it', () => {
  const source = ['# Doc', '', 'Intro.', '', '#### Deep', '', 'Body.'].join('\n');
  const { content } = transformDoc(source, { locale: 'root', item: item('docs/concepts') });
  assert.match(content, /^### Deep$/m);
});

test('normalizeHeadings keeps h4 when an h3 parent exists', () => {
  const result = normalizeHeadings(['## A', '### B', '#### C']);
  assert.equal(result.lifted, 0);
  assert.deepEqual(result.lines, ['## A', '### B', '#### C']);
});

test('extractDescription skips tables, lists and fenced blocks', () => {
  const lines = ['| a | b |', '', '```bash', 'ltc web', '```', '', 'Real *description* here.'];
  assert.equal(extractDescription(lines), 'Real description here.');
});

test('transformDoc rejects a document without an H1', () => {
  assert.throws(
    () => transformDoc('## Section', { locale: 'root', item: item('docs/concepts') }),
    (error) => error instanceof DocsSyncError && error.code === 'E6',
  );
});

test('every repo doc is mapped to both locales and generated paths are unique', () => {
  const paths = new Set();
  for (const entry of docItems) {
    for (const locale of ['root', 'zh-cn']) {
      const path = outputPath(entry, locale);
      assert.equal(paths.has(path), false, `duplicate output ${path}`);
      paths.add(path);
    }
    const source = readFileSync(resolve(repoRoot, entry.source), 'utf8');
    assert.match(source, /^# \S/m, `${entry.source} needs an H1`);
  }
  assert.equal(paths.size, docItems.length * 2);
});
