import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { expandHome, isPathInside, normalizeLegacyId, stripIdPrefix } from '../../src/util/paths';
import { extractSpecIds } from '../../src/util/spec-links';

test('isPathInside: 路径段对齐（防 /foo 匹配 /foobar）', () => {
  assert.equal(isPathInside('/a/foo', '/a/foo/bar.txt'), true);
  assert.equal(isPathInside('/a/foo', '/a/foo'), true);
  assert.equal(isPathInside('/a/foo', '/a/foobar/x.txt'), false);
  assert.equal(isPathInside('/a/foo', '/a/other'), false);
});

test('normalizeLegacyId / stripIdPrefix', () => {
  assert.equal(normalizeLegacyId('abc123'), 'legacy:abc123');
  assert.equal(normalizeLegacyId('git:abc123'), 'git:abc123');
  assert.equal(stripIdPrefix('legacy:abc123'), 'abc123');
  assert.equal(stripIdPrefix('abc123'), 'abc123');
});

test('expandHome', () => {
  assert.equal(expandHome('~', '/Users/x'), '/Users/x');
  assert.equal(expandHome('~/a/b', '/Users/x'), path.join('/Users/x', 'a', 'b'));
  assert.equal(expandHome('/abs/path', '/Users/x'), '/abs/path');
});

test('extractSpecIds: 命中 / 边界 / 大小写', () => {
  const hits = extractSpecIds('see spec-gm2b5wvr and SPEC-ABCDEF12 end');
  assert.deepEqual(
    hits.map((h) => h.id),
    ['spec-gm2b5wvr', 'spec-abcdef12'],
  );
  // 非边界（前面是单词字符）不命中
  assert.equal(extractSpecIds('xspec-abcdef12').length, 0);
  // 8 位后接单词字符（更长 id）不命中
  assert.equal(extractSpecIds('spec-abcdef12x').length, 0);
  // 不足 8 位不命中
  assert.equal(extractSpecIds('spec-abc12').length, 0);
  assert.equal(extractSpecIds('spec-12').length, 0);
  // index 正确
  const one = extractSpecIds('a spec-gm2b5wvr b');
  assert.equal(one.length, 1);
  assert.equal(one[0].index, 2);
});
