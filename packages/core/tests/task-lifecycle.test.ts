import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  initDb,
  closeDb,
  registerProjectWithIds,
  createTask,
  updateTask,
  deleteTask,
  resolveTaskById,
  getTaskPrdPath,
  addCheckpoint,
  listCheckpoints,
  readProgress,
  listTrashItems,
  restoreFromTrash,
  linkTaskProject,
  getTaskLineage,
} from '../src/index';
import { createTempLatticeHome, putFile } from './helpers';

// 任务生命周期 L2 集成（此前 core 层任务域零覆盖）：
// 建 → 改 → 检查点 → 删（入垃圾桶）→ 恢复（含项目关联回灌）→ 父任务链路 → 边界

const U = 't';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };
const ID_A = 'legacy:cccccccccccccccc';

let env;
let projectDir;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
  );
  await initDb();
  projectDir = join(env.tmpRoot, 'projA');
  await putFile(join(projectDir, '.keep'), '');
  await registerProjectWithIds(U, [ID_A], projectDir, DERIVED);
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

test('createTask：ID 形态 / task.json 与 prd.md 落盘 / 项目关联', async () => {
  const task = await createTask(U, 'L2 生命周期任务', { projects: [ID_A] });
  assert.match(task.id, /^\d{4}-\d{2}-\d{2}-[0-9a-z]{4}-/);
  assert.equal(task.status, 'planning');
  assert.deepEqual(task.projects, [ID_A]);

  const taskJson = join(env.latticeHome, 'users', U, 'tasks', task.id, 'task.json');
  assert.ok(existsSync(taskJson), 'task.json 应落盘');
  assert.ok(existsSync(getTaskPrdPath(U, task.id)), 'prd.md 应落盘');

  const resolved = await resolveTaskById(U, task.id);
  assert.equal(resolved?.id, task.id);
  assert.equal(resolved?.title, 'L2 生命周期任务');
});

test('updateTask：状态与标题流转持久化；未知任务返回 null', async () => {
  const task = await createTask(U, '状态流转', {});
  const started = await updateTask(U, task.id, { status: 'in_progress' });
  assert.equal(started?.status, 'in_progress');

  const done = await updateTask(U, task.id, { status: 'completed', title: '状态流转（改名）' });
  assert.equal(done?.status, 'completed');

  const again = await resolveTaskById(U, task.id);
  assert.equal(again?.status, 'completed');
  assert.equal(again?.title, '状态流转（改名）');

  const missing = await updateTask(U, '2020-01-01-0000-ghost', { status: 'completed' });
  assert.equal(missing, null);
});

test('checkpoint：多类型记录 / 过滤读回 / 非法类型拒绝', async () => {
  const task = await createTask(U, '检查点任务', {});
  const cp1 = await addCheckpoint(U, task.id, { type: 'note', title: '起手', message: '开始' });
  assert.match(cp1.id, /^cp_[0-9a-f]{8}$/);
  const cp2 = await addCheckpoint(U, task.id, {
    type: 'decision',
    title: '选型',
    message: 'vitest',
  });
  assert.equal(cp2.type, 'decision');

  const all = await listCheckpoints(U, task.id);
  assert.equal(all.length, 2);

  const notes = await listCheckpoints(U, task.id, { type: 'note' });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, '起手');

  const progress = await readProgress(U, task.id);
  assert.equal(progress.entries.length, 2);

  await assert.rejects(
    () => addCheckpoint(U, task.id, { type: 'invalid-type', title: 'x', message: 'y' }),
    /无效的检查点类型/,
  );
});

test('deleteTask → 垃圾桶 → restoreFromTrash：任务与项目关联恢复', async () => {
  const task = await createTask(U, '待删除', { projects: [ID_A] });

  await deleteTask(U, task.id);
  assert.equal(await resolveTaskById(U, task.id), null);
  assert.ok(
    !existsSync(join(env.latticeHome, 'users', U, 'tasks', task.id, 'task.json')),
    '删除后 task.json 应移除',
  );

  const items = await listTrashItems(U);
  const entry = items.find((i) => i.type === 'task' && i.title === '待删除');
  assert.ok(entry, '垃圾桶应有该任务');
  assert.deepEqual(entry.restoreHints?.projects, [ID_A], 'restoreHints 应记录项目关联');

  const restored = await restoreFromTrash(entry.id);
  assert.equal(restored.type, 'task');
  const back = await resolveTaskById(U, task.id);
  assert.ok(back, '恢复后任务可解析');
  assert.ok(
    existsSync(join(env.latticeHome, 'users', U, 'tasks', task.id, 'task.json')),
    '恢复后 task.json 应回位',
  );

  // 与 CLI trash restore 同款路径：按 restoreHints 回灌项目关联
  linkTaskProject(task.id, ID_A);
  const relinked = await resolveTaskById(U, task.id);
  assert.deepEqual(relinked?.projects, [ID_A]);
});

test('父任务链路与删除边界：getTaskLineage 可回读；有子任务禁止删除', async () => {
  const parent = await createTask(U, '父任务', {});
  const child = await createTask(U, '子任务', { parentTaskId: parent.id });
  assert.equal(child.parentTaskId, parent.id);

  const lineage = await getTaskLineage(U, child.id);
  assert.ok(lineage, '应返回链路');
  assert.ok(
    lineage.some((t) => t.id === parent.id),
    '链路应包含父任务',
  );
  assert.equal(lineage[lineage.length - 1].id, child.id, '链路末位应为当前任务');

  await assert.rejects(() => deleteTask(U, parent.id), /仍有子任务/);
});
