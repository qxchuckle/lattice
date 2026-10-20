import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdir, readFile, rm } from 'node:fs/promises';
import {
  initDb,
  closeDb,
  runDoctorCheck,
  registerProjectWithIds,
  syncProjectMetaToDb,
  createTask,
  updateTask,
  listTasks,
  listProjects,
  listRelations,
  writeGroupRegistry,
  writeInitMeta,
} from '../src/index';
import { createTempLatticeHome, putFile, createFakeProject } from './helpers';

/**
 * doctor-check L2 集成：全部检查项在隔离 home 上驱动（此前 0% 覆盖）。
 * 覆盖：初始化/配置/目录/项目索引/磁盘-DB 一致性/重复项目/lattice.json 一致性/
 * 分组注册表/DB 字段漂移/任务关联/父子链/关系有效性/孤立任务目录/RAG+FTS/
 * init-meta，以及 --fix / --migrate / --rebuild-fingerprints / --recheck-scope-paths。
 */

const U = 't';
const ID_A = 'legacy:aaaabbbbccccdddd';
const ID_B = 'legacy:ffff000011112222';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env;

function entryOf(report, item) {
  const e = report.entries.find((x) => x.item === item);
  assert.ok(
    e,
    `缺少 doctor 条目：${item}（现有：${report.entries.map((x) => x.item).join('、')}）`,
  );
  return e;
}

async function setupBase() {
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, language: 'zh' }),
  );
  await putFile(join(env.latticeHome, 'config', 'config.json'), JSON.stringify({}));
}

