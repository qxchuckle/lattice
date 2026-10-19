import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  findProjectGroupChain,
  placeProjectsInGroupTree,
  type GroupTreeNodeLike,
} from '../../src/views/project-group-logic';

const tree: GroupTreeNodeLike[] = [
  {
    id: 'g-work',
    path: '工作',
    children: [
      {
        id: 'g-fe',
        path: '工作/前端',
        children: [{ id: 'g-ui', path: '工作/前端/组件库', children: [] }],
      },
    ],
  },
  { id: 'g-tool', path: '工具', children: [] },
];

const projects = [
  { id: 'p1', name: 'Alpha', groupIds: ['g-fe'] },
  { id: 'p2', name: 'Beta', groupIds: ['g-ui', 'g-tool'] },
  { id: 'p3', name: 'Gamma', groupIds: [] },
  { id: 'p4', name: 'Delta', groupIds: ['grp-unknown0'] },
  { id: 'p5', name: 'Epsilon', groupIds: ['g-work', 'g-fe'] },
];

test('摆放：精确挂载 + 子树去重计数 + 未知引用进未分组', () => {
  const placed = placeProjectsInGroupTree(tree, projects);
  const work = placed.roots.find((node) => node.id === 'g-work');
  const tool = placed.roots.find((node) => node.id === 'g-tool');
  assert.ok(work && tool);

  // 工作：直接 p5；子级 前端 {p1,p5}；子级 组件库 {p2} → 去重后 {p1,p2,p5} = 3
  assert.equal(work.count, 3);
  assert.deepEqual(
    work.projects.map((project) => project.id),
    ['p5'],
  );
  const fe = work.children.find((node) => node.id === 'g-fe');
  assert.ok(fe);
  assert.deepEqual(
    fe.projects.map((project) => project.id),
    ['p1', 'p5'],
  );
  assert.equal(fe.count, 3);
  const ui = fe.children.find((node) => node.id === 'g-ui');
  assert.ok(ui);
  assert.equal(ui.count, 1);
  assert.deepEqual(
    ui.projects.map((project) => project.id),
    ['p2'],
  );

  assert.equal(tool.count, 1);
  // 未分组：无有效分组的项目（p3 空、p4 未知引用）
  assert.deepEqual(
    placed.ungrouped.map((project) => project.id),
    ['p4', 'p3'],
  );
});

test('摆放：无可见项目时整树剪枝；空输入安全', () => {
  const placed = placeProjectsInGroupTree(tree, []);
  assert.deepEqual(placed.roots, []);
  assert.deepEqual(placed.ungrouped, []);
});

test('摆放：直接挂载项目按名称排序（不随输入顺序）', () => {
  const placed = placeProjectsInGroupTree(tree, [
    { id: 'z', name: 'Zeta', groupIds: ['g-tool'] },
    { id: 'a', name: 'Alpha2', groupIds: ['g-tool'] },
    { id: 'm', name: 'Mid', groupIds: ['g-tool'] },
  ]);
  const tool = placed.roots.find((node) => node.id === 'g-tool');
  assert.ok(tool);
  assert.deepEqual(
    tool.projects.map((project) => project.id),
    ['a', 'm', 'z'],
  );
});

test('链：找第一条挂载链（reveal 用）；祖先+后代双挂载取先遇节点', () => {
  const placed = placeProjectsInGroupTree(tree, projects);
  assert.deepEqual(findProjectGroupChain(placed.roots, 'p1'), ['g-work', 'g-fe']);
  // p5 同时在 工作 与 工作/前端 挂载；工作 的直接项目先命中
  assert.deepEqual(findProjectGroupChain(placed.roots, 'p5'), ['g-work']);
  assert.deepEqual(findProjectGroupChain(placed.roots, 'p2'), ['g-work', 'g-fe', 'g-ui']);
  assert.equal(findProjectGroupChain(placed.roots, 'p3'), null);
  assert.equal(findProjectGroupChain(placed.roots, 'missing'), null);
});
