import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  archiveTask,
  createTask,
  getTaskContainingTree,
  getTaskPrd,
  listTasksCrossUser,
  purgeTask,
  updateTask,
} from '../src/task';
import { closeDb, initDb } from '../src/index';
import { fileExists, getTaskDir, getTaskMetaPath } from '../src/paths';
import { writeJSON } from '../src/paths';
import { createTempLatticeHome, putFile } from './helpers';

const U = 'u1';

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

test('updateTask：父任务自指/缺失/环检测/清空/不存在', async () => {
  const parent = await createTask(U, '父任务');
  const child = await createTask(U, '子任务', { parentTaskId: parent.id });

  await assert.rejects(
    () => updateTask(U, child.id, { parentTaskId: child.id }),
    /不能把自己设为父任务/,
  );
  await assert.rejects(
    () => updateTask(U, child.id, { parentTaskId: 'missing-task' }),
    /未找到父任务/,
  );
  await assert.rejects(
    () => updateTask(U, parent.id, { parentTaskId: child.id }),
    /不能把任务挂到自己的后代下面/,
  );

  const cleared = await updateTask(U, child.id, { parentTaskId: undefined });
  assert.equal(cleared?.parentTaskId, undefined);
  const reSet = await updateTask(U, child.id, { parentTaskId: parent.id });
  assert.equal(reSet?.parentTaskId, parent.id);
  assert.equal(await updateTask(U, 'missing-task', { title: 'x' }), null);

  // 无 parentTaskId 字段的更新保留现有父任务
  const titleOnly = await updateTask(U, child.id, { title: '改名' });
  assert.equal(titleOnly?.parentTaskId, parent.id);
});

test('purgeTask/archiveTask/getTaskPrd：子任务保护与目录删除', async () => {
  const parent = await createTask(U, '待清理父任务', { projects: ['legacy:p1'] });
  const child = await createTask(U, '待清理子任务', { parentTaskId: parent.id });

  await assert.rejects(() => purgeTask(U, parent.id), /任务仍有子任务/);
  assert.ok(await fileExists(getTaskDir(U, parent.id)));

  await purgeTask(U, child.id);
  assert.equal(await fileExists(getTaskDir(U, child.id)), false);
  await purgeTask(U, parent.id);
  assert.equal(await fileExists(getTaskDir(U, parent.id)), false);

  const archived = await createTask(U, '归档任务');
  assert.match((await getTaskPrd(U, archived.id)) ?? '', /# 归档任务/);
  const result = await archiveTask(U, archived.id);
  assert.equal(result?.status, 'archived');
  assert.equal(await getTaskPrd(U, 'missing-task'), null);
});

test('listTasksCrossUser：跨用户/状态/项目过滤与损坏目录跳过', async () => {
  const own = await createTask(U, '本用户任务', { projects: ['legacy:p1'] });
  const other = await createTask('u2', '他人任务', {
    projects: ['legacy:p1'],
    status: 'completed',
  });
  await createTask('u2', '他人其他项目', { projects: ['legacy:p2'] });
  await createTask('u1', '本用户归档', { projects: ['legacy:p1'], status: 'archived' });

  // 损坏的 task.json：读取时跳过
  await putFile(join(env.latticeHome, 'users', 'u3', 'tasks', 'bad-task', 'task.json'), 'not json');

  const all = await listTasksCrossUser(U, 'p1');
  assert.ok(all.some((t) => t.id === own.id && t.sourceUser === U));
  assert.ok(all.some((t) => t.id === other.id && t.sourceUser === 'u2'));
  assert.ok(!all.some((t) => t.title === '他人其他项目'));
  assert.ok(
    all.some((t) => t.title === '本用户归档'),
    '未指定状态时归档任务也返回',
  );

  const onlyU2 = await listTasksCrossUser(U, 'p1', { usernames: ['u2'] });
  assert.deepEqual(
    onlyU2.map((t) => t.id),
    [other.id],
  );
  const planning = await listTasksCrossUser(U, 'p1', { status: 'planning' });
  assert.deepEqual(
    planning.map((t) => t.id),
    [own.id],
  );
  assert.deepEqual(await listTasksCrossUser(U, 'legacy:none'), []);
  assert.ok((await listTasksCrossUser(U, 'p1')).length >= 2);
});

test('getTaskContainingTree：多级父链/缺失/环保护', async () => {
  const grand = await createTask(U, '祖父');
  const parent = await createTask(U, '父', { parentTaskId: grand.id });
  const child = await createTask(U, '子', { parentTaskId: parent.id });

  const tree = await getTaskContainingTree(U, child.id);
  assert.equal(tree?.id, grand.id);
  assert.equal(tree?.nextTasks[0]?.id, parent.id);
  assert.equal(tree?.nextTasks[0]?.nextTasks[0]?.id, child.id);
  assert.equal((await getTaskContainingTree(U, grand.id))?.id, grand.id);
  assert.equal(await getTaskContainingTree(U, 'missing-task'), null);

  // 手工构造 A↔B 环：遍历须能终止
  const now = '2026-01-01T00:00:00.000Z';
  for (const [id, parentId] of [
    ['cycle-a', 'cycle-b'],
    ['cycle-b', 'cycle-a'],
  ] as const) {
    const dir = join(env.latticeHome, 'users', U, 'tasks', id);
    await mkdir(dir, { recursive: true });
    await writeJSON(getTaskMetaPath(U, id), {
      id,
      title: id,
      status: 'planning',
      parentTaskId: parentId,
      created: now,
    });
  }
  const cycleTree = await getTaskContainingTree(U, 'cycle-a');
  assert.ok(cycleTree);
  assert.equal(cycleTree?.id === 'cycle-a' || cycleTree?.id === 'cycle-b', true);
});