async function projectDirs() {
  const root = join(env.latticeHome, 'users', U, 'projects');
  const dirs = await readdir(root, { withFileTypes: true });
  return dirs
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** 定位包含指定 id 的项目目录名（project.json.ids 或 id 命中） */
async function dirOfProject(id) {
  for (const dirName of await projectDirs()) {
    const meta = JSON.parse(
      await readFile(
        join(env.latticeHome, 'users', U, 'projects', dirName, 'project.json'),
        'utf-8',
      ),
    );
    const ids = Array.isArray(meta.ids) ? meta.ids : meta.id ? [meta.id] : [];
    if (ids.includes(id)) return dirName;
  }
  throw new Error(`未找到项目目录：${id}`);
}

/** 直接改 project.json 真源（不同步 db——用于制造 db 漂移） */
async function mutateMetaOnly(dirName, mutate) {
  const metaPath = join(env.latticeHome, 'users', U, 'projects', dirName, 'project.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
  mutate(meta);
  await putFile(metaPath, JSON.stringify(meta));
  return meta;
}

/** 读取指定目录的 project.json、mutate 后落盘并同步到 db（模拟真源被外部修改） */
async function mutateMetaAndSync(dirName, mutate) {
  const metaPath = join(env.latticeHome, 'users', U, 'projects', dirName, 'project.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
  mutate(meta);
  await putFile(metaPath, JSON.stringify(meta));
  syncProjectMetaToDb(U, meta, dirName);
  return meta;
}

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

test('未初始化：仅一条 error 条目，报告统计自洽', async () => {
  const report = await runDoctorCheck();
  assert.equal(report.total, 1);
  assert.equal(report.error, 1);
  assert.equal(report.entries[0].item, 'Lattice 初始化');
  assert.equal(report.entries[0].status, 'error');
  assert.match(report.entries[0].fix, /lattice init/);
});

test('最小已初始化 home：配置/索引/一致性等关键条目 healthy，统计自洽', async () => {
  await setupBase();
  const report = await runDoctorCheck();

  assert.equal(entryOf(report, 'Lattice 初始化').status, 'healthy');
  assert.equal(entryOf(report, 'config.json').status, 'healthy');
  assert.equal(entryOf(report, 'config-local.json').status, 'healthy');
  assert.equal(entryOf(report, 'Agent 文档注入').status, 'stale'); // 无 init-meta
  assert.equal(entryOf(report, '全局 spec 目录').status, 'stale'); // 目录未建
  assert.match(entryOf(report, '全局 spec 目录').fix, /创建目录/);
  assert.equal(entryOf(report, '项目索引').status, 'healthy'); // 0 项目
  assert.equal(entryOf(report, '磁盘/数据库一致性').status, 'healthy');
  assert.equal(entryOf(report, '重复项目检测').status, 'healthy');
  assert.equal(entryOf(report, 'lattice.json 引用一致性').status, 'healthy');
  assert.equal(entryOf(report, '项目分组注册表').status, 'healthy'); // 未创建分组
  assert.equal(entryOf(report, '数据库字段同步').status, 'healthy');
  assert.equal(entryOf(report, '任务关联项目有效性').status, 'healthy');
  assert.equal(entryOf(report, '任务父子链有效性').status, 'healthy');
  assert.equal(entryOf(report, '项目关系有效性').status, 'healthy'); // 无项目关系
  assert.equal(entryOf(report, 'gitignore 标准段').status, 'healthy'); // 未启用 git 跳过
  assert.equal(entryOf(report, '已跟踪忽略文件').status, 'healthy'); // 未启用 git 跳过
  assert.equal(entryOf(report, '域同步健康').status, 'healthy'); // 未关联域
  assert.equal(entryOf(report, '孤儿域镜像').status, 'healthy');
  assert.equal(entryOf(report, 'RAG 索引').status, 'stale'); // 索引为空
  assert.equal(entryOf(report, 'FTS 索引版本').status, 'stale');

  assert.equal(report.total, report.entries.length);
  assert.equal(report.healthy + report.stale + report.error + report.repaired, report.total);
});

test('init-meta：版本/语言一致 healthy；版本或语言不一致 stale', async () => {
  await setupBase();
  await writeInitMeta('1.2.3', ['cursor', 'claude-code'], 'zh');

  const ok = await runDoctorCheck();
  const e1 = entryOf(ok, 'Agent 文档注入');
  assert.equal(e1.status, 'healthy');
  assert.match(e1.message, /v1\.2\.3（cursor, claude-code，zh）/);

  const mismatch = await runDoctorCheck({ cliVersion: '9.9.9' });
  const e2 = entryOf(mismatch, 'Agent 文档注入');
  assert.equal(e2.status, 'stale');
  assert.match(e2.message, /v1\.2\.3 与当前 CLI v9\.9\.9 不一致/);

  await writeInitMeta('1.2.3', ['cursor', 'claude-code'], 'en');
  const languageMismatch = await runDoctorCheck();
  const e3 = entryOf(languageMismatch, 'Agent 文档注入');
  assert.equal(e3.status, 'stale');
  assert.match(e3.message, /注入文档语言 en 与当前 zh 不一致/);
});

test('项目索引：路径失效与无路径记录分别计入', async () => {
  await setupBase();
  const deadDir = join(env.tmpRoot, 'dead-proj');
  await putFile(join(deadDir, '.keep'), '');
  await registerProjectWithIds(U, [ID_A], deadDir, DERIVED);
  await rm(deadDir, { recursive: true, force: true });

  const dirB = join(env.tmpRoot, 'no-path-proj');
  await putFile(join(dirB, '.keep'), '');
  await registerProjectWithIds(U, [ID_B], dirB, DERIVED);
  await mutateMetaAndSync(await dirOfProject(ID_B), (m) => {
    m.localPaths = [];
  });

  const report = await runDoctorCheck();
  const e = entryOf(report, '项目索引');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /1\/2 个项目所有路径都失效/);
  assert.match(e.message, /1 个无路径记录/);
  assert.match(e.fix, /lattice scan/);
});

test('磁盘/数据库一致性：磁盘有项目而 DB 无记录 → stale；--fix 回填', async () => {
  await setupBase();
  const dir = join(env.tmpRoot, 'disk-only');
  await putFile(join(dir, '.keep'), '');
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', 'disk-only', 'project.json'),
    JSON.stringify({
      id: ID_A,
      ids: [ID_A],
      name: '磁盘孤儿',
      localPaths: [dir],
      gitRemotes: [],
      created: new Date().toISOString(),
    }),
  );

  const report = await runDoctorCheck();
  const e = entryOf(report, '磁盘/数据库一致性');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /1 个磁盘项目未同步到数据库/);

  const fixed = await runDoctorCheck({ fix: true });
  const e2 = entryOf(fixed, '磁盘/数据库一致性');
  assert.equal(e2.status, 'repaired');
  assert.match(e2.message, /已修复：回填 1 个项目到数据库/);
  assert.ok(
    listProjects(U).some((p) => p.id === ID_A),
    'db 应已回填该项目',
  );
});

test('重复项目检测：同一路径被两个非关联项目引用 → stale', async () => {
  await setupBase();
  const dirA = join(env.tmpRoot, 'dup-a');
  const dirB = join(env.tmpRoot, 'dup-b');
  await putFile(join(dirA, '.keep'), '');
  await putFile(join(dirB, '.keep'), '');
  await registerProjectWithIds(U, [ID_A], dirA, DERIVED);
  await registerProjectWithIds(U, [ID_B], dirB, DERIVED);

  // 把 B 的路径改成 A 的路径（真源 + db 同步），制造重复引用
  await mutateMetaAndSync(await dirOfProject(ID_B), (m) => {
    m.localPaths = [dirA];
  });

  const report = await runDoctorCheck();
  const stale = report.entries.filter((x) => x.item === '重复项目检测');
  assert.equal(stale.length, 1);
  assert.equal(stale[0].status, 'stale');
  assert.match(stale[0].message, /1 个路径被非虚拟合并的项目引用/);
});

