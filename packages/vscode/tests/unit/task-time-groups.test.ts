import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { TaskRow } from '../../src/cli/types';
import {
  TIME_LEVEL_ORDER,
  TIME_LEVEL_SEGMENT,
  buildTimeGroups,
  localDateParts,
  normalizeTimeLevels,
  taskTimeKeys,
  type TimeLevel,
} from '../../src/views/task-time-groups';

/** 本地时区构造 ISO（测试不依赖运行机器时区）。 */
const localIso = (y: number, m: number, d: number, hour = 12): string =>
  new Date(y, m - 1, d, hour).toISOString();

const mk = (id: string, created?: string, updated?: string): TaskRow => ({
  id,
  title: id,
  status: 'planning',
  projects: [],
  scopePaths: [],
  referencedSpecs: [],
  created,
  updated,
});

test('normalizeTimeLevels：去重 + 固定顺序（年>月>日）+ 过滤非法值', () => {
  assert.deepEqual(normalizeTimeLevels(['day', 'year', 'day', 'bogus']), ['year', 'day']);
  assert.deepEqual(normalizeTimeLevels([]), []);
  assert.deepEqual(TIME_LEVEL_ORDER, ['year', 'month', 'day']);
  assert.deepEqual(TIME_LEVEL_SEGMENT, { year: 'y', month: 'm', day: 'd' });
});

test('localDateParts / taskTimeKeys：本地日期部件与层级键；缺失回退对侧字段', () => {
  const t1 = mk('t1', localIso(2026, 10, 19, 9));
  assert.deepEqual(localDateParts(t1.created), {
    year: '2026',
    month: '2026-10',
    day: '2026-10-19',
  });
  assert.deepEqual(taskTimeKeys(t1, 'created', ['month', 'day']), ['2026-10', '2026-10-19']);
  assert.equal(taskTimeKeys(mk('t2'), 'created', ['day']), undefined);
  // created 缺失 → 基准 created 回退 updated
  const t3 = mk('t3', undefined, localIso(2025, 3, 1));
  assert.deepEqual(taskTimeKeys(t3, 'created', ['year']), ['2025']);
  assert.equal(localDateParts('not-a-date'), undefined);
});

test('buildTimeGroups：年/月/日三级嵌套、计数、组内倒序与 flat 遍历序', () => {
  const tasks = [
    mk('a', localIso(2026, 10, 19, 9)),
    mk('b', localIso(2026, 10, 19, 21)),
    mk('c', localIso(2026, 10, 1)),
    mk('d', localIso(2026, 9, 30)),
    mk('e', localIso(2025, 12, 31)),
  ];
  const { roots, unknown, flat } = buildTimeGroups(tasks, 'created', ['year', 'month', 'day']);
  assert.deepEqual(unknown, []);
  assert.deepEqual(
    roots.map((n) => n.key),
    ['2026', '2025'],
  );
  assert.equal(roots[0].count, 4);
  assert.deepEqual(
    roots[0].children.map((n) => n.key),
    ['2026-10', '2026-09'],
  );
  assert.deepEqual(
    roots[0].children[0].children.map((n) => n.key),
    ['2026-10-19', '2026-10-01'],
  );
  // 组内按基准时间倒序：b(21时) 在 a(9时) 前
  assert.deepEqual(
    roots[0].children[0].children[0].tasks.map((t) => t.id),
    ['b', 'a'],
  );
  assert.equal(roots[0].children[0].children[0].count, 2);
  assert.deepEqual(
    flat.map((t) => t.id),
    ['b', 'a', 'c', 'd', 'e'],
  );
});

test('buildTimeGroups：单级层级（平铺按天/按月/按年）', () => {
  const tasks = [
    mk('a', localIso(2026, 10, 19)),
    mk('b', localIso(2026, 10, 19, 8)),
    mk('c', localIso(2026, 9, 1)),
  ];
  const byDay = buildTimeGroups(tasks, 'created', ['day']);
  assert.deepEqual(
    byDay.roots.map((n) => n.key),
    ['2026-10-19', '2026-09-01'],
  );
  assert.equal(byDay.roots[0].children.length, 0);
  assert.deepEqual(
    byDay.roots[0].tasks.map((t) => t.id),
    ['a', 'b'],
  );
  const byMonth = buildTimeGroups(tasks, 'created', ['month']);
  assert.deepEqual(
    byMonth.roots.map((n) => n.key),
    ['2026-10', '2026-09'],
  );
  const byYear = buildTimeGroups(tasks, 'created', ['year']);
  assert.deepEqual(
    byYear.roots.map((n) => n.key),
    ['2026'],
  );
});

test('buildTimeGroups：层级乱序/非法输入归一；缺失时间归入 unknown 且不入 flat', () => {
  const tasks = [
    mk('a', localIso(2026, 10, 19)),
    mk('x', undefined, undefined),
    mk('y', undefined, undefined),
  ];
  const invalid = ['day', 'day', 'bogus'] as unknown as TimeLevel[];
  const result = buildTimeGroups(tasks, 'created', invalid);
  assert.deepEqual(
    result.roots.map((n) => n.key),
    ['2026-10-19'],
  );
  assert.deepEqual(
    result.unknown.map((t) => t.id),
    ['x', 'y'],
  );
  assert.deepEqual(
    result.flat.map((t) => t.id),
    ['a'],
  );
  // levels 为空 → 退化为按天
  const fallback = buildTimeGroups(tasks, 'created', []);
  assert.deepEqual(
    fallback.roots.map((n) => n.key),
    ['2026-10-19'],
  );
});

test('buildTimeGroups：updated 基准与 created 基准可得出不同分组', () => {
  const tasks = [
    mk('a', localIso(2026, 1, 1), localIso(2026, 10, 19)),
    mk('b', localIso(2026, 10, 1), localIso(2026, 10, 1)),
  ];
  const created = buildTimeGroups(tasks, 'created', ['month']);
  const updated = buildTimeGroups(tasks, 'updated', ['month']);
  assert.deepEqual(
    created.roots.map((n) => n.key),
    ['2026-10', '2026-01'],
  );
  assert.deepEqual(
    updated.roots.map((n) => n.key),
    ['2026-10'],
  );
  assert.deepEqual(
    updated.roots[0].tasks.map((t) => t.id),
    ['a', 'b'],
  );
});
