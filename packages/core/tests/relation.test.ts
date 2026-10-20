import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deleteRelation,
  deleteRelationsByFilter,
  deleteRelationsByProject,
  generateRelationId,
  getRelationById,
  getRelationsByProject,
  getRelationsByProjectCrossUser,
  listRelations,
  listRelationsCrossUser,
  normalizePairOrder,
  readRelationsFile,
  upsertRelation,
  writeRelationsFile,
} from '../src/project/relation';
import { closeDb, initDb, registerProjectWithIds } from '../src/index';
import { getRelationsFilePath } from '../src/paths';
import { createTempLatticeHome, putFile } from './helpers';

const U = 't';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // 未初始化
  }
  await env.cleanup();
});

test('relation：id 格式与 pair 归一化', () => {
  assert.match(generateRelationId(), /^rel_[0-9a-f]{8}$/);
  assert.deepEqual(normalizePairOrder('b', 'a'), { projectA: 'a', projectB: 'b' });
  assert.deepEqual(normalizePairOrder('a', 'b'), { projectA: 'a', projectB: 'b' });
  assert.deepEqual(normalizePairOrder('a', 'a'), { projectA: 'a', projectB: 'a' });
});

test('readRelationsFile：缺失/坏结构/旧 ID 归一化', async () => {
  assert.deepEqual(await readRelationsFile(U), { version: 1, relations: [] });

  await putFile(getRelationsFilePath(U), JSON.stringify({ version: 1, relations: { nope: true } }));
  assert.deepEqual(await readRelationsFile(U), { version: 1, relations: [] });

  await putFile(
    getRelationsFilePath(U),
    JSON.stringify({
      version: 1,
      relations: [
        {
          id: 'rel_00000001',
          projectA: 'alpha',
          projectB: 'legacy:beta',
          type: 'related',
          created: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
  );
  const file = await readRelationsFile(U);
  assert.equal(file.relations[0].projectA, 'legacy:alpha');
  assert.equal(file.relations[0].projectB, 'legacy:beta');
});

test('upsertRelation：创建/去重更新/自身关系拒绝/字典序', async () => {
  const created = await upsertRelation(U, {
    projectA: 'legacy:b',
    projectB: 'legacy:a',
    type: 'depends-on',
    description: '初始',
    createdFromTaskId: 't1',
  });
  assert.equal(created.projectA, 'legacy:a');
  assert.equal(created.projectB, 'legacy:b');
  assert.equal(created.createdBy, 'manual');
  assert.match(created.id, /^rel_/);

  const updated = await upsertRelation(U, {
    projectA: 'legacy:a',
    projectB: 'legacy:b',
    type: 'depends-on',
    description: '更新',
    createdBy: 'agent',
    createdFromTaskId: 't2',
  });
  assert.equal(updated.id, created.id);
  assert.equal(updated.description, '更新');
  assert.equal(updated.createdBy, 'agent');
  assert.equal(updated.createdFromTaskId, 't2');
  assert.ok(updated.updated);
  assert.equal((await listRelations(U)).length, 1);

  // 同 pair 不同类型 = 新关系
  const another = await upsertRelation(U, {
    projectA: 'legacy:a',
    projectB: 'legacy:b',
    type: 'related',
  });
  assert.notEqual(another.id, created.id);
  assert.equal((await listRelations(U)).length, 2);

  await assert.rejects(
    () => upsertRelation(U, { projectA: 'legacy:a', projectB: 'legacy:a', type: 'related' }),
    /不能创建项目与自身的关系/,
  );
});

test('查询/删除：byId、byProject（含无前缀）、批量按项目/过滤条件', async () => {
  const ab = await upsertRelation(U, {
    projectA: 'legacy:a',
    projectB: 'legacy:b',
    type: 'related',
  });
  const ac = await upsertRelation(U, {
    projectA: 'legacy:a',
    projectB: 'legacy:c',
    type: 'nested-in',
  });
  const bc = await upsertRelation(U, {
    projectA: 'legacy:b',
    projectB: 'legacy:c',
    type: 'nested-in',
    createdBy: 'auto',
  });

  assert.equal((await getRelationById(U, ab.id))?.id, ab.id);
  assert.equal(await getRelationById(U, 'rel_missing'), null);

  assert.deepEqual(
    (await getRelationsByProject(U, 'a')).map((r) => r.id).sort(),
    [ab.id, ac.id].sort(),
  );
  assert.deepEqual(
    (await getRelationsByProject(U, 'legacy:a')).map((r) => r.id).sort(),
    [ab.id, ac.id].sort(),
  );

  assert.equal(await deleteRelation(U, ab.id), true);
  assert.equal(await deleteRelation(U, ab.id), false);

  assert.equal(await deleteRelationsByProject(U, 'b'), 1, '只剩 bc 涉及 b');

  assert.equal(await deleteRelationsByFilter(U, { projectId: 'c', type: 'nested-in' }), 1);
  const auto = await upsertRelation(U, {
    projectA: 'legacy:a',
    projectB: 'legacy:c',
    type: 'nested-in',
    createdBy: 'auto',
  });
  await upsertRelation(U, {
    projectA: 'legacy:a',
    projectB: 'legacy:d',
    type: 'nested-in',
    createdBy: 'manual',
  });
  assert.equal(
    await deleteRelationsByFilter(U, { projectId: 'c', createdBy: 'manual' }),
    0,
    '按 createdBy 过滤：auto 关系保留',
  );
  assert.equal(await deleteRelationsByFilter(U, { projectId: 'd', createdBy: 'manual' }), 1);
  assert.equal((await getRelationById(U, auto.id))?.id, auto.id);
});

test('跨用户聚合：sourceUser、过滤与去重', async () => {
  await initDb();
  const dir1 = join(env.tmpRoot, 'ws1');
  const dir2 = join(env.tmpRoot, 'ws2');
  await mkdir(dir1, { recursive: true });
  await mkdir(dir2, { recursive: true });
  const derived = { gitRemotes: [], packageNames: [], monorepoPackages: [] };
  const id = 'legacy:1111222233334444';
  await registerProjectWithIds(U, [id], dir1, derived);
  await registerProjectWithIds('u2', [id], dir2, derived);

  const own = await upsertRelation(U, {
    projectA: id,
    projectB: 'legacy:aaaaaaaaaaaaaaaa',
    type: 'related',
    description: 'own',
  });
  const other = await upsertRelation('u2', {
    projectA: id,
    projectB: 'legacy:bbbbbbbbbbbbbbbb',
    type: 'related',
    description: 'other',
  });
  // u2 再建一条与 u1 完全相同 pair+type 的关系，用于跨用户去重
  await upsertRelation('u2', {
    projectA: id,
    projectB: 'legacy:aaaaaaaaaaaaaaaa',
    type: 'related',
    description: 'dup',
  });

  const cross = await getRelationsByProjectCrossUser(U, id);
  assert.ok(cross.some((r) => r.id === own.id && r.sourceUser === U));
  assert.ok(cross.some((r) => r.id === other.id && r.sourceUser === 'u2'));
  assert.equal(
    cross.filter((r) => r.projectA === id && r.projectB === 'legacy:aaaaaaaaaaaaaaaa').length,
    1,
    '相同 pair+type 去重',
  );

  const filtered = await getRelationsByProjectCrossUser(U, id, [U]);
  assert.ok(filtered.every((r) => r.sourceUser === U));

  const all = await listRelationsCrossUser(U);
  assert.ok(all.some((r) => r.id === own.id));
  assert.ok(all.some((r) => r.id === other.id));
  assert.ok(all.every((r) => typeof r.sourceUser === 'string'));

  const onlyU2 = await listRelationsCrossUser(U, ['u2']);
  assert.ok(onlyU2.every((r) => r.sourceUser === 'u2'));
  assert.ok(!onlyU2.some((r) => r.id === own.id));

  // 写入坏 relations.json 的其它用户应被跳过
  await putFile(join(env.latticeHome, 'users', 'u3', 'relations.json'), 'not json');
  const still = await listRelationsCrossUser(U);
  assert.ok(still.length >= 2);
});

test('writeRelationsFile：直接落盘后可读回', async () => {
  await writeRelationsFile(U, {
    version: 1,
    relations: [
      {
        id: 'rel_12345678',
        projectA: 'legacy:a',
        projectB: 'legacy:b',
        type: 'related',
        created: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  assert.equal((await listRelations(U)).length, 1);
});
