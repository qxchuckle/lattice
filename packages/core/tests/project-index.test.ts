import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  closeDb,
  detectProjectInfo,
  findProjectById,
  findProjectByPath,
  getAllUniqueRelations,
  getProjectMeta,
  initDb,
  listProjectMetas,
  listProjects,
  listProjectsReferencingGroupSubtree,
  parseProjectRow,
  purgeProject,
  refreshProjectGroupPaths,
  registerProject,
  removeProjectGroupTree,
  resolveProjectById,
  unregisterProject,
  updateProjectGroups,
  updateProjectMeta,
} from '../src/index';
import { upsertRelation } from '../src/project/relation';
import { fileExists } from '../src/paths';
import { createFakeProject, createTempLatticeHome, putFile } from './helpers';

const U = 'u1';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

test('detectProjectInfo：package 描述 + git remote；非 git 降级', async () => {
  const dir = join(env.tmpRoot, 'detect');
  await createFakeProject(dir, { remote: 'https://github.com/acme/detect.git' });
  await putFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'pkg-name', description: 'Description' }),
  );
  const info = await detectProjectInfo(dir);
  assert.equal(info.name, 'detect', '名称取目录名');
  assert.equal(info.description, 'Description');
  assert.equal(info.gitRemotes.length, 1);
  assert.match(info.gitRemotes[0], /github\.com\/acme\/detect/);

  const plain = join(env.tmpRoot, 'plain-detect');
  await mkdir(plain, { recursive: true });
  const plainInfo = await detectProjectInfo(plain);
  assert.equal(plainInfo.name, 'plain-detect');
  assert.equal(plainInfo.description, undefined);
  assert.deepEqual(plainInfo.gitRemotes, []);
});

test('registerProject/list/filter/parse/relations/resolve', async () => {
  const d1 = join(env.tmpRoot, 'p1');
  const d2 = join(env.tmpRoot, 'p2');
  await mkdir(d1, { recursive: true });
  await mkdir(d2, { recursive: true });

  const meta = await registerProject(U, 'legacy:aaaa1111', d1, {
    name: 'Alpha',
    description: 'desc',
    tags: ['tag-a'],
  });
  assert.deepEqual(meta.ids, ['legacy:aaaa1111']);
  assert.equal(meta.name, 'Alpha');
  // 幂等：重复注册仅补路径
  const again = await registerProject(U, 'legacy:aaaa1111', d1);
  assert.equal(again.localPaths?.length, 1);

  await registerProject(U, 'legacy:bbbb2222', d2, {
    name: 'Beta',
    tags: ['tag-b'],
  });
  await updateProjectMeta(U, 'legacy:aaaa1111', { description: 'updated' });
  assert.equal((await getProjectMeta(U, 'legacy:aaaa1111'))?.description, 'updated');

  const all = listProjects(U);
  assert.equal(all.length, 2);
  assert.deepEqual(
    listProjects(U, { tag: 'tag-a' }).map((p) => p.id),
    ['legacy:aaaa1111'],
  );
  assert.deepEqual(
    listProjects(U, { search: 'beta' }).map((p) => p.id),
    ['legacy:bbbb2222'],
  );
  assert.deepEqual(
    listProjects(U, { search: 'updated' }).map((p) => p.id),
    ['legacy:aaaa1111'],
  );

  const row = all.find((p) => p.id === 'legacy:aaaa1111')!;
  const parsed = parseProjectRow(row);
  assert.deepEqual(parsed.parsedTags, ['tag-a']);
  assert.deepEqual(parsed.parsedGroups, []);
  assert.deepEqual(parseProjectRow({ ...row, tags: null, groups: null }).parsedTags, []);

  assert.equal(findProjectById('legacy:aaaa1111')?.name, 'Alpha');
  assert.ok(findProjectByPath(d1));
  assert.equal(resolveProjectById(U, 'legacy:aaaa')?.id, 'legacy:aaaa1111');
  assert.equal(resolveProjectById(U, 'nope'), undefined);

  const relation = await upsertRelation(U, {
    projectA: 'legacy:aaaa1111',
    projectB: 'legacy:bbbb2222',
    type: 'related',
    description: 'R',
  });
  const relations = await getAllUniqueRelations(U);
  assert.equal(relations.length, 1);
  assert.equal(relations[0].id, relation.id);
  assert.equal(relations[0].relation_type, 'related');
  assert.equal(relations[0].description, 'R');
  assert.equal((await getAllUniqueRelations(U, ['legacy:aaaa1111'])).length, 1);
  assert.deepEqual(await getAllUniqueRelations(U, ['legacy:nope']), []);

  const metas = await listProjectMetas(U);
  assert.equal(metas.length, 2);
});

