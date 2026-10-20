import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  autoRegisterProject,
  closeDb,
  createTask,
  getProjectMeta,
  getTaskMeta,
  initDb,
  mergeProjects,
  registerProjectWithIds,
  updateProjectPaths,
} from '../src/index';
import { getProjectById } from '../src/db';
import {
  clearLookupCache,
  findAllProjectsByAnyId,
  findProjectByAnyId,
  findProjectsOnDisk,
  findUsernameAndDirName,
  getProjectMetaById,
} from '../src/project/lookup';
import { getCacheDir, getProjectMetaPath, fileExists } from '../src/paths';
import { createFakeProject, createTempLatticeHome, putFile } from './helpers';

const U = 't';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
});

afterEach(async () => {
  try {
    closeDb();
    clearLookupCache();
  } catch {
    // ignore
  }
  await env.cleanup();
});

async function workspace(name: string, pkgName?: string) {
  const dir = join(env.tmpRoot, name);
  await mkdir(dir, { recursive: true });
  if (pkgName) await putFile(join(dir, 'package.json'), JSON.stringify({ name: pkgName }));
  return dir;
}

test('registerProjectWithIds：名称推导、derived 落盘、DB 同步', async () => {
  const dir = await workspace('proj-one', '@scope/alpha');
  const meta = await registerProjectWithIds(U, ['git:aaaa1111', 'legacy:bbbb2222'], dir, {
    gitFirstCommit: 'abc123',
    gitRemotes: ['https://example.com/a.git'],
    gitDefaultBranch: 'main',
    packageNames: ['@scope/alpha'],
    monorepoPackages: ['pkg-a'],
  });
  assert.equal(meta.name, '@scope/alpha');
  assert.deepEqual(meta.ids, ['git:aaaa1111', 'legacy:bbbb2222']);
  assert.equal(meta.gitFirstCommit, 'abc123');
  assert.equal(meta.gitDefaultBranch, 'main');
  assert.deepEqual(meta.packageNames, ['@scope/alpha']);
  assert.deepEqual(meta.monorepoPackages, ['pkg-a']);

  const stored = await getProjectMeta(U, 'git:aaaa1111');
  assert.equal(stored?.name, '@scope/alpha');
  assert.equal((await getProjectMetaById('git:aaaa1111'))?.username, U);

  // 无 package.json → 目录名
  const dir2 = await workspace('plain-dir');
  const meta2 = await registerProjectWithIds(U, ['legacy:cccc3333'], dir2, DERIVED);
  assert.equal(meta2.name, 'plain-dir');
  assert.equal(meta2.gitFirstCommit, undefined);
  assert.equal(meta2.packageNames, undefined);
  assert.equal(meta2.gitRemotes, undefined);
});

test('updateProjectPaths：追加/去重/缺失兜底', async () => {
  const dir = await workspace('upd');
  await registerProjectWithIds(U, ['git:ddd4444'], dir, DERIVED);

  const dir2 = await workspace('upd2');
  await updateProjectPaths('git:ddd4444', U, dir2);
  let meta = await getProjectMeta(U, 'git:ddd4444');
  assert.equal(meta?.localPaths?.length, 2);

  await updateProjectPaths('git:ddd4444', U, dir2);
  meta = await getProjectMeta(U, 'git:ddd4444');
  assert.equal(meta?.localPaths?.length, 2, '重复路径不追加');

  // username 不匹配时通过 findUsernameAndDirName 兜底
  const dir3 = await workspace('upd3');
  await updateProjectPaths('git:ddd4444', 'wrong-user', dir3);
  meta = await getProjectMeta(U, 'git:ddd4444');
  assert.ok(meta?.localPaths?.includes(dir3));

  // 不存在的项目静默返回
  await updateProjectPaths('legacy:doesnotexist', U, dir3);
});

