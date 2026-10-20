import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatRagTimestamp } from '../../src/utils/rag-time';

test('formatRagTimestamp：空值/非法值/正常时间', () => {
  assert.equal(formatRagTimestamp(null), '暂无构建记录');
  assert.equal(formatRagTimestamp(''), '暂无构建记录');
  assert.equal(formatRagTimestamp('not-a-date'), 'not-a-date');
  assert.match(formatRagTimestamp('2026-01-02 03:04:05'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});
