import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  parseListValue,
  projectMatchesFilter,
  searchResultMatchesFilter,
  specMatchesFilter,
} from '../../src/views/filter-logic';

const canonical = (id: string): string => (id === 'p/alias' ? 'p1' : id);

test('parseListValue：逗号串 → 去重去空白列表', () => {
  assert.deepEqual(parseListValue(null), []);
  assert.deepEqual(parseListValue(''), []);
  assert.deepEqual(parseListValue(' a, b ,a, '), ['a', 'b']);
});

test('规范过滤：层级维度 OR，空过滤全通过', () => {
  assert.equal(
    specMatchesFilter(
      { scope: 'user', projectId: undefined },
      { scopes: [], projectIds: [] },
      canonical,
    ),
    true,
  );
  const filter = { scopes: ['user', 'global'], projectIds: [] };
  assert.equal(specMatchesFilter({ scope: 'user', projectId: undefined }, filter, canonical), true);
  assert.equal(
    specMatchesFilter({ scope: 'global', projectId: undefined }, filter, canonical),
    true,
  );
  assert.equal(specMatchesFilter({ scope: 'project', projectId: 'p1' }, filter, canonical), false);
});

test('规范过滤：项目维度仅作用于项目级（用户/全局隐藏）；canonical 归一', () => {
  const filter = { scopes: [], projectIds: ['p/alias'] };
  assert.equal(specMatchesFilter({ scope: 'project', projectId: 'p1' }, filter, canonical), true);
  assert.equal(specMatchesFilter({ scope: 'project', projectId: 'p2' }, filter, canonical), false);
  assert.equal(
    specMatchesFilter({ scope: 'project', projectId: undefined }, filter, canonical),
    false,
  );
  assert.equal(
    specMatchesFilter({ scope: 'user', projectId: undefined }, filter, canonical),
    false,
  );
  assert.equal(
    specMatchesFilter({ scope: 'global', projectId: undefined }, filter, canonical),
    false,
  );
});

test('项目过滤：分组/标签维度内 OR、维度间 AND；空过滤全通过', () => {
  assert.equal(projectMatchesFilter({ groups: 'g1', tags: 't1' }, { groups: [], tags: [] }), true);
  const filter = { groups: ['g1'], tags: ['t1'] };
  assert.equal(projectMatchesFilter({ groups: 'g1,g2', tags: 't1,t2' }, filter), true);
  assert.equal(projectMatchesFilter({ groups: 'g2', tags: 't1' }, filter), false);
  assert.equal(projectMatchesFilter({ groups: 'g1', tags: 't2' }, filter), false);
  assert.equal(projectMatchesFilter({ groups: null, tags: null }, filter), false);
});

test('项目过滤：分组维度为子树语义（选「工作」覆盖 工作/** 后代）', () => {
  const filter = { groups: ['工作'], tags: [] };
  assert.equal(projectMatchesFilter({ groups: '工作/前端/组件库', tags: null }, filter), true);
  assert.equal(projectMatchesFilter({ groups: '工作', tags: null }, filter), true);
  assert.equal(projectMatchesFilter({ groups: '工作台/前端', tags: null }, filter), false);
  assert.equal(projectMatchesFilter({ groups: '工具', tags: null }, filter), false);
  // 选中子路径不向上覆盖父级
  const leafFilter = { groups: ['工作/前端'], tags: [] };
  assert.equal(projectMatchesFilter({ groups: '工作', tags: null }, leafFilter), false);
});

test('搜索结果过滤：类型维度；项目维度 canonical 归一、无归属行隐藏', () => {
  assert.equal(
    searchResultMatchesFilter(
      { type: 'task', projectIds: [] },
      { types: [], projectIds: [] },
      canonical,
    ),
    true,
  );
  const typeFilter = { types: ['task', 'spec'], projectIds: [] };
  assert.equal(
    searchResultMatchesFilter({ type: 'task', projectIds: [] }, typeFilter, canonical),
    true,
  );
  assert.equal(
    searchResultMatchesFilter({ type: 'project', projectIds: [] }, typeFilter, canonical),
    false,
  );
  const projectFilter = { types: [], projectIds: ['p/alias'] };
  assert.equal(
    searchResultMatchesFilter({ type: 'task', projectIds: ['p1'] }, projectFilter, canonical),
    true,
  );
  assert.equal(
    searchResultMatchesFilter({ type: 'task', projectIds: ['p2'] }, projectFilter, canonical),
    false,
  );
  assert.equal(
    searchResultMatchesFilter({ type: 'spec', projectIds: [] }, projectFilter, canonical),
    false,
  );
});