test('updateProjectGroups/listReferencing/removeTree/refresh', async () => {
  const dir = join(env.tmpRoot, 'grouped');
  await mkdir(dir, { recursive: true });
  await registerProject(U, 'legacy:group001', dir, { name: 'Grouped' });

  const set = await updateProjectGroups(U, 'legacy:group001', { set: ['team/backend'] });
  assert.equal(set.error, undefined);
  assert.equal(set.created.length, 2, 'team + team/backend 自动创建');
  assert.equal(set.meta?.groupIds?.length, 1, '项目只挂叶子分组');

  const add = await updateProjectGroups(U, 'legacy:group001', { add: ['team/frontend'] });
  assert.equal(add.meta?.groupIds?.length, 2);
  const remove = await updateProjectGroups(U, 'legacy:group001', {
    remove: ['team/frontend', 'nope'],
  });
  assert.equal(remove.meta?.groupIds?.length, 1);
  assert.deepEqual(remove.unknownRemovals, ['nope']);
  // 无变化分支
  const same = await updateProjectGroups(U, 'legacy:group001', { add: ['team/backend'] });
  assert.equal(same.meta?.groupIds?.length, 1);
  assert.equal(
    (await updateProjectGroups(U, 'legacy:missing', { set: ['x'] })).error,
    '未找到项目：legacy:missing',
  );

  const team = set.created.find((n) => n.name === 'team')!;
  const refs = await listProjectsReferencingGroupSubtree(U, team.id);
  assert.deepEqual(refs, ['legacy:group001']);
  assert.deepEqual(await listProjectsReferencingGroupSubtree(U, 'grp-nope'), []);

  assert.equal(await refreshProjectGroupPaths(U, ['legacy:group001']), 1);
  assert.equal(await refreshProjectGroupPaths(U, []), 1);

  const removed = await removeProjectGroupTree(U, 'team');
  assert.equal(removed.error, undefined);
  assert.ok(removed.removed.length >= 2);
  assert.deepEqual(removed.affectedProjectIds, ['legacy:group001']);
  assert.equal((await getProjectMeta(U, 'legacy:group001'))?.groupIds, undefined);

  const missing = await removeProjectGroupTree(U, 'nope');
  assert.match(missing.error ?? '', /未找到分组/);
});

test('unregisterProject：项目移入垃圾桶；purgeProject 彻底删除', async () => {
  const d1 = join(env.tmpRoot, 'unreg');
  const d2 = join(env.tmpRoot, 'purge');
  await mkdir(d1, { recursive: true });
  await mkdir(d2, { recursive: true });
  await registerProject(U, 'legacy:unreg001', d1, { name: 'Unreg' });
  await registerProject(U, 'legacy:purge001', d2, { name: 'Purge' });
  await updateProjectGroups(U, 'legacy:unreg001', { set: ['g'] });

  await unregisterProject(U, 'legacy:unreg001');
  assert.equal(
    await fileExists(join(env.latticeHome, 'users', U, 'projects', 'legacy:unreg001')),
    false,
  );
  assert.equal(await getProjectMeta(U, 'legacy:unreg001'), null);
  // 垃圾桶可恢复
  assert.ok(await fileExists(join(env.latticeHome, '.trash')));

  await purgeProject(U, 'legacy:purge001');
  assert.equal(
    await fileExists(join(env.latticeHome, 'users', U, 'projects', 'legacy:purge001')),
    false,
  );
  // 幂等：不存在也不抛
  await purgeProject(U, 'legacy:none');
});