test('lattice.json 引用一致性：目录内 id 与注册 id 不符 → stale', async () => {
  await setupBase();
  const dir = join(env.tmpRoot, 'lj-proj');
  await putFile(join(dir, '.keep'), '');
  await registerProjectWithIds(U, [ID_A], dir, DERIVED);
  await putFile(join(dir, 'lattice.json'), JSON.stringify({ id: 'git:9999888877776666' }));

  const report = await runDoctorCheck();
  const e = entryOf(report, 'lattice.json 引用一致性');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /1 个不一致/);
  assert.match(e.fix, /lattice link/);
});

test('项目分组注册表：重名/孤儿父级/环/悬空引用一次检出', async () => {
  await setupBase();
  await writeGroupRegistry(U, {
    version: 1,
    groups: [
      { id: 'grp-a1', name: '同名组' },
      { id: 'grp-a2', name: '同名组' },
      { id: 'grp-b', name: '孤儿父级', parentId: 'grp-ghost' },
      { id: 'grp-c1', name: '环1', parentId: 'grp-c2' },
      { id: 'grp-c2', name: '环2', parentId: 'grp-c1' },
    ],
  });
  const dir = join(env.tmpRoot, 'grp-proj');
  await putFile(join(dir, '.keep'), '');
  await registerProjectWithIds(U, [ID_A], dir, DERIVED);
  const dirs = await projectDirs();
  await mutateMetaAndSync(dirs[0], (m) => {
    m.groupIds = ['grp-ghost'];
  });

  const report = await runDoctorCheck();
  const e = entryOf(report, '项目分组注册表');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /1 组同级重名/);
  assert.match(e.message, /1 个节点父级引用缺失/);
  assert.match(e.message, /个节点处于父级环/);
  assert.match(e.message, /1 处项目分组引用悬空/);
  assert.match(e.fix, /project-groups\.json/);
});

test('数据库字段漂移：真源改名后 stale；--fix 从真源刷新', async () => {
  await setupBase();
  const dir = join(env.tmpRoot, 'drift-proj');
  await putFile(join(dir, '.keep'), '');
  await registerProjectWithIds(U, [ID_A], dir, DERIVED);
  // 只改真源、不同步 db → 制造字段漂移
  await mutateMetaOnly(await dirOfProject(ID_A), (m) => {
    m.name = '真源新名字';
  });

  const report = await runDoctorCheck();
  const e = entryOf(report, '数据库字段同步');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /1 个项目的数据库记录与 project\.json 不一致/);

  const fixed = await runDoctorCheck({ fix: true });
  const e2 = entryOf(fixed, '数据库字段同步');
  assert.equal(e2.status, 'repaired');
  assert.match(e2.message, /已修复 1\/1/);
  assert.equal(listProjects(U).find((p) => p.id === ID_A)?.name, '真源新名字');
});

test('任务关联项目有效性：引用不存在项目 → stale；--fix 清理', async () => {
  await setupBase();
  const task = await createTask(U, '关联失效任务', { projects: ['git:0000dead00000000'] });

  const report = await runDoctorCheck();
  const e = entryOf(report, '任务关联项目有效性');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /1 个任务关联了已不存在的项目/);

  const fixed = await runDoctorCheck({ fix: true });
  const e2 = entryOf(fixed, '任务关联项目有效性');
  assert.equal(e2.status, 'repaired');
  const after = (await listTasks(U)).find((t) => t.id === task.id);
  assert.deepEqual(after?.projects ?? [], []);
});

test('任务父子链有效性：悬空 parentTaskId → stale；--fix 清除', async () => {
  await setupBase();
  const task = await createTask(U, '悬空父链任务', {});
  // 直写 task.json（updateTask 有父任务存在性校验，无法经 API 制造悬空）
  const taskJsonPath = join(env.latticeHome, 'users', U, 'tasks', task.id, 'task.json');
  const raw = JSON.parse(await readFile(taskJsonPath, 'utf-8'));
  raw.parentTaskId = '2020-01-01-0000-ghos';
  await putFile(taskJsonPath, JSON.stringify(raw));

  const report = await runDoctorCheck();
  const e = entryOf(report, '任务父子链有效性');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /parentTaskId 指向已删除的任务/);

  const fixed = await runDoctorCheck({ fix: true });
  assert.equal(entryOf(fixed, '任务父子链有效性').status, 'repaired');
  const after = (await listTasks(U)).find((t) => t.id === task.id);
  assert.ok(!after?.parentTaskId, 'parentTaskId 应被清除');
});

