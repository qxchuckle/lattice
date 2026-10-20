import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chunkMarkdown } from '../src/rag/chunker';

test('chunkMarkdown：无标题长文/短文', () => {
  const long = 'a'.repeat(80);
  const chunks = chunkMarkdown(long, 'Doc Title');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].headingLevel, 0);
  assert.equal(chunks[0].headingPath, 'Doc Title');
  assert.equal(chunks[0].headingTitle, 'Doc Title');
  assert.equal(chunks[0].parentChunkIndex, null);
  assert.equal(chunks[0].content, long);

  assert.deepEqual(chunkMarkdown('   ', 'Empty'), []);
});

test('chunkMarkdown：标题层级、parent 与 headingPath', () => {
  const content = [
    '# Root',
    '',
    'root body content that is definitely long enough to keep'.repeat(2),
    '## Child',
    '',
    'child body content that is definitely long enough to keep'.repeat(2),
    '### Grand',
    '',
    'grand body content that is definitely long enough to keep'.repeat(2),
    '## Sibling',
    '',
    'sibling body content that is definitely long enough to keep'.repeat(2),
  ].join('\n');
  const chunks = chunkMarkdown(content, 'T');
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].headingPath, 'Root');
  assert.equal(chunks[0].parentChunkIndex, null);
  assert.equal(chunks[1].headingPath, 'Root > Child');
  assert.equal(chunks[1].parentChunkIndex, 0);
  assert.equal(chunks[2].headingPath, 'Root > Child > Grand');
  assert.equal(chunks[2].parentChunkIndex, 1);
  assert.equal(chunks[3].headingPath, 'Root > Sibling');
  assert.equal(chunks[3].parentChunkIndex, 0);
});

test('chunkMarkdown：frontmatter 剥离 / 代码块内 # 不解析 / 引言隐式 chunk', () => {
  const content = [
    '---',
    'title: Front',
    '---',
    'intro before heading',
    '# Real Heading',
    'body',
    '```',
    '# not a heading',
    '```',
    'tail',
  ].join('\n');
  const chunks = chunkMarkdown(content, 'Doc', 0);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].headingLevel, 0, '引言为隐式 chunk');
  assert.match(chunks[0].content, /intro before heading/);
  assert.ok(!chunks[0].content.includes('# Real Heading'), '标题行开启新 chunk');
  assert.equal(chunks[1].headingTitle, 'Real Heading');
  assert.match(chunks[1].content, /# not a heading/);
});

test('chunkMarkdown：小 chunk 合并到父级并重编号', () => {
  const content = [
    '# Parent',
    'parent content long enough to stay in the output',
    '## Tiny',
    'x',
  ].join('\n');
  const merged = chunkMarkdown(content, 'Doc', 50);
  assert.equal(merged.length, 1);
  assert.match(merged[0].content, /Tiny/);
  assert.match(merged[0].content, /parent content/);

  const notMerged = chunkMarkdown(content, 'Doc', 0);
  assert.equal(notMerged.length, 2);
  assert.equal(notMerged[1].parentChunkIndex, 0);

  // 只有一个 chunk 时 merge 直接返回
  assert.equal(chunkMarkdown('short', 'Doc', 1000).length, 1);
});
