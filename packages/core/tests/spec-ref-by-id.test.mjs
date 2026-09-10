import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  initDb,
  closeDb,
  registerProjectWithIds,
  findProjectDirName,
  getProjectSpecDir,
  findSpecById,
  addSpecRefs,
  getTaskMeta,
} from '../dist/index.mjs';
import { createTempLatticeHome, putFile } from './helpers.mjs';

// ref-spec 按 spec ID 关联能力：
// 1. findSpecById 跨 global/user/全部项目按 frontmatter.id 精确查找（含跨项目的项目级 spec）
// 2. project 级命中携带归属 projectId；user/global 级不带
// 3. addSpecRefs 接受 spec ID 输入并把 projectId 落进 referencedSpecs（供 enrichment 精确定位）
// 4. ID 未命中报错、重复 ID 跳过

const U = 't';
const ID_A = 'legacy:aaaaaaaaaaaaaaaa';
const ID_B = 'legacy:bbbbbbbbbbbbbbbb';
const TASK = '2026-09-10-refspec-id';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env;

async function registerProject(ids, localPath) {
  await putFile(join(localPath, '.keep'), '');
  await registerProjectWithIds(U, ids, localPath, DERIVED);
}

async function writeProjectSpec(primaryId, fileName, specId, title) {
  const dirName = await findProjectDirName(U, primaryId);
  const specDir = getProjectSpecDir(U, dirName);
  await putFile(join(specDir, fileName), `---\nid: ${specId}\ntitle: ${title}\n---\n# ${title}\n`);
}

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
  );
  initDb();

  await registerProject([ID_A], join(env.tmpRoot, 'projA'));
  await registerProject([ID_B], join(env.tmpRoot, 'projB'));
  await writeProjectSpec(ID_A, 'spec-a.md', 'spec-aaaaaaaa', 'A 项目级规范');
  await writeProjectSpec(ID_B, 'spec-b.md', 'spec-bbbbbbbb', 'B 项目级规范');

  // 用户级 spec
  await putFile(
    join(env.latticeHome, 'users', U, 'spec', 'spec-u.md'),
    '---\nid: spec-cccccccc\ntitle: 用户级规范\n---\n# U\n',
  );

  // 最小任务（关联项目 A，模拟 cwd 在 A）
  await putFile(
    join(env.latticeHome, 'users', U, 'tasks', TASK, 'task.json'),
    JSON.stringify({
      id: TASK,
      title: 'ref-spec id 测试',
      status: 'in-progress',
      projects: [ID_A],
    }),
  );
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

test('findSpecById：跨项目命中 B 的项目级 spec，携带归属 projectId', async () => {
  const m = await findSpecById(U, 'spec-bbbbbbbb');
  assert.ok(m, '应命中 B 的项目级 spec（不受 cwd 项目 A 限制）');
  assert.equal(m.scope, 'project');
  assert.equal(m.projectId, ID_B, 'project 级命中须带归属项目 B');
  assert.equal(m.spec.relativePath, 'spec-b.md');
});

test('findSpecById：命中本项目 A 的项目级 spec', async () => {
  const m = await findSpecById(U, 'spec-aaaaaaaa');
  assert.ok(m);
  assert.equal(m.scope, 'project');
  assert.equal(m.projectId, ID_A);
});

test('findSpecById：命中用户级 spec，不带 projectId', async () => {
  const m = await findSpecById(U, 'spec-cccccccc');
  assert.ok(m);
  assert.equal(m.scope, 'user');
  assert.equal(m.projectId, undefined, 'user 级不应带 projectId');
});

test('findSpecById：不存在的 ID 返回 null', async () => {
  const m = await findSpecById(U, 'spec-deadbeef');
  assert.equal(m, null);
});

test('addSpecRefs：按 spec ID 关联跨项目的项目级 spec，referencedSpecs 落 projectId', async () => {
  const res = await addSpecRefs(U, TASK, ['spec-bbbbbbbb'], { projectId: ID_A });
  assert.deepEqual(res.added, ['spec-bbbbbbbb']);
  assert.equal(res.errors.length, 0);

  const meta = await getTaskMeta(U, TASK);
  const ref = meta.referencedSpecs.find((r) => r.id === 'spec-bbbbbbbb');
  assert.ok(ref, '应写入引用');
  assert.equal(ref.scope, 'project');
  assert.equal(ref.projectId, ID_B, '跨项目引用须记录归属项目 B（非 cwd 的 A）');
  assert.equal(ref.relativePath, 'spec-b.md');
});

test('addSpecRefs：用户级 ID 关联不落 projectId；不存在的 ID 进 errors', async () => {
  const res = await addSpecRefs(U, TASK, ['spec-cccccccc', 'spec-deadbeef'], { projectId: ID_A });
  assert.deepEqual(res.added, ['spec-cccccccc']);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /未找到 spec：spec-deadbeef/);

  const meta = await getTaskMeta(U, TASK);
  const ref = meta.referencedSpecs.find((r) => r.id === 'spec-cccccccc');
  assert.equal(ref.scope, 'user');
  assert.equal(ref.projectId, undefined);
});

test('addSpecRefs：重复按同一 ID 关联 → skipped，不重复写入', async () => {
  await addSpecRefs(U, TASK, ['spec-bbbbbbbb'], { projectId: ID_A });
  const res2 = await addSpecRefs(U, TASK, ['spec-bbbbbbbb'], { projectId: ID_A });
  assert.deepEqual(res2.skipped, ['spec-bbbbbbbb']);
  assert.deepEqual(res2.added, []);

  const meta = await getTaskMeta(U, TASK);
  const count = meta.referencedSpecs.filter((r) => r.id === 'spec-bbbbbbbb').length;
  assert.equal(count, 1, '同一 spec 只应有一条引用');
});
