import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  initDb,
  listProjects,
  getProjectMeta,
  readGroupRegistry,
  listRelations,
  groupPathMap,
} from '@qcqx/lattice-core';
import { registerProjectCommand } from '../../src/commands/project';
import {
  createCliEnv,
  runCli,
  seedProject,
  parseCliJson,
  putFile,
  ID_A,
  ID_B,
  type CliEnv,
  type CliRunResult,
} from './helpers';

/**
 * project 命令组进程内测试（project.ts 805 行缺口主体）：
 * list / info / update / group（list·create·rename·remove）/ rename / where /
 * register / remove / relation（add·list·remove）/ profile tags。
 */

let env: CliEnv;

beforeEach(async () => {
  env = await createCliEnv();
  await seedProject(env, { ids: [ID_A], dirName: 'projA' });
  await seedProject(env, { ids: [ID_B], dirName: 'projB' });
});

afterEach(async () => {
  await env.cleanup();
});

const run = (args: string[]): Promise<CliRunResult> => runCli(registerProjectCommand, args);

/** 造一个含 git 仓库的目录（供 register 走 ID 源扫描） */
function createGitProject(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', [
    '-C',
    dir,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  ]);
}

test('project list --json：包含已注册项目；--has-git 过滤无 remote 项目', async () => {
  const all = await run(['project', 'list', '--json']);
  assert.equal(all.exitCode, 0, all.stderr);
  const text = JSON.stringify(parseCliJson(all));
  assert.ok(text.includes('projA') && text.includes('projB'));

  const hasGit = await run(['project', 'list', '--has-git', '--json']);
  assert.equal(hasGit.exitCode, 0);
  assert.ok(!JSON.stringify(parseCliJson(hasGit)).includes('projA'));
});

test('project info --json：详情含名称/路径；未知项目 → stderr + 退出码 1', async () => {
  const ok = await run(['project', 'info', ID_A, '--json']);
  assert.equal(ok.exitCode, 0, ok.stderr);
  const text = JSON.stringify(parseCliJson(ok));
  assert.ok(text.includes('projA'));

  const missing = await run(['project', 'info', 'legacy:0000000000000000', '--json']);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /未找到项目/);
});

test('project update：名称/描述/标签落库', async () => {
  const r = await run([
    'project',
    'update',
    ID_A,
    '--name',
    '项目甲',
    '--description',
    '项目描述',
    '--tags',
    'cli,test',
  ]);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /已更新/);

  await initDb();
  const row = listProjects().find((p) => p.id === ID_A);
  assert.equal(row?.name, '项目甲');
  assert.equal(row?.description, '项目描述');
  assert.deepEqual(JSON.parse(row?.tags ?? '[]'), ['cli', 'test']);
});

test('project group：create 路径化 + list --json 树 + rename/remove 注册表', async () => {
  const created = await run(['project', 'group', 'create', '团队/前端', '团队/后端']);
  assert.equal(created.exitCode, 0, created.stderr);

  await initDb();
  let registry = await readGroupRegistry('t');
  const paths = groupPathMap(registry.groups);
  assert.ok([...paths.values()].includes('团队/前端'));
  assert.ok([...paths.values()].includes('团队/后端'));

  const list = await run(['project', 'group', 'list', '--json']);
  assert.equal(list.exitCode, 0, list.stderr);
  const parsed = parseCliJson(list) as { total: number; tree: unknown[] };
  assert.equal(parsed.total, 3);

  const rename = await run(['project', 'group', 'rename', '团队/前端', '前端组', '-f']);
  assert.equal(rename.exitCode, 0, rename.stderr);
  await initDb();
  registry = await readGroupRegistry('t');
  assert.ok(
    [...groupPathMap(registry.groups).values()].some((p) => p.endsWith('前端组')),
    `重命名后应存在 前端组，实际：${[...groupPathMap(registry.groups).values()].join(', ')}`,
  );

  const remove = await run(['project', 'group', 'remove', '团队/后端', '-f']);
  assert.equal(remove.exitCode, 0, remove.stderr);
  await initDb();
  registry = await readGroupRegistry('t');
  assert.ok(
    ![...groupPathMap(registry.groups).values()].some((p) => p.endsWith('后端')),
    '后端分组应被移除',
  );
});

