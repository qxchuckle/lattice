import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isColumnTable, toRows, strArray, truncate } from '../../src/cli/parsers';

test('toRows: 列式表按列名对齐（列序无关）', () => {
  const table = {
    cols: ['filePath', 'title', 'id'],
    rows: [
      ['/a/b.md', 'Title A', 'spec-1'],
      ['/c/d.md', 'Title B', 'spec-2'],
    ],
  };
  assert.equal(isColumnTable(table), true);
  const rows = toRows(table);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].filePath, '/a/b.md');
  assert.equal(rows[1].title, 'Title B');
  assert.equal(rows[1].id, 'spec-2');
});

test('toRows: 空列式表 → 空数组', () => {
  assert.deepEqual(toRows({ cols: [], rows: [] }), []);
});

test('toRows: 对象数组 / 单对象 / null', () => {
  assert.deepEqual(toRows([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(toRows({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(toRows(null), []);
  assert.deepEqual(toRows(undefined), []);
  assert.deepEqual(toRows('str'), []);
});

test('toRows: 列式表缺失单元格 → undefined（缺列容忍）', () => {
  const rows = toRows({ cols: ['a', 'b'], rows: [[1], [2, 3]] });
  assert.equal(rows[0].a, 1);
  assert.equal(rows[0].b, undefined);
  assert.equal(rows[1].b, 3);
});

test('strArray / truncate', () => {
  assert.deepEqual(strArray(['a', 1, 'b']), ['a', 'b']);
  assert.deepEqual(strArray('nope'), []);
  assert.equal(truncate('  hello   world  ', 8), 'hello wo…');
  assert.equal(truncate(undefined, 8), '');
});