test('项目关系有效性：引用已删除项目 → stale；--fix 移除关系', async () => {
  await setupBase();
  const dir = join(env.tmpRoot, 'rel-proj');
  await putFile(join(dir, '.keep'), '');
  await registerProjectWithIds(U, [ID_A], dir, DERIVED);
  await putFile(
    join(env.latticeHome, 'users', U, 'relations.json'),
    JSON.stringify({
      version: 1,
      relations: [
        {
          id: 'rel-doctor-1',
          type: 'related',
          projectA: ID_A,
          projectB: 'git:0000dead00000000',
          description: '悬空关系',
          createdBy: 'manual',
          created: new Date().toISOString(),
        },
      ],
    }),
  );

  const report = await runDoctorCheck();
  const e = entryOf(report, '项目关系有效性');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /1 条关系引用了已不存在的项目/);

  const fixed = await runDoctorCheck({ fix: true });
  assert.equal(entryOf(fixed, '项目关系有效性').status, 'repaired');
  assert.equal((await listRelations(U)).length, 0);
});

test('孤立任务目录：缺 task.json 的目录 → stale', async () => {
  await setupBase();
  await putFile(join(env.latticeHome, 'users', U, 'tasks', 'orphan-dir', '.keep'), '');

  const report = await runDoctorCheck();
  const e = entryOf(report, '任务目录完整性');
  assert.equal(e.status, 'stale');
  assert.match(e.message, /缺少 task\.json/);
});

test('--migrate：legacy 元数据升级 + db 回填 + 旧分组转注册表', async () => {
  await setupBase();
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', 'legacy-dir', 'project.json'),
    JSON.stringify({
      id: ID_A,
      name: '迁移项目',
      localPath: '/tmp/legacy-path',
      gitRemote: 'https://example.com/repo.git',
      groups: ['团队/子组'],
    }),
  );

  const report = await runDoctorCheck({ migrate: true });
  const e = entryOf(report, '数据迁移');
  assert.equal(e.status, 'repaired');
  assert.match(e.message, /扫描 1 个项目目录/);
  assert.match(e.message, /升级 1 个 legacy 元数据/);
  assert.match(e.message, /回填 1 个 db 缺失项目/);
  assert.match(e.message, /转换 1 个项目的旧分组/);

  const meta = JSON.parse(
    await readFile(
      join(env.latticeHome, 'users', U, 'projects', 'legacy-dir', 'project.json'),
      'utf-8',
    ),
  );
  assert.deepEqual(meta.localPaths, ['/tmp/legacy-path']);
  assert.deepEqual(meta.gitRemotes, ['https://example.com/repo.git']);
  assert.ok(!('localPath' in meta) && !('gitRemote' in meta) && !('groups' in meta));
  assert.equal(meta.groupIds.length, 1);
});

test('--rebuild-fingerprints：有效路径重建、失效路径计入失败', async () => {
  await setupBase();
  const repo = join(env.tmpRoot, 'fp-repo');
  await createFakeProject(repo);
  await registerProjectWithIds(U, [ID_A], repo, DERIVED);

  const gone = join(env.tmpRoot, 'fp-gone');
  await putFile(join(gone, '.keep'), '');
  await registerProjectWithIds(U, [ID_B], gone, DERIVED);
  await rm(gone, { recursive: true, force: true });

  const report = await runDoctorCheck({ rebuildFingerprints: true });
  const e = entryOf(report, '指纹重建');
  assert.equal(e.status, 'repaired');
  assert.match(e.message, /重建 1\/2 个项目/);
  assert.match(e.message, /1 个失败/);
});

test('--recheck-scope-paths：已升格为项目的 scopePath 提升到关联并清出', async () => {
  await setupBase();
  const dir = join(env.tmpRoot, 'scope-proj');
  await putFile(join(dir, '.keep'), '');
  await registerProjectWithIds(U, [ID_A], dir, DERIVED);
  const task = await createTask(U, 'scope 复核任务', {});
  await updateTask(U, task.id, {
    scopePaths: [{ path: dir, addedAt: new Date().toISOString() }],
  });

  const report = await runDoctorCheck({ recheckScopePaths: true });
  const e = entryOf(report, '任务 scopePaths 复核');
  assert.equal(e.status, 'repaired');
  assert.match(e.message, /提升 1 个 scopePath 至关联项目/);

  const after = (await listTasks(U)).find((t) => t.id === task.id);
  assert.ok(after?.projects?.includes(ID_A), '项目应被提升到关联');
  assert.deepEqual(after?.scopePaths ?? [], []);
});