test('autoRegisterProject：新建/幂等/补 ID/legacy 特殊分支', async () => {
  assert.deepEqual(await autoRegisterProject(U, [], '/tmp/x', DERIVED, true), {
    meta: null,
    isNew: false,
  });

  const dir = await workspace('auto-one');
  const first = await autoRegisterProject(U, ['git:eeee5555'], dir, DERIVED, true);
  assert.equal(first.isNew, true);
  assert.equal(first.meta?.ids.includes('git:eeee5555'), true);

  const second = await autoRegisterProject(U, ['git:eeee5555', 'git:ffff6666'], dir, DERIVED, true);
  assert.equal(second.isNew, false);
  assert.ok(second.meta?.ids.includes('git:ffff6666'), '应补全新 ID');

  // legacy 未在已有物理项目中匹配 → 新建独立项目，不修改 git 项目
  const dir2 = await workspace('auto-legacy');
  const legacy = await autoRegisterProject(
    U,
    ['legacy:99998888', 'git:eeee5555'],
    dir2,
    DERIVED,
    true,
  );
  assert.equal(legacy.isNew, true);
  const gitMeta = await getProjectMeta(U, 'git:eeee5555');
  assert.ok(!gitMeta?.ids.includes('legacy:99998888'));

  // legacy 已匹配 → 走已有项目分支
  const again = await autoRegisterProject(
    U,
    ['legacy:99998888', 'git:eeee5555'],
    dir2,
    DERIVED,
    true,
  );
  assert.equal(again.isNew, false);
});

test('lookup：主 ID/fingerprint/无前缀/磁盘回退与缓存', async () => {
  const dir = await workspace('look');
  await registerProjectWithIds(U, ['git:1234abcd', 'legacy:5678efgh'], dir, DERIVED);

  // primary = legacy（优先级 1 > git），git ID 通过 fingerprints 反查同一项目
  assert.equal(findProjectByAnyId(['git:1234abcd'])?.id, 'legacy:5678efgh');
  assert.equal(findProjectByAnyId(['legacy:5678efgh'])?.id, 'legacy:5678efgh');
  assert.equal(findProjectByAnyId(['5678efgh'])?.id, 'legacy:5678efgh');
  assert.equal(findProjectByAnyId(['missing']), null);

  // 缓存命中
  assert.equal(findProjectByAnyId(['git:1234abcd'])?.id, 'legacy:5678efgh');
  clearLookupCache();
  assert.equal(findProjectByAnyId(['git:1234abcd'])?.id, 'legacy:5678efgh');

  const all = findAllProjectsByAnyId(['git:1234abcd', 'legacy:5678efgh']);
  assert.equal(all.length, 1);

  assert.deepEqual(await findUsernameAndDirName('git:1234abcd'), {
    username: U,
    dirName: 'legacy:5678efgh',
  });
  assert.deepEqual(await findUsernameAndDirName('5678efgh'), {
    username: U,
    dirName: 'legacy:5678efgh',
  });
  assert.equal(await findUsernameAndDirName('legacy:nope'), null);
  assert.equal(await getProjectMetaById('legacy:nope'), null);

  // 磁盘旧格式：目录名无前缀、project.json 仅 id 字段
  const legacyDir = join(env.latticeHome, 'users', U, 'projects', 'oldstyle1');
  await putFile(
    join(legacyDir, 'project.json'),
    JSON.stringify({ id: 'oldstyle1', name: '旧项目' }),
  );
  const disk = await findProjectsOnDisk(U, ['oldstyle1']);
  assert.equal(disk.length, 1);
  assert.equal(disk[0].id, 'legacy:oldstyle1');
  assert.deepEqual(await findUsernameAndDirName('oldstyle1'), {
    username: U,
    dirName: 'oldstyle1',
  });

  // findProjectsOnDisk：projects 目录不存在 → []
  assert.deepEqual(await findProjectsOnDisk('no-user', ['x']), []);
});

