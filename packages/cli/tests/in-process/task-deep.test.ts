import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  createTask,
  getTaskMeta,
  getUserSpecDir,
  initDb,
  listCheckpoints,
  registerProjectWithIds,
  updateTask,
} from '@qcqx/lattice-core';
import { registerTaskCommand } from '../../src/commands/task';
import { clearCurrentProjectCache } from '../../src/utils/current-project';
import {
  createCliEnv,
  runCli,
  seedProject,
  seedTask,
  parseCliJson,
  putFile,
  DERIVED,
  ID_A,
  ID_B,
  U,
  type CliEnv,
  type CliRunResult,
} from './helpers';

let env: CliEnv;
let projectDir: string;
const repoCwd = process.cwd();

beforeEach(async () => {
  env = await createCliEnv();
  const meta = await seedProject(env, { ids: [ID_A], dirName: 'projA' });
  projectDir = meta.localPaths![0];
  await putFile(join(projectDir, 'lattice.json'), JSON.stringify({ id: 'aaaabbbbccccdddd' }));
  await seedProject(env, { ids: [ID_B], dirName: 'projB' });
  process.chdir(env.tmpRoot);
  clearCurrentProjectCache();
});

afterEach(async () => {
  clearCurrentProjectCache();
  process.chdir(repoCwd);
  await env.cleanup();
});

const run = (args: string[]): Promise<CliRunResult> => runCli(registerTaskCommand, args);

function inProject<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(projectDir);
  clearCurrentProjectCache();
  return fn().finally(() => {
    process.chdir(prev);
    clearCurrentProjectCache();
  });
}

