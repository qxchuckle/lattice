import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  closeDb,
  createTask,
  initDb,
  registerProjectWithIds,
  runStartupSelfCheck,
  setLatticeMeta,
  upsertFtsEntry,
  upsertProject,
} from '../src/index';
import { linkTaskProject } from '../src/db';
import { getTaskPrdPath } from '../src/paths';
import { createTempLatticeHome, putFile } from './helpers';

const U = 't';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

async function writeConfig(username = U) {
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username, version: 1 }),
  );
}

function projectRow(id: string, username = U) {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id,
    name: id,
    local_path: '[]',
    description: null,
    git_remote: null,
    git_first_commit: null,
    git_default_branch: null,
    package_names: null,
    monorepo_packages: null,
    groups: null,
    tags: null,
    username,
    created: now,
    updated: null,
  };
}

function indexed(filePath: string) {
  upsertFtsEntry({
    file_path: filePath,
    title: filePath,
    content: 'x',
    tags: '',
    source_type: 'spec',
    username: U,
    project_id: '',
  });
}

test('startup-self-check：未初始化直接返回零结果', async () => {
  assert.deepEqual(await runStartupSelfCheck(), {
    removedProjects: 0,
    removedTaskLinks: 0,
    removedSearchDocs: 0,
  });
});

test('startup-self-check：孤儿项目/任务关联/索引文档清理与 rag 标记', async () => {
  await writeConfig();
  await initDb();

  // 真实项目（磁盘 project.json 存在）应保留
  const realDir = join(env.tmpRoot, 'real-project');
  await mkdir(realDir, { recursive: true });
  const realId = 'legacy:1111222233334444';
  await registerProjectWithIds(U, [realId], realDir, DERIVED);

  // 孤儿项目：DB 有行、磁盘无 project.json
  upsertProject(projectRow('legacy:orphan00000000'));

  // 任务关联：真实任务保留；幽灵任务删除；孤儿项目的关联直接跳过
  const realTask = await createTask(U, '真实任务', { projects: [realId] });
  linkTaskProject('ghost-task', realId);
  linkTaskProject('task-of-orphan', 'legacy:orphan00000000');

  // 索引文档：绝对路径（存在/缺失）
  const existingAbs = join(env.tmpRoot, 'existing.md');
  await putFile(existingAbs, '# existing');
  const missingAbs = join(env.tmpRoot, 'missing.md');
  indexed(existingAbs);
  indexed(missingAbs);

  // 相对路径：task prd（存在/缺失/未知用户）
  const prd = getTaskPrdPath(U, realTask.id);
  await putFile(prd, '# prd');
  indexed(`user/${U}/task/${realTask.id}/prd.md`);
  indexed(`user/${U}/task/ghost-task/prd.md`);
  indexed('user/unknown/task/ghost-task/prd.md');

  // 相对路径：project.md（存在/缺失）
  indexed(`user/${U}/project/${realId}/project.md`);
  indexed(`user/${U}/project/legacy:nope000000000000/project.md`);

  // 未知格式原样保留
  indexed('random/path/file.md');

  setLatticeMeta('rag_rebuild_needed', 'true');

  const result = await runStartupSelfCheck();
  assert.equal(result.removedProjects, 1);
  assert.equal(result.removedTaskLinks, 1);
  assert.equal(result.removedSearchDocs, 4);
  assert.equal(result.ragRebuildNeeded, true);

  // 二次自检幂等
  const again = await runStartupSelfCheck();
  assert.equal(again.removedProjects, 0);
  assert.equal(again.removedTaskLinks, 0);
  assert.equal(again.removedSearchDocs, 0);
  assert.equal(again.ragRebuildNeeded, true);
});
