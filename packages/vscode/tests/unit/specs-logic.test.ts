import assert from 'node:assert/strict';
import { test } from 'vitest';
import { uniqueSuffixId } from '../../src/views/specs-logic';

test('首见保持原样，重复追加 ~N（不丢数据）', () => {
  const seen = new Set<string>();
  assert.equal(uniqueSuffixId('g/spec-project/s:a', seen), 'g/spec-project/s:a');
  assert.equal(uniqueSuffixId('g/spec-project/s:a', seen), 'g/spec-project/s:a~2');
  assert.equal(uniqueSuffixId('g/spec-project/s:a', seen), 'g/spec-project/s:a~3');
  assert.equal(uniqueSuffixId('g/spec-project/s:b', seen), 'g/spec-project/s:b');
});

test('已占用 ~2 时顺延到 ~3', () => {
  const seen = new Set<string>(['x', 'x~2']);
  assert.equal(uniqueSuffixId('x', seen), 'x~3');
});