test('mergeProjects：合并 ids/路径/spec、任务归属、DB 清理与失败分支', async () => {
  const fromDir = join(env.tmpRoot, 'merge-from');
  const toDir = join(env.tmpRoot, 'merge-to');
  await createFakeProject(fromDir);
  await createFakeProject(toDir);
  await registerProjectWithIds(U, ['git:from1111'], fromDir, {
    ...DERIVED,
    gitFirstCommit: 'from-sha',
    gitRemotes: ['r1'],
    gitDefaultBranch: 'main',
  });
  await registerProjectWithIds(U, ['git:to22222'], toDir, {
    ...DERIVED,
    gitFirstCommit: 'to-sha',
    gitRemotes: ['r2'],
  });

  // from 的 spec：json 可迁移；md 走 readJSON null 分支跳过
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', 'git:from1111', 'spec', 'a.json'),
    JSON.stringify({ id: 'spec-11111111' }),
  );
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', 'git:from1111', 'spec', 'b.md'),
    '# b',
  );
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', 'git:to22222', 'spec', 'a.json'),
    JSON.stringify({ id: 'keep' }),
  );

  const task = await createTask(U, '合并任务', { projects: ['git:from1111'] });
  const result = await mergeProjects('git:from1111', 'git:to22222');
  assert.equal(result.success, true, result.message);
  assert.ok(result.steps?.some((s) => s.includes('2a')));
  assert.ok(result.steps?.some((s) => s.includes('2c')));
  assert.ok(result.steps?.some((s) => s.includes('3.')));

  const toMeta = await getProjectMeta(U, 'git:to22222');
  assert.ok(toMeta?.ids.includes('git:from1111'));
  assert.ok(toMeta?.localPaths?.some((p) => p.endsWith('/merge-from')));
  assert.deepEqual(new Set(toMeta?.gitRemotes), new Set(['r1', 'r2']));

  const movedSpec = await readFile(
    join(env.latticeHome, 'users', U, 'projects', 'git:to22222', 'spec', 'a.json'),
    'utf-8',
  );
  assert.match(movedSpec, /keep/, '目标已有同名 spec 不覆盖');

  const taskMeta = await getTaskMeta(U, task.id);
  assert.deepEqual(taskMeta?.projects, ['git:to22222']);
  assert.ok(
    await readFile(join(env.latticeHome, 'users', U, 'tasks', task.id, 'task.json'), 'utf-8'),
  );

  // from 项目目录移入垃圾桶；from ID 现在解析到合并后的目标项目
  assert.equal(
    await fileExists(join(env.latticeHome, 'users', U, 'projects', 'git:from1111')),
    false,
  );
  assert.ok((await getProjectMeta(U, 'git:from1111'))?.ids.includes('git:to22222'));
  assert.ok(!getProjectById('git:from1111'));

  // 合并日志（started/completed）
  const log = await readFile(join(getCacheDir(), 'merge-log.json'), 'utf-8');
  assert.match(log, /"status": "completed"/);
  assert.match(log, /"status": "started"/);

  // 失败：源/目标不存在
  const missingFrom = await mergeProjects('legacy:nope', 'git:to22222');
  assert.equal(missingFrom.success, false);
  assert.match(missingFrom.message, /源项目/);
  const missingTo = await mergeProjects('git:to22222', 'legacy:nope');
  assert.equal(missingTo.success, false);
  assert.match(missingTo.message, /目标项目/);
  const log2 = await readFile(join(getCacheDir(), 'merge-log.json'), 'utf-8');
  assert.match(log2, /"status": "failed"/);
});

test('syncProjectMetaToDb：未初始化 DB 时静默跳过', async () => {
  const dir = await workspace('nodb');
  closeDb();
  const meta = await registerProjectWithIds(U, ['legacy:aaaabbbb'], dir, DERIVED);
  assert.equal(meta.ids[0], 'legacy:aaaabbbb');
  // 重新初始化供 afterEach 干净关闭
  await initDb();
  assert.ok(await getProjectMeta(U, 'legacy:aaaabbbb'), '文件真源已写入（DB 同步被跳过）');
});

test('getProjectMetaPath：合并后 project.json 可直接读取', async () => {
  const dir = await workspace('readback');
  await registerProjectWithIds(U, ['legacy:ffff0000'], dir, DERIVED);
  const raw = JSON.parse(await readFile(getProjectMetaPath(U, 'legacy:ffff0000'), 'utf-8'));
  assert.deepEqual(raw.ids, ['legacy:ffff0000']);
});
