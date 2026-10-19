import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  ancestorOrSelfIds,
  buildGroupTree,
  collectSubtreeIds,
  createGroupNodeInRegistry,
  emptyGroupRegistry,
  ensureGroupPathInRegistry,
  findGroupByRef,
  generateGroupId,
  groupPathMap,
  groupPathOf,
  isSubtreePathMatch,
  isValidGroupId,
  moveGroupNodeInRegistry,
  nearestSharedAncestorPath,
  normalizeGroupPath,
  normalizeGroupPathSegments,
  parseGroupPathListInput,
  readGroupRegistry,
  removeGroupTreeInRegistry,
  renameGroupNodeInRegistry,
  resolveGroupPath,
  resolveGroupPathsForIds,
  validateGroupName,
  writeGroupRegistry,
} from '../src/index';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempLatticeHome } from './helpers';

let env;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  await env.cleanup();
});

// ─── 纯函数：路径与校验 ───

test('normalizeGroupPathSegments / normalizeGroupPath 规范化输入', () => {
  assert.deepEqual(normalizeGroupPathSegments(' 工作 / 前端//组件库 / '), [
    '工作',
    '前端',
    '组件库',
  ]);
  assert.equal(normalizeGroupPath(' 工作 / 前端 '), '工作/前端');
  assert.equal(normalizeGroupPath(' / / '), '');
});

test('parseGroupPathListInput 逗号分隔、去重、保留顺序', () => {
  assert.deepEqual(parseGroupPathListInput('工作/前端, 工具 ,工作/前端,'), ['工作/前端', '工具']);
  assert.deepEqual(parseGroupPathListInput(''), []);
});

test('validateGroupName 校验同级唯一 / 分隔符 / 逗号 / 长度', () => {
  const nodes = [
    {
      id: 'grp-aaaaaaaa',
      name: '工作',
      parentId: null,
      order: 0,
      description: null,
      created: '',
      updated: null,
    },
  ];
  assert.equal(validateGroupName(nodes, null, '工作'), '同级下已存在分组「工作」');
  assert.equal(validateGroupName(nodes, null, '工作', 'grp-aaaaaaaa'), null); // 排除自身
  assert.equal(validateGroupName(nodes, null, 'a/b'), '分组名称不能包含 “/”');
  assert.equal(validateGroupName(nodes, null, 'a,b'), '分组名称不能包含逗号（, 或 ，）');
  assert.equal(validateGroupName(nodes, null, '  '), '分组名称不能为空');
  assert.equal(validateGroupName(nodes, null, 'x'.repeat(51))?.includes('50'), true);
  // 不同父级可以同名
  assert.equal(validateGroupName([{ ...nodes[0], parentId: 'grp-bbbbbbbb' }], null, '工作'), null);
});

// ─── 纯函数：注册表操作 ───

test('ensureGroupPathInRegistry 逐级创建 + 幂等复用', () => {
  const registry = emptyGroupRegistry();
  const first = ensureGroupPathInRegistry(registry, '工作/前端/组件库');
  assert.equal(first.ok, true);
  assert.equal(first.created.length, 3);
  assert.equal(registry.groups.length, 3);
  const again = ensureGroupPathInRegistry(registry, '工作/前端');
  assert.equal(again.created.length, 0);
  assert.equal(again.node.id, first.created[1].id);
});

test('create/rename/move/remove 纯操作（含防环与同级重名）', () => {
  const registry = emptyGroupRegistry();
  ensureGroupPathInRegistry(registry, '工作/前端');
  const a = findGroupByRef(registry, '工作/前端');

  const dup = createGroupNodeInRegistry(registry, a.id, 'x');
  assert.ok(!('error' in dup));
  const dupErr = createGroupNodeInRegistry(registry, a.id, 'x');
  assert.ok('error' in dupErr);

  const rename = renameGroupNodeInRegistry(registry, a.id, '前端组');
  assert.ok(!('error' in rename));
  assert.equal(groupPathOf(registry.groups, a.id), '工作/前端组');

  const root = findGroupByRef(registry, '工作');
  const moveErr = moveGroupNodeInRegistry(registry, root.id, a.id); // 移到自己子级 → 环
  assert.ok('error' in moveErr);
  const move = moveGroupNodeInRegistry(registry, a.id, null); // 移到根级
  assert.ok(!('error' in move));
  assert.equal(groupPathOf(registry.groups, a.id), '前端组');

  const removed = removeGroupTreeInRegistry(registry, root.id);
  assert.equal(removed.removed.length, 1);
  assert.equal(registry.groups.length, 2); // 剩下的：前端组 + 其子级 x
});

