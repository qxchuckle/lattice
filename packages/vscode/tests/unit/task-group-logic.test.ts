import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DEFAULT_TIME_LEVELS, normalizeTaskGroupSetting } from '../../src/state/task-group-logic';

test('normalizeTaskGroupSetting：默认与非法输入回退 status + 月/日', () => {
  assert.deepEqual(normalizeTaskGroupSetting(undefined), {
    mode: 'status',
    levels: ['month', 'day'],
  });
  assert.deepEqual(normalizeTaskGroupSetting({ mode: 'bogus', levels: 'x' }), {
    mode: 'status',
    levels: ['month', 'day'],
  });
});

test('normalizeTaskGroupSetting：mode 保留；层级归一（去重/顺序）与空回退', () => {
  assert.deepEqual(normalizeTaskGroupSetting({ mode: 'created', levels: ['day', 'year', 'day'] }), {
    mode: 'created',
    levels: ['year', 'day'],
  });
  assert.deepEqual(normalizeTaskGroupSetting({ mode: 'updated', levels: [] }), {
    mode: 'updated',
    levels: [...DEFAULT_TIME_LEVELS],
  });
  assert.deepEqual(normalizeTaskGroupSetting({ mode: 'status', levels: ['year'] }), {
    mode: 'status',
    levels: ['year'],
  });
});
