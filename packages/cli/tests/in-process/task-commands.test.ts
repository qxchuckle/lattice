import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  initDb,
  listTasks,
  getTaskMeta,
  listCheckpoints,
  getUserSpecDir,
  getTaskPrdPath,
} from '@qcqx/lattice-core';
import { registerTaskCommand } from '../../src/commands/task';
import {
  createCliEnv,
  runCli,
  seedProject,
  seedTask,
  parseCliJson,
  putFile,
  U,
  ID_A,
  ID_B,
  type CliEnv,
  type CliRunResult,
} from './helpers';

/**
 * task 命令组进程内测试（task.ts 519 行缺口主体）：
 * create / list / info / update / start / complete / archive / reopen /
 * checkpoint / progress / associate / ref-spec / unref-spec / tree / lineage / delete，
 * 含 machine 契约（--json 输出 JSON、失败走 stderr + 退出码 1）与未知引用边界。
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

const run = (args: string[]): Promise<CliRunResult> => runCli(registerTaskCommand, args);

test('task create -q：只输出任务 ID，task.json 落盘且项目关联正确', async () => {
  const r = await run(['task', 'create', '任务甲', '-p', ID_A, '-q']);
  assert.equal(r.exitCode, 0, r.stderr);
  const id = r.stdout.trim();
  assert.match(id, /^\d{4}-\d{2}-\d{2}-[0-9a-f]{4}-.+/);

  await initDb();
  const meta = await getTaskMeta(U, id);
  assert.ok(meta);
  assert.equal(meta.title, '任务甲');
  assert.deepEqual(meta.projects, [ID_A]);
});

test('task create 人读输出：含任务 ID 与 PRD 路径；父任务不存在 → 退出码 1', async () => {
  const ok = await run(['task', 'create', '任务乙']);
  assert.equal(ok.exitCode, 0);
  assert.match(ok.stdout, /任务已创建/);
  assert.match(ok.stdout, /PRD：/);

  await initDb();
  const created = (await listTasks(U)).find((t) => t.title === '任务乙');
  assert.ok(created);
  assert.ok(ok.stdout.includes(getTaskPrdPath(U, created.id)));

  const bad = await run(['task', 'create', '任务丙', '--parent', '2020-01-01-0000-ghos']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.stdout, /未找到父任务/);
});

test('task list --json：table 输出含标题；--status 过滤生效', async () => {
  const t1 = await seedTask('列表任务一', [ID_A]);
  await seedTask('列表任务二');
  await initDb();

  const all = await run(['task', 'list', '--json']);
  assert.equal(all.exitCode, 0, all.stderr);
  const text = JSON.stringify(parseCliJson(all));
  assert.ok(text.includes('列表任务一') && text.includes('列表任务二'));

  const done = await run(['task', 'list', '--status', 'completed', '--json']);
  assert.equal(done.exitCode, 0);
  assert.ok(!JSON.stringify(parseCliJson(done)).includes('列表任务一'));

  await initDb();
  await import('@qcqx/lattice-core').then(async (core) => {
    await core.updateTask(U, t1.id, { status: 'completed' });
  });
  const filtered = await run(['task', 'list', '--status', 'completed', '--json']);
  assert.ok(JSON.stringify(parseCliJson(filtered)).includes('列表任务一'));
});

test('task list --user 非法用户 → machine 失败（stderr + 退出码 1）', async () => {
  const r = await run(['task', 'list', '--user', 'ghost-user', '--json']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /用户不存在/);
});

test('task info --json：详情含标题/状态；未知 ID → stderr 提示 + 退出码 1', async () => {
  const task = await seedTask('详情任务', [ID_A]);
  await initDb();

  const ok = await run(['task', 'info', task.id, '--json']);
  assert.equal(ok.exitCode, 0, ok.stderr);
  const text = JSON.stringify(parseCliJson(ok));
  assert.ok(text.includes('详情任务'));

  const missing = await run(['task', 'info', '2020-01-01-0000-ghos', '--json']);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /未找到任务/);
});

test('task update：标题/状态/项目集合增删', async () => {
  const task = await seedTask('待更新任务', [ID_A]);
  await initDb();

  const r = await run([
    'task',
    'update',
    task.id,
    '--title',
    '已更新标题',
    '--status',
    'in_progress',
    '--add-project',
    ID_B,
  ]);
  assert.equal(r.exitCode, 0, r.stderr);

  await initDb();
  const meta = await getTaskMeta(U, task.id);
  assert.equal(meta?.title, '已更新标题');
  assert.equal(meta?.status, 'in_progress');
  assert.deepEqual([...(meta?.projects ?? [])].sort(), [ID_A, ID_B].sort());

  await initDb();
  const clear = await run(['task', 'update', task.id, '--clear-projects']);
  assert.equal(clear.exitCode, 0, clear.stderr);
  await initDb();
  assert.deepEqual((await getTaskMeta(U, task.id))?.projects ?? [], []);
});

test('task start/complete/archive/reopen 状态流转', async () => {
  const task = await seedTask('流转任务');
  await initDb();

  for (const [cmd, status] of [
    ['start', 'in_progress'],
    ['complete', 'completed'],
    ['archive', 'archived'],
    ['reopen', 'in_progress'],
  ] as const) {
    const r = await run(['task', cmd, task.id]);
    assert.equal(r.exitCode, 0, `${cmd}: ${r.stderr}`);
    await initDb();
    assert.equal((await getTaskMeta(U, task.id))?.status, status, `${cmd} 后状态`);
  }
});

test('task checkpoint + progress --json：检查点写入并可从机器输出读取', async () => {
  const task = await seedTask('检查点任务');
  await initDb();

  const add = await run([
    'task',
    'checkpoint',
    task.id,
    '--type',
    'note',
    '--title',
    '记录一条检查点',
    '-m',
    '检查点正文',
  ]);
  assert.equal(add.exitCode, 0, add.stderr);
  await initDb();
  const checkpoints = await listCheckpoints(U, task.id);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].title, '记录一条检查点');

  await initDb();
  const progress = await run(['task', 'progress', task.id, '--json']);
  assert.equal(progress.exitCode, 0, progress.stderr);
  assert.ok(JSON.stringify(parseCliJson(progress)).includes('记录一条检查点'));

  const filtered = await run(['task', 'progress', task.id, '--type', 'decision', '--json']);
  assert.ok(!JSON.stringify(parseCliJson(filtered)).includes('记录一条检查点'));
});

test('task associate：项目追加、路径入 scopePaths、--remove-project 移除', async () => {
  const task = await seedTask('关联任务');
  const extraPath = join(env.tmpRoot, 'extra-dir');
  await putFile(join(extraPath, '.keep'), '');
  await initDb();

  const add = await run([
    'task',
    'associate',
    task.id,
    '-p',
    ID_B,
    '--paths',
    extraPath,
    '--note',
    '额外目录',
  ]);
  assert.equal(add.exitCode, 0, add.stderr);
  await initDb();
  let meta = await getTaskMeta(U, task.id);
  assert.deepEqual(meta?.projects, [ID_B]);
  assert.equal(meta?.scopePaths?.length, 1);
  assert.equal(meta?.scopePaths?.[0].path, extraPath);
  assert.equal(meta?.scopePaths?.[0].note, '额外目录');

  await initDb();
  const remove = await run(['task', 'associate', task.id, '--remove-project', ID_B]);
  assert.equal(remove.exitCode, 0, remove.stderr);
  await initDb();
  meta = await getTaskMeta(U, task.id);
  assert.deepEqual(meta?.projects ?? [], []);
});

test('task ref-spec/unref-spec：按 spec id 引用与移除', async () => {
  const specId = 'spec-aaaaaaaa';
  await putFile(
    join(getUserSpecDir(U), 'ref-target.md'),
    [
      '---',
      `id: ${specId}`,
      'title: 引用目标规范',
      "updated: '2030-01-01T00:00:00.000Z'",
      '---',
      '# 引用目标规范',
      '',
    ].join('\n'),
  );
  const task = await seedTask('引用任务');
  await initDb();

  const add = await run(['task', 'ref-spec', task.id, specId]);
  assert.equal(add.exitCode, 0, add.stderr);
  await initDb();
  assert.deepEqual(
    ((await getTaskMeta(U, task.id))?.referencedSpecs ?? []).map((s) => s.id),
    [specId],
  );

  await initDb();
  const rm = await run(['task', 'unref-spec', task.id, specId]);
  assert.equal(rm.exitCode, 0, rm.stderr);
  await initDb();
  assert.deepEqual((await getTaskMeta(U, task.id))?.referencedSpecs ?? [], []);

  // 未知 spec → 退出码 1（errors 分支）
  await initDb();
  const bad = await run(['task', 'ref-spec', task.id, 'spec-does-not-exist']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.stdout + bad.stderr, /⚠|未找到|无法/);
});

test('task tree/lineage：父子任务链路输出', async () => {
  const parent = await seedTask('父任务');
  await initDb();
  const child = await import('@qcqx/lattice-core').then((core) =>
    core.createTask(U, '子任务', { parentTaskId: parent.id }),
  );

  const tree = await run(['task', 'tree', parent.id]);
  assert.equal(tree.exitCode, 0, tree.stderr);
  assert.match(tree.stdout, /父任务/);
  assert.match(tree.stdout, /子任务/);

  const lineage = await run(['task', 'lineage', child.id]);
  assert.equal(lineage.exitCode, 0, lineage.stderr);
  assert.match(lineage.stdout, /父任务/);
});

test('task delete：移入垃圾桶后任务列表不再出现', async () => {
  const task = await seedTask('待删除任务');
  await initDb();

  const r = await run(['task', 'delete', task.id]);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /已移入垃圾桶/);

  await initDb();
  assert.ok(!(await listTasks(U)).some((t) => t.id === task.id));
});

test('task create/update 未知输入：非法状态值 → 退出码 1', async () => {
  const task = await seedTask('非法状态任务');
  await initDb();
  const r = await run(['task', 'update', task.id, '--status', 'not-a-status', '--json']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /无效状态/);
});

test('fixture 自检：PRD 文件随任务创建落盘', async () => {
  const r = await run(['task', 'create', 'PRD 落盘任务', '-q']);
  const id = r.stdout.trim();
  const prd = await readFile(getTaskPrdPath(U, id), 'utf-8');
  assert.ok(prd.length >= 0);
});