test('project update --add-groups：项目挂到分组（meta.groupIds）', async () => {
  await run(['project', 'group', 'create', '团队/前端']);
  const r = await run(['project', 'update', ID_A, '--add-groups', '团队/前端']);
  assert.equal(r.exitCode, 0, r.stderr);

  await initDb();
  const meta = await getProjectMeta('t', ID_A);
  assert.equal(meta?.groupIds?.length, 1);

  // 移除分组（按路径）
  const rm = await run(['project', 'update', ID_A, '--remove-groups', '团队/前端']);
  assert.equal(rm.exitCode, 0, rm.stderr);
  await initDb();
  assert.deepEqual((await getProjectMeta('t', ID_A))?.groupIds ?? [], []);
});

test('project where --json：按路径命中项目', async () => {
  const r = await run(['project', 'where', join(env.tmpRoot, 'projA'), '--json']);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.ok(JSON.stringify(parseCliJson(r)).includes(ID_A));
});

test('project register：git 仓库扫描注册新项目；已注册路径幂等', async () => {
  const newDir = join(env.tmpRoot, 'newproj');
  createGitProject(newDir);

  const r = await run(['project', 'register', newDir, '--json']);
  assert.equal(r.exitCode, 0, r.stderr);
  await initDb();
  const projects = listProjects();
  assert.ok(projects.some((p) => p.name === 'newproj'));

  const again = await run(['project', 'register', newDir, '--json']);
  assert.equal(again.exitCode, 0, again.stderr);
});

test('project remove -f：移入垃圾桶后不再出现在列表', async () => {
  const r = await run(['project', 'remove', ID_B, '-f']);
  assert.equal(r.exitCode, 0, r.stderr);
  await initDb();
  assert.ok(!listProjects().some((p) => p.id === ID_B));
});

test('project relation add/list/remove：关系落盘、查询与删除', async () => {
  const add = await run([
    'project',
    'relation',
    'add',
    ID_A,
    ID_B,
    '--type',
    'depends-on',
    '--description',
    '依赖描述',
  ]);
  assert.equal(add.exitCode, 0, add.stderr);

  await initDb();
  const relations = await listRelations('t');
  assert.equal(relations.length, 1);
  assert.equal(relations[0].description, '依赖描述');
  const relId = relations[0].id;

  const list = await run(['project', 'relation', 'list', '--json']);
  assert.equal(list.exitCode, 0, list.stderr);
  assert.ok(JSON.stringify(parseCliJson(list)).includes('依赖描述'));

  const rm = await run(['project', 'relation', 'remove', relId, '-f']);
  assert.equal(rm.exitCode, 0, rm.stderr);
  await initDb();
  assert.equal((await listRelations('t')).length, 0);
});

test('project profile tags：set/add/show/remove 全链路', async () => {
  const set = await run(['project', 'profile', 'tags', 'set', ID_A, '--tags', 'a,b']);
  assert.equal(set.exitCode, 0, set.stderr);

  const afterSet = await run(['project', 'profile', 'tags', 'show', ID_A, '--json']);
  assert.equal(afterSet.exitCode, 0, afterSet.stderr);
  assert.deepEqual((parseCliJson(afterSet) as { tags: string[] }).tags, ['a', 'b']);

  const add = await run(['project', 'profile', 'tags', 'add', ID_A, '--tags', 'c']);
  assert.equal(add.exitCode, 0, add.stderr);
  const afterAdd = await run(['project', 'profile', 'tags', 'show', ID_A, '--json']);
  assert.deepEqual((parseCliJson(afterAdd) as { tags: string[] }).tags, ['a', 'b', 'c']);

  const rm = await run(['project', 'profile', 'tags', 'remove', ID_A, '--tags', 'a']);
  assert.equal(rm.exitCode, 0, rm.stderr);
  const afterRm = await run(['project', 'profile', 'tags', 'show', ID_A, '--json']);
  assert.deepEqual((parseCliJson(afterRm) as { tags: string[] }).tags, ['b', 'c']);
});

test('project profile path/show：画像文件路径与内容读取', async () => {
  const pathRun = await run(['project', 'profile', 'path', ID_A]);
  assert.equal(pathRun.exitCode, 0, pathRun.stderr);
  assert.match(pathRun.stdout, /\/profile$/);

  // 写一份画像 summary 后 show 输出内容
  const profileDir = pathRun.stdout.trim().split('\n').pop() ?? '';
  await putFile(join(profileDir, 'summary.md'), '# 画像内容\n');
  const show = await run(['project', 'profile', 'show', ID_A]);
  assert.equal(show.exitCode, 0, show.stderr);
  assert.match(show.stdout, /画像内容/);
});
