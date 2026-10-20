import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  clearVirtualMergeCache,
  getProjectDirNames,
  getProjectIdsFromDb,
  getRelatedProjectIds,
  getVirtualProjectMeta,
  listVirtualProjectMetas,
} from '../src/project/virtual-merge';
import { closeDb, initDb, registerProjectWithIds, updateProjectMeta } from '../src/index';
import { upsertProject, upsertProjectDir } from '../src/db';
import { createTempLatticeHome, putFile } from './helpers';

const U = 'u1';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
  clearVirtualMergeCache();
});

afterEach(async () => {
  clearVirtualMergeCache();
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

test('getRelatedProjectIds：共享 ID 的虚拟组、缓存与清除', async () => {
  const d1 = join(env.tmpRoot, 'v1');
  const d2 = join(env.tmpRoot, 'v2');
  await mkdir(d1, { recursive: true });
  await mkdir(d2, { recursive: true });
  await registerProjectWithIds(U, ['git:shared1'], d1, DERIVED);
  await registerProjectWithIds(U, ['legacy:2222', 'git:shared1'], d2, DERIVED);

  const related = getRelatedProjectIds('git:shared1');
  assert.ok(related.includes('git:shared1'));
  assert.ok(related.includes('legacy:2222'));
  assert.deepEqual(getRelatedProjectIds('git:shared1'), related, '缓存命中');
  assert.deepEqual(getProjectIdsFromDb('git:shared1'), ['git:shared1']);
  assert.deepEqual(getProjectIdsFromDb('legacy:2222').sort(), ['git:shared1', 'legacy:2222']);

  const dirs = getProjectDirNames(U, 'git:shared1');
  assert.ok(dirs.includes('git:shared1'));
  assert.ok(dirs.includes('legacy:2222'));

  // DB 无记录：回退规范化 ID 目录名
  assert.deepEqual(getProjectDirNames(U, 'legacy:missing'), []);

  clearVirtualMergeCache();
  assert.ok(getRelatedProjectIds('git:shared1').length >= 2);
});

test('getVirtualProjectMeta：单目录/无目录/多目录聚合', async () => {
  const dir = join(env.tmpRoot, 'single');
  await mkdir(dir, { recursive: true });
  await registerProjectWithIds(U, ['legacy:single'], dir, DERIVED);
  await updateProjectMeta(U, 'legacy:single', {
    description: 'single',
    tags: ['a'],
  });
  const single = await getVirtualProjectMeta(U, 'legacy:single');
  assert.equal(single?.description, 'single');
  assert.deepEqual(single?.tags, ['a']);

  // DB 无记录 + 磁盘无目录 → null
  assert.equal(await getVirtualProjectMeta(U, 'legacy:none'), null);

  // 两个物理目录（同 primary ID）→ 合并数组字段，updated 最新者为基准
  const primary = 'legacy:multi';
  const d1 = join(env.tmpRoot, 'm1');
  const d2 = join(env.tmpRoot, 'm2');
  await mkdir(d1, { recursive: true });
  await mkdir(d2, { recursive: true });
  await registerProjectWithIds(U, [primary], d1, DERIVED);
  await updateProjectMeta(U, primary, {
    localPaths: [d1],
    tags: ['old'],
    updated: '2026-01-01T00:00:00.000Z',
  });

  await putFile(
    join(env.latticeHome, 'users', U, 'projects', 'legacy:alias', 'project.json'),
    JSON.stringify({
      ids: [primary, 'git:aliasid'],
      name: 'alias',
      localPaths: [d2],
      tags: ['new'],
      groupIds: ['g1'],
      gitRemotes: ['github.com/a/b'],
      packageNames: ['pkg'],
      monorepoPackages: ['mono'],
      updated: '2027-06-01T00:00:00.000Z',
      created: '2026-01-01T00:00:00.000Z',
    }),
  );
  upsertProjectDir(primary, U, 'legacy:alias');

  const merged = await getVirtualProjectMeta(U, primary);
  assert.equal(merged?.name, 'alias', '取 updated 最新 meta 的标量字段');
  assert.deepEqual(new Set(merged?.localPaths), new Set([d1, d2]));
  assert.deepEqual(new Set(merged?.tags), new Set(['old', 'new']));
  assert.deepEqual(merged?.groupIds, ['g1']);
  assert.deepEqual(merged?.gitRemotes, ['github.com/a/b']);
  assert.deepEqual(merged?.packageNames, ['pkg']);
  assert.deepEqual(merged?.monorepoPackages, ['mono']);
  assert.deepEqual(new Set(merged?.ids), new Set([primary, 'git:aliasid']));
});

test('listVirtualProjectMetas：按虚拟组去重并跳过缺失 meta', async () => {
  const d1 = join(env.tmpRoot, 'list1');
  await mkdir(d1, { recursive: true });
  await registerProjectWithIds(U, ['legacy:l1', 'git:g1'], d1, DERIVED);

  // 同一项目的第二个物理目录（别名）→ 聚合后只输出一次
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', 'legacy:l1-alias', 'project.json'),
    JSON.stringify({
      ids: ['legacy:l1', 'git:g1'],
      name: 'l1-alias',
      localPaths: [join(env.tmpRoot, 'alias-path')],
      updated: '2026-01-01T00:00:00.000Z',
      created: '2026-01-01T00:00:00.000Z',
    }),
  );
  upsertProjectDir('legacy:l1', U, 'legacy:l1-alias');

  // DB 行但磁盘 meta 损坏 → 跳过
  upsertProject({
    id: 'legacy:ghost',
    name: 'ghost',
    local_path: '[]',
    description: null,
    git_remote: null,
    git_first_commit: null,
    git_default_branch: null,
    package_names: null,
    monorepo_packages: null,
    groups: null,
    tags: null,
    username: U,
    created: '2026-01-01T00:00:00.000Z',
    updated: null,
  });
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', 'legacy:ghost', 'project.json'),
    'not json',
  );

  const metas = await listVirtualProjectMetas(U);
  const ids = metas.flatMap((m) => m.ids ?? []);
  assert.ok(ids.includes('legacy:l1'));
  assert.ok(ids.includes('git:g1'));
  assert.ok(!ids.includes('legacy:ghost'));
  assert.equal(
    metas.filter((m) => (m.ids ?? []).includes('git:g1')).length,
    1,
    '共享 ID 的物理项目只输出一次',
  );
});