test('buildGroupTree 排序 + 路径映射 + 破损数据兜底', () => {
  const now = '2026-01-01T00:00:00.000Z';
  const registry = emptyGroupRegistry();
  ensureGroupPathInRegistry(registry, 'b/child');
  ensureGroupPathInRegistry(registry, 'a');
  const tree = buildGroupTree(registry.groups);
  assert.equal(tree[0].path, 'b'); // order 升序（b 先建 order=0）
  assert.equal(tree[0].children[0].path, 'b/child');
  assert.equal(tree[1].path, 'a');

  // 破损父级引用 → 视为根
  const broken = [
    ...registry.groups,
    {
      id: 'grp-zzzzzzzz',
      name: '孤儿',
      parentId: 'grp-missing0',
      order: 0,
      description: null,
      created: now,
      updated: null,
    },
  ];
  const paths = groupPathMap(broken);
  assert.equal(paths.get('grp-zzzzzzzz'), '孤儿');
});

test('ancestorOrSelfIds / collectSubtreeIds', () => {
  const registry = emptyGroupRegistry();
  ensureGroupPathInRegistry(registry, '工作/前端/组件库');
  ensureGroupPathInRegistry(registry, '工具');
  const leaf = findGroupByRef(registry, '工作/前端/组件库');
  const root = findGroupByRef(registry, '工作');

  const ancestors = ancestorOrSelfIds(registry.groups, leaf.id);
  assert.deepEqual([...ancestors].sort(), [root.id, leaf.parentId, leaf.id].sort());

  const subtree = collectSubtreeIds(registry.groups, root.id);
  assert.equal(subtree.size, 3);
});

// ─── 消费语义 ───

test('isSubtreePathMatch / nearestSharedAncestorPath（共享任一祖先）', () => {
  assert.equal(isSubtreePathMatch('工作', '工作/前端'), true);
  assert.equal(isSubtreePathMatch('工作', '工作'), true);
  assert.equal(isSubtreePathMatch('工作', '工作台/前端'), false);
  assert.equal(isSubtreePathMatch('工作', '工具'), false);

  assert.equal(nearestSharedAncestorPath(['工作/前端/a'], ['工作/前端/b']), '工作/前端');
  assert.equal(nearestSharedAncestorPath(['工作/前端/a'], ['工作/医疗']), '工作');
  assert.equal(nearestSharedAncestorPath(['工作'], ['工具']), null);
  assert.equal(nearestSharedAncestorPath([], ['工具']), null);
});

// ─── 注册表 IO ───

test('readGroupRegistry / writeGroupRegistry 文件往返 + 宽松规范化', async () => {
  const username = 't';
  assert.deepEqual(await readGroupRegistry(username), emptyGroupRegistry());

  const registry = emptyGroupRegistry();
  ensureGroupPathInRegistry(registry, '工作/前端', '2026-01-01T00:00:00.000Z');
  await writeGroupRegistry(username, registry);

  const reloaded = await readGroupRegistry(username);
  assert.equal(reloaded.groups.length, 2);
  assert.equal(reloaded.groups[1].name, '前端');
  assert.equal(reloaded.groups[1].parentId, reloaded.groups[0].id);
  assert.equal(groupPathOf(reloaded.groups, reloaded.groups[1].id), '工作/前端');

  // 磁盘结构（version + groups 扁平列表）
  const filePath = join(env.latticeHome, 'users', username, 'project-groups.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.groups.length, 2);
});

test('resolveGroupPathsForIds / findGroupByRef / resolveGroupPath / generateGroupId 格式', () => {
  const registry = emptyGroupRegistry();
  ensureGroupPathInRegistry(registry, '工作/前端');
  const front = findGroupByRef(registry, '工作/前端');
  const byId = findGroupByRef(registry, front.id);
  assert.equal(byId.id, front.id);
  assert.equal(findGroupByRef(registry, '不存在'), null);
  assert.equal(resolveGroupPath(registry.groups, '工作/前端')?.id, front.id);
  assert.equal(resolveGroupPath(registry.groups, '工作/后端'), null);

  const paths = resolveGroupPathsForIds(registry, [front.id, 'grp-missing000', front.id]);
  assert.deepEqual(paths, ['工作/前端']);

  assert.equal(isValidGroupId(generateGroupId()), true);
  assert.equal(isValidGroupId('grp-XYZ'), false);
});
