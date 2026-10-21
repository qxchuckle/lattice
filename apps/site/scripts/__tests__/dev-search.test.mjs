import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildDevSearchIndex, collectDevSearchRecords, markdownToText } from '../dev-search.mjs';
import { docItems } from '../docs-nav.mjs';

test('markdownToText keeps prose and code but drops Markdown syntax', () => {
  const text = markdownToText(
    [
      '# Title',
      '',
      'Intro with [quick start](./quick-start.md) and `ltc web`.',
      '',
      '```bash',
      'ltc task start auth-guard',
      '```',
      '',
      '- list item',
      '| a | b |',
    ].join('\n'),
  );
  assert.match(text, /Intro with quick start and ltc web\./);
  assert.match(text, /ltc task start auth-guard/);
  assert.match(text, /list item/);
  assert.doesNotMatch(text, /\]\(/);
  assert.doesNotMatch(text, /```/);
  assert.doesNotMatch(text, /^# /m);
});

test('dev search records cover the landing page and every doc in both locales', () => {
  const records = collectDevSearchRecords();
  assert.equal(records.length, (docItems.length + 1) * 2);
  assert.deepEqual([...new Set(records.map((record) => record.language))].sort(), ['en', 'zh-cn']);

  const landing = records.find((record) => record.url === '/');
  assert.equal(landing?.language, 'en');
  assert.match(landing?.meta.title ?? '', /Engineering memory/);

  const chineseLanding = records.find((record) => record.url === '/zh-cn/');
  assert.equal(chineseLanding?.language, 'zh-cn');
  assert.match(chineseLanding?.meta.title ?? '', /工程记忆/);

  const english = records.find((record) => record.url === '/docs/architecture/');
  assert.equal(english?.language, 'en');
  assert.match(english?.meta.title ?? '', /Lattice Architecture/);

  const chinese = records.find((record) => record.url === '/zh-cn/docs/architecture/');
  assert.equal(chinese?.language, 'zh-cn');
  assert.match(chinese?.meta.title ?? '', /Lattice 技术架构详解/);

  for (const record of records) {
    assert.match(record.url, /^\/(?:zh-cn\/)?(?:docs\/|$)/);
    assert.ok(record.meta.title.length > 0);
    assert.ok(record.content.length > 0);
  }
});

test('dev search builds a Pagefind index with both languages', async () => {
  const outputPath = mkdtempSync(join(tmpdir(), 'lattice-dev-search-'));
  try {
    const result = await buildDevSearchIndex(outputPath);
    assert.equal(result.pages, (docItems.length + 1) * 2);
    assert.equal(existsSync(join(outputPath, 'pagefind.js')), true);

    const entry = JSON.parse(readFileSync(join(outputPath, 'pagefind-entry.json'), 'utf8'));
    assert.deepEqual(Object.keys(entry.languages).sort(), ['en', 'zh-cn']);
    assert.equal(entry.languages.en.page_count, docItems.length + 1);
    assert.equal(entry.languages['zh-cn'].page_count, docItems.length + 1);
  } finally {
    rmSync(outputPath, { recursive: true, force: true });
  }
});