test('task list：项目过滤/current/跨用户/人类输出/分页/空态/互斥错误', async () => {
  const own = await seedTask('本用户任务', [ID_A]);
  await registerProjectWithIds('u2', [ID_B], join(env.tmpRoot, 'projU2'), DERIVED);
  const other = await createTask('u2', '他人任务', { projects: [ID_A] });
  await seedTask('无项目任务');
  await initDb();

  const byProject = await run(['task', 'list', '--project', ID_A, '--json']);
  const byProjectText = JSON.stringify(parseCliJson(byProject));
  assert.ok(byProjectText.includes(own.id));
  assert.ok(!byProjectText.includes('无项目任务'));

  const human = await run(['task', 'list', '--project', ID_A]);
  assert.match(human.stdout, /本用户任务/);
  assert.match(human.stdout, /关联项目：1 个/);
  const paged = await run(['task', 'list', '--page', '1', '--page-size', '1']);
  assert.match(paged.stdout, /第 1\//);
  const empty = await run(['task', 'list', '--status', 'archived']);
  assert.match(empty.stdout, /暂无任务/);

  const allUser = await run(['task', 'list', '--all-user', '--project', ID_A]);
  assert.match(allUser.stdout, /跨用户/);
  assert.match(allUser.stdout, /他人任务/);
  assert.match(allUser.stdout, /\[u2\]/);
  const onlyU2 = await run(['task', 'list', '--user', 'u2', '--project', ID_A, '--json']);
  assert.ok(JSON.stringify(parseCliJson(onlyU2)).includes(other.id));
  const noTasks = await run(['task', 'list', '--all-user', '--project', ID_B]);
  assert.match(noTasks.stdout, /暂无任务/);

  const noProject = await run(['task', 'list', '--all-user', '--json']);
  assert.equal(noProject.exitCode, 1);
  const both = await run(['task', 'list', '--all-user', '--user', U, '--project', ID_A, '--json']);
  assert.equal(both.exitCode, 1);
  assert.match(both.stderr, /不能同时使用/);

  await inProject(async () => {
    const current = await run(['task', 'list', '--current', '--json']);
    assert.equal(current.exitCode, 0, current.stderr);
    assert.ok(JSON.stringify(parseCliJson(current)).includes(own.id));
  });
});

test('task create/info：多项目/current/父任务/lineage/tree/descendants/人类输出', async () => {
  const parent = await seedTask('父任务');
  await initDb();

  const multi = await run([
    'task',
    'create',
    '多项目任务',
    '-p',
    ID_A,
    ID_B,
    '--parent',
    parent.id,
  ]);
  assert.equal(multi.exitCode, 0, multi.stderr);
  assert.match(multi.stdout, /任务已创建/);
  const id = /([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{4}-[^\s]+)/.exec(multi.stdout)?.[1];
  assert.ok(id);
  await initDb();
  const created = await getTaskMeta(U, id!);
  assert.deepEqual([...(created?.projects ?? [])].sort(), [ID_A, ID_B].sort());
  assert.equal(created?.parentTaskId, parent.id);

  await inProject(async () => {
    const current = await run(['task', 'create', '当前项目任务', '--current', '-q']);
    assert.equal(current.exitCode, 0, current.stderr);
    await initDb();
    const meta = await getTaskMeta(U, current.stdout.trim());
    assert.deepEqual(meta?.projects, [ID_A]);
  });

  const info = await run(['task', 'info', parent.id]);
  assert.match(info.stdout, /父任务/);
  assert.match(info.stdout, /PRD/);
  const infoTaxonomy = await run([
    'task',
    'info',
    parent.id,
    '--lineage',
    '--tree',
    '--descendants',
  ]);
  assert.match(infoTaxonomy.stdout, /父任务链路|所在任务树|后代任务树/);
  const infoJson = await run([
    'task',
    'info',
    parent.id,
    '--lineage',
    '--tree',
    '--descendants',
    '--json',
  ]);
  const parsed = parseCliJson(infoJson) as { meta: { id: string }; tree: unknown };
  assert.equal(parsed.meta.id, parent.id);
  assert.ok(parsed.tree);

  const treeHuman = await run(['task', 'tree', parent.id]);
  assert.match(treeHuman.stdout, /父任务/);
  const treeDesc = await run(['task', 'tree', parent.id, '--descendants']);
  assert.equal(treeDesc.exitCode, 0, treeDesc.stderr);
  const treeJson = await run(['task', 'tree', parent.id, '--json']);
  assert.equal(treeJson.exitCode, 0, treeJson.stderr);
  const lineageJson = await run(['task', 'lineage', id!, '--json']);
  assert.ok(JSON.stringify(parseCliJson(lineageJson)).includes(parent.id));
});

test('task update：项目集合/current/parent 清理/无字段/未知/非法标题', async () => {
  const task = await seedTask('更新目标', [ID_A]);
  const parent = await seedTask('新父任务');
  await initDb();

  const replace = await run(['task', 'update', task.id, '-p', ID_B]);
  assert.equal(replace.exitCode, 0, replace.stderr);
  assert.match(replace.stdout, /已更新/);
  await initDb();
  assert.deepEqual((await getTaskMeta(U, task.id))?.projects, [ID_B]);

  await inProject(async () => {
    const addCurrent = await run(['task', 'update', task.id, '--add-current-project']);
    assert.equal(addCurrent.exitCode, 0, addCurrent.stderr);
    await initDb();
    assert.deepEqual(
      [...((await getTaskMeta(U, task.id))?.projects ?? [])].sort(),
      [ID_A, ID_B].sort(),
    );
  });

  const remove = await run(['task', 'update', task.id, '--remove-project', ID_A]);
  assert.equal(remove.exitCode, 0, remove.stderr);
  const clear = await run(['task', 'update', task.id, '--clear-projects']);
  assert.equal(clear.exitCode, 0, clear.stderr);

  const setParent = await run(['task', 'update', task.id, '--parent', parent.id]);
  assert.equal(setParent.exitCode, 0, setParent.stderr);
  assert.match(setParent.stdout, /父：/);
  await initDb();
  assert.equal((await getTaskMeta(U, task.id))?.parentTaskId, parent.id);
  const clearParent = await run(['task', 'update', task.id, '--clear-parent']);
  assert.equal(clearParent.exitCode, 0, clearParent.stderr);
  await initDb();
  assert.equal((await getTaskMeta(U, task.id))?.parentTaskId, undefined);

  const both = await run(['task', 'update', task.id, '--parent', parent.id, '--clear-parent']);
  assert.match(both.stdout, /不能同时指定/);
  const missingParent = await run(['task', 'update', task.id, '--parent', 'missing-task']);
  assert.match(missingParent.stdout, /未找到父任务/);
  const noFields = await run(['task', 'update', task.id]);
  assert.match(noFields.stdout, /没有可更新的字段/);
  const emptyTitle = await run(['task', 'update', task.id, '--title', ' ', '--json']);
  assert.equal(emptyTitle.exitCode, 1);
  const unknown = await run(['task', 'update', '2020-01-01-0000-ghos', '--title', 'x', '--json']);
  assert.equal(unknown.exitCode, 1);
  assert.match(unknown.stderr, /未找到任务/);
});

test('task checkpoint/progress：人类输出/--refs/--last/--id/未知', async () => {
  const task = await seedTask('记录任务');
  const specId = 'spec-checkp01';
  await putFile(
    join(getUserSpecDir(U), 'checkpoint-spec.md'),
    `---\nid: ${specId}\ntitle: 检查点规范\nupdated: '2030-01-01T00:00:00.000Z'\n---\n\n# 规范\n`,
  );
  await initDb();

  const cp = await run([
    'task',
    'checkpoint',
    task.id,
    '--type',
    'decision',
    '--title',
    '决定记录',
    '-m',
    '正文',
    '--refs',
    specId,
  ]);
  assert.equal(cp.exitCode, 0, cp.stderr);
  assert.match(cp.stdout, /检查点已添加/);
  await initDb();
  const checkpoints = await listCheckpoints(U, task.id);
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(
    (await getTaskMeta(U, task.id))?.referencedSpecs?.map((s) => s.id),
    [specId],
  );

  const progress = await run(['task', 'progress', task.id]);
  assert.match(progress.stdout, /决定记录/);
  const last = await run(['task', 'progress', task.id, '--last', '1', '--json']);
  assert.equal(last.exitCode, 0, last.stderr);
  const byId = await run(['task', 'progress', task.id, '--id', checkpoints[0].id, '--json']);
  assert.ok(JSON.stringify(parseCliJson(byId)).includes(checkpoints[0].id));
  const missingCp = await run(['task', 'progress', task.id, '--id', 'cp-missing', '--json']);
  assert.equal(missingCp.exitCode, 1);
  const unknownTask = await run(['task', 'progress', '2020-01-01-0000-ghos', '--json']);
  assert.equal(unknownTask.exitCode, 1);

  const unknown = await run([
    'task',
    'checkpoint',
    '2020-01-01-0000-ghos',
    '--type',
    'note',
    '-m',
    'x',
    '--json',
  ]);
  assert.equal(unknown.exitCode, 1);
});

test('task associate/ref-spec/delete：current/remove-path/clear/多个 spec/未知', async () => {
  const task = await seedTask('关联深水');
  const extra = join(env.tmpRoot, 'extra');
  const second = join(env.tmpRoot, 'second');
  await putFile(join(extra, '.keep'), '');
  await putFile(join(second, '.keep'), '');
  await putFile(
    join(getUserSpecDir(U), 'one.md'),
    `---\nid: spec-one00001\ntitle: 规范一\nupdated: '2030-01-01T00:00:00.000Z'\n---\n\n# 一\n`,
  );
  await putFile(
    join(getUserSpecDir(U), 'two.md'),
    `---\nid: spec-two00002\ntitle: 规范二\nupdated: '2030-01-01T00:00:00.000Z'\n---\n\n# 二\n`,
  );
  await initDb();

  await inProject(async () => {
    const current = await run(['task', 'associate', task.id, '--current']);
    assert.equal(current.exitCode, 0, current.stderr);
    assert.match(current.stdout, /关联已更新/);
  });

  const paths = await run([
    'task',
    'associate',
    task.id,
    '--paths',
    extra,
    second,
    '--note',
    '备注',
  ]);
  assert.equal(paths.exitCode, 0, paths.stderr);
  await initDb();
  const meta = await getTaskMeta(U, task.id);
  assert.deepEqual(meta?.projects, [ID_A]);
  assert.equal(meta?.scopePaths?.length, 2);
  assert.match(paths.stdout, /路径 2/);

  const removePath = await run(['task', 'associate', task.id, '--remove-path', extra]);
  assert.equal(removePath.exitCode, 0, removePath.stderr);
  await initDb();
  assert.equal((await getTaskMeta(U, task.id))?.scopePaths?.length, 1);
  const clearPaths = await run(['task', 'associate', task.id, '--clear-paths']);
  assert.equal(clearPaths.exitCode, 0, clearPaths.stderr);
  await initDb();
  assert.deepEqual((await getTaskMeta(U, task.id))?.scopePaths ?? [], []);

  const noCurrent = await run(['task', 'associate', task.id, '--current', '--json']);
  assert.equal(noCurrent.exitCode, 0, '项目外 --current 静默忽略');
  const unknown = await run(['task', 'associate', '2020-01-01-0000-ghos', '--current', '--json']);
  assert.equal(unknown.exitCode, 1);

  const refs = await run(['task', 'ref-spec', task.id, 'spec-one00001', '规范二']);
  assert.equal(refs.exitCode, 0, refs.stderr);
  await initDb();
  assert.deepEqual((await getTaskMeta(U, task.id))?.referencedSpecs?.map((s) => s.id).sort(), [
    'spec-one00001',
    'spec-two00002',
  ]);
  const duplicate = await run(['task', 'ref-spec', task.id, 'spec-one00001']);
  assert.equal(duplicate.exitCode, 0, duplicate.stderr);
  const unref = await run(['task', 'unref-spec', task.id, 'spec-one00001', 'spec-two00002']);
  assert.equal(unref.exitCode, 0, unref.stderr);
  await initDb();
  assert.deepEqual((await getTaskMeta(U, task.id))?.referencedSpecs ?? [], []);

  // 未知 ref 的多匹配/不存在分支
  const bad = await run(['task', 'ref-spec', task.id, 'no-such-spec']);
  assert.equal(bad.exitCode, 1);

  const del = await run(['task', 'delete', '2020-01-01-0000-ghos', '--json']);
  assert.equal(del.exitCode, 1);
  assert.match(del.stderr, /未找到任务/);
});

test('task 状态流转人类输出：start/complete/archive/reopen 的未知任务提示', async () => {
  const task = await seedTask('状态任务');
  await updateTask(U, task.id, { status: 'planning' });
  await initDb();
  for (const cmd of ['start', 'complete', 'archive', 'reopen']) {
    const r = await run(['task', cmd, task.id]);
    assert.equal(r.exitCode, 0, `${cmd}: ${r.stderr}`);
    assert.match(r.stdout, /已|任务/);
  }
  for (const cmd of ['start', 'complete', 'archive', 'reopen']) {
    const r = await run(['task', cmd, '2020-01-01-0000-ghos', '--json']);
    assert.equal(r.exitCode, 1, cmd);
  }
});
