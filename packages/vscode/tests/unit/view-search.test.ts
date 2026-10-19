import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  EMPTY_VIEW_SEARCH,
  isViewSearchActive,
  matchesViewSearch,
  viewSearchMatchFlags,
} from '../../src/views/view-search-logic';

test('空查询：全部通过；isViewSearchActive 判定', () => {
  assert.equal(isViewSearchActive(EMPTY_VIEW_SEARCH), false);
  assert.equal(isViewSearchActive({ query: '  ', contentIds: [] }), false);
  assert.equal(isViewSearchActive({ query: ' x ', contentIds: [] }), true);
  assert.equal(matchesViewSearch({ fields: ['任意'], state: EMPTY_VIEW_SEARCH }), true);
  assert.equal(matchesViewSearch({ fields: ['任意'], state: undefined }), true);
});

test('名称字段：大小写不敏感子串命中（含 null/undefined 安全）', () => {
  const state = { query: 'Cascade', contentIds: [] };
  assert.equal(
    matchesViewSearch({ fields: [null, undefined, 'Spec 级联 cascade 覆盖'], state }),
    true,
  );
  assert.equal(matchesViewSearch({ fields: ['无关内容'], state }), false);
});

test('contentIds：全文字段并集命中', () => {
  const state = { query: '某正文词', contentIds: ['task-abc', 'spec-xyz'] };
  assert.equal(matchesViewSearch({ fields: ['标题不含'], ids: ['task-abc'], state }), true);
  assert.equal(matchesViewSearch({ fields: ['标题不含'], ids: ['other-id'], state }), false);
  assert.equal(matchesViewSearch({ fields: ['标题不含'], ids: [], state }), false);
});

test('名称命中优先于 contentIds（任一命中即通过）', () => {
  const state = { query: 'alpha', contentIds: [] };
  assert.equal(matchesViewSearch({ fields: ['Alpha Project'], ids: ['x'], state }), true);
});

test('viewSearchMatchFlags：区分名称命中与仅全文命中', () => {
  const state = { query: 'abc', contentIds: ['id-1'] };
  assert.deepEqual(viewSearchMatchFlags({ fields: ['ABC title'], ids: ['id-1'], state }), {
    matched: true,
    nameMatched: true,
  });
  assert.deepEqual(viewSearchMatchFlags({ fields: ['no match'], ids: ['id-1'], state }), {
    matched: true,
    nameMatched: false,
  });
  assert.deepEqual(viewSearchMatchFlags({ fields: ['no match'], ids: ['other'], state }), {
    matched: false,
    nameMatched: false,
  });
});
