import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  initDb,
  closeDb,
  registerProjectWithIds,
  findProjectDirName,
  getProjectSpecDir,
  migrateSpecs,
} from '../dist/index.mjs';
import { createTempLatticeHome, putFile } from './helpers.mjs';

// spec migrate 全项目视角（对齐 lint --all / suggest-description，修 cli-command-surface §跨项目全量视角盲区）：
// 1. scope=project / all 的 project 级覆盖全部已注册项目，不止 cwd 项目（修复前只扫 cwd 项目）
// 2. 结果条目携带 level / projectId / projectName 归属（供 CLI 标签展示与跨项目确认闸判定）
// 3. 跨项目 backfill 真实落盘、幂等；scope=user 不触达 project 级（不再依赖 projectId 参数）

const U = 't';
const ID_A = 'legacy:aaaaaaaaaaaaaaaa';
const ID_B = 'legacy:bbbbbbbbbbbbbbbb';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };
// updated 设未来，避免 mtime>updated 的 staleness 干扰（只考察 id backfill）
const FUTURE = "updated: '2030-01-01T00:00:00.000Z'";

let env;

async function registerProject(ids, localPath) {
  await putFile(join(localPath, '.keep'), '');
  await registerProjectWithIds(U, ids, localPath, DERIVED);
}

async function projectSpecPath(primaryId, fileName) {
  const dirName = await findProjectDirName(U, primaryId);
  return join(getProjectSpecDir(U, dirName), fileName);
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
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

test('migrateSpecs：project 级覆盖全部已注册项目（不止 cwd），条目带归属', async () => {
  const aPath = await projectSpecPath(ID_A, 'spec-a.md');
  const bPath = await projectSpecPath(ID_B, 'spec-b.md');
  await putFile(aPath, `---\ntitle: A\n${FUTURE}\n---\n# A\n`);
  await putFile(bPath, `---\ntitle: B\n${FUTURE}\n---\n# B\n`);

  // dry-run 不写盘，但 migrated 应同时含 A 与 B（全项目视角）
  const preview = await migrateSpecs({ scope: 'project', dryRun: true });
  const byProject = Object.fromEntries(preview.migrated.map((m) => [m.projectId, m]));
  assert.ok(byProject[ID_A], '应扫到 A 项目的 spec');
  assert.ok(byProject[ID_B], '应扫到 B 项目的 spec（cwd 之外，修复前扫不到）');
  assert.equal(byProject[ID_B].level, 'project');
  assert.ok(byProject[ID_B].projectName, 'project 级须带 projectName');
  assert.ok(byProject[ID_A].addedFields.includes('id'), 'A 缺 id 应补');
  assert.ok(byProject[ID_B].addedFields.includes('id'), 'B 缺 id 应补');
});

test('migrateSpecs：真实写入跨项目 spec 的 id（写路径 + 幂等）', async () => {
  const bPath = await projectSpecPath(ID_B, 'spec-b.md');
  await putFile(bPath, `---\ntitle: B\n${FUTURE}\n---\n# B\n`);

  const res = await migrateSpecs({ scope: 'project' });
  assert.equal(res.migrated.length, 1);
  assert.equal(res.migrated[0].projectId, ID_B);

  const after = await readFile(bPath, 'utf-8');
  assert.match(after, /^id: spec-[0-9a-z]{8}/m, 'B 应被写入合法 id');

  // 幂等：补齐后再跑，B 已合规 → 无 migrated、进 skipped
  const res2 = await migrateSpecs({ scope: 'project', dryRun: true });
  assert.equal(res2.migrated.length, 0, '补齐后不应再有 migrated');
  assert.ok(res2.skipped.includes(bPath), 'B 应进 skipped');
});

test('migrateSpecs：scope=user 只含 user 级，不触达 project（不依赖 projectId 参数）', async () => {
  const bPath = await projectSpecPath(ID_B, 'spec-b.md');
  await putFile(bPath, `---\ntitle: B\n${FUTURE}\n---\n# B\n`);
  await putFile(
    join(env.latticeHome, 'users', U, 'spec', 'spec-u.md'),
    `---\ntitle: U\n${FUTURE}\n---\n# U\n`,
  );

  const res = await migrateSpecs({ scope: 'user', dryRun: true });
  assert.ok(res.migrated.length > 0, 'user 级缺 id 应进 migrated');
  assert.ok(
    res.migrated.every((m) => m.level === 'user'),
    'scope=user 只应含 user 级',
  );
  assert.ok(!res.migrated.some((m) => m.projectId === ID_B), 'scope=user 不应触达 B 的项目级 spec');
});
