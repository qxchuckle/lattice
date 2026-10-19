import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleViewSearchItemSpecs,
  type ViewSearchItemLabels,
} from '../../src/pickers/view-search-items';
import type { ViewSearchPreviewRow } from '../../src/views/view-search-logic';

const labels: ViewSearchItemLabels = {
  clear: 'Clear search (Enter)',
  apply: 'Apply search "q"',
  applyWithCount: 'Apply search "q" (3 results)',
  contentOnly: 'Full-text match',
  kinds: { task: 'Tasks', spec: 'Specs', project: 'Projects' },
};

const row = (overrides: Partial<ViewSearchPreviewRow> = {}): ViewSearchPreviewRow => ({
  kind: 'task',
  id: 'demo-task-1',
  label: 'Demo task',
  description: 'planning · P1',
  contentOnly: false,
  ...overrides,
});

test('空查询 + 未应用搜索 → 无列表项', () => {
  assert.deepEqual(
    assembleViewSearchItemSpecs({ query: '  ', appliedQuery: '', rows: [], total: 0, labels }),
    [],
  );
});

test('空查询 + 已应用搜索 → 仅清除项', () => {
  const items = assembleViewSearchItemSpecs({
    query: '',
    appliedQuery: 'checkpoint',
    rows: [],
    total: 0,
    labels,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].itemKind, 'clear');
  assert.equal(items[0].label, '$(clear-all) Clear search (Enter)');
});

test('非空查询：首项固定「应用」（含条数），其后为结果项', () => {
  const items = assembleViewSearchItemSpecs({
    query: 'demo',
    appliedQuery: '',
    rows: [row(), row({ kind: 'spec', id: 'spec-x', label: 'Spec X' })],
    total: 3,
    labels,
  });
  assert.equal(items[0].itemKind, 'apply');
  assert.equal(items[0].label, '$(search) Apply search "q" (3 results)');
  assert.equal(items[0].alwaysShow, true);
  assert.equal(items[1].itemKind, 'result');
  assert.equal(items[1].separatorBefore, true);
  assert.equal(items[2].itemKind, 'result');
  assert.equal(items[2].separatorBefore, undefined);
});

test('无命中：仅应用项（无分隔线、无结果项）', () => {
  const items = assembleViewSearchItemSpecs({
    query: 'nohit',
    appliedQuery: '',
    rows: [],
    total: 0,
    labels,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].label, '$(search) Apply search "q"');
});

test('结果项：kind 文案 + 描述 + 全文命中标记 + id detail + 图标', () => {
  const items = assembleViewSearchItemSpecs({
    query: 'demo',
    appliedQuery: '',
    rows: [
      row({ contentOnly: true }),
      row({ kind: 'project', id: 'p1', label: 'P1', description: 'pkg' }),
    ],
    total: 2,
    labels,
  });
  const first = items[1];
  assert.equal(first.description, 'Tasks · planning · P1 · Full-text match');
  assert.equal(first.detail, 'demo-task-1');
  assert.equal(first.icon, 'checklist');
  const second = items[2];
  assert.equal(second.description, 'Projects · pkg');
  assert.equal(second.icon, 'project');
});
