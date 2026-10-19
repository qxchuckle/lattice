import assert from 'node:assert/strict';
import { test } from 'vitest';
import { TaskFilterState, taskMatchesFilter } from '../../src/state/task-filter-logic';

const task = (status: string, projects: string[]) => ({ status, projects });
const canonical = (id: string): string => (id === 'p/alias' ? 'p1' : id);

test('空过滤：全部通过', () => {
  assert.equal(
    taskMatchesFilter(task('planning', ['p1']), { statuses: [], projectIds: [] }, canonical),
    true,
  );
});

test('状态维度：集内 OR，未命中排除', () => {
  const filter: TaskFilterState = { statuses: ['planning', 'completed'], projectIds: [] };
  assert.equal(taskMatchesFilter(task('planning', []), filter, canonical), true);
  assert.equal(taskMatchesFilter(task('completed', []), filter, canonical), true);
  assert.equal(taskMatchesFilter(task('in_progress', []), filter, canonical), false);
});

test('项目维度：canonical 归一后比对（别名命中主 ID）', () => {
  const filter: TaskFilterState = { statuses: [], projectIds: ['p/alias'] };
  assert.equal(taskMatchesFilter(task('planning', ['p1']), filter, canonical), true);
  assert.equal(taskMatchesFilter(task('planning', ['p2']), filter, canonical), false);
});

test('两维 AND：状态与项目都需命中', () => {
  const filter: TaskFilterState = { statuses: ['planning'], projectIds: ['p1'] };
  assert.equal(taskMatchesFilter(task('planning', ['p1']), filter, canonical), true);
  assert.equal(taskMatchesFilter(task('in_progress', ['p1']), filter, canonical), false);
  assert.equal(taskMatchesFilter(task('planning', ['p2']), filter, canonical), false);
});
