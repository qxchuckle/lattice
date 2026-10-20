import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addProfileTags,
  buildProfileSection,
  checkProfiles,
  checkSingleProfile,
  collectProfileInputs,
  computeInputsHash,
  getProfileBrief,
  getProfileShow,
  markProfileDone,
  readProfileCache,
  readProfileSummary,
  readProfileTags,
  removeProfileTags,
  writeProfileSummary,
  writeProfileTags,
} from '../src/project/profile';
import {
  closeDb,
  createTask,
  getProjectMeta,
  initDb,
  registerProjectWithIds,
  updateProjectMeta,
} from '../src/index';
import { upsertRelation } from '../src/project/relation';
import {
  getProjectProfileCachePath,
  getProjectProfileSummaryPath,
  getProjectSpecDir,
} from '../src/paths';
import { getTasksForProject } from '../src/db';
import { writeJSON } from '../src/paths';
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
  } catch {
    // ignore
  }
  await env.cleanup();
});

async function project(name = 'prof', options: { git?: boolean; withPath?: boolean } = {}) {
  const dir = join(env.tmpRoot, name);
  if (options.git) {
    await createFakeProject(dir);
  } else {
    await mkdir(dir, { recursive: true });
  }
  const id = `legacy:${name.padEnd(16, '0').slice(0, 16)}`;
  await registerProjectWithIds(
    U,
    [id],
    dir,
    options.git
      ? { ...DERIVED, gitFirstCommit: 'sha1', gitRemotes: [], gitDefaultBranch: 'main' }
      : DERIVED,
  );
  if (options.withPath === false) {
    await updateProjectMeta(U, id, { localPaths: [] });
  }
  return { id, dir };
}

async function writeSpec(projectId: string, fileName: string, title: string) {
  const dir = getProjectSpecDir(U, projectId);
  await putFile(
    join(dir, fileName),
    `---\nid: spec-${Math.random().toString(16).slice(2, 10)}\ntitle: ${title}\n---\n\nbody\n`,
  );
}

test('profile tags/summary：读写、去重、移除', async () => {
  const { id } = await project();
  assert.deepEqual(await readProfileTags(U, id), []);
  assert.equal(await readProfileSummary(U, id), null);

  await writeProfileTags(U, id, ['a', 'b']);
  assert.deepEqual(await readProfileTags(U, id), ['a', 'b']);
  assert.deepEqual(await addProfileTags(U, id, ['b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(await removeProfileTags(U, id, ['a', 'x']), ['b', 'c']);

  await writeProfileSummary(U, id, '# 画像\n\n摘要');
  assert.equal(await readProfileSummary(U, id), '# 画像\n\n摘要');
});

test('computeInputsHash：确定性与输入敏感', () => {
  const base = {
    git: null,
    taskIds: ['t1'],
    taskTitles: ['T1'],
    specFileNames: ['a.md'],
    specTitles: ['A'],
    relationCount: 0,
    relationProjectIds: [] as string[],
    projectMetaUpdated: '2026-01-01T00:00:00.000Z',
  };
  const h1 = computeInputsHash(base);
  assert.equal(computeInputsHash(base), h1);
  assert.match(h1, /^sha256:[0-9a-f]{16}$/);
  assert.notEqual(computeInputsHash({ ...base, taskIds: ['t2'] }), h1);
  assert.notEqual(computeInputsHash({ ...base, git: { headSha: 'abc', commitCount: 1 } }), h1);
  assert.notEqual(computeInputsHash({ ...base, relationCount: 1 }), h1);
});

test('collectProfileInputs：git/任务/spec/关系/元数据', async () => {
  const { id } = await project('collect', { git: true });
  await updateProjectMeta(U, id, { description: 'collect inputs' });
  const task = await createTask(U, '画像任务', { projects: [id] });
  await writeSpec(id, 'p.md', '项目规范');
  const other = await project('collect-other');
  await upsertRelation(U, { projectA: id, projectB: other.id, type: 'related' });

  const inputs = await collectProfileInputs(U, id, id);
  assert.ok(inputs.git, 'git 仓库应被识别');
  assert.match(inputs.git?.headSha ?? '', /^[0-9a-f]{40}$/);
  assert.equal(inputs.git?.commitCount, 1);
  assert.deepEqual(inputs.taskIds, [task.id]);
  assert.deepEqual(inputs.taskTitles, ['画像任务']);
  assert.deepEqual(inputs.specFileNames, ['p.md']);
  assert.deepEqual(inputs.specTitles, ['项目规范']);
  assert.equal(inputs.relationCount, 1);
  assert.deepEqual(inputs.relationProjectIds, [other.id]);
  assert.ok(inputs.projectMetaUpdated);

  // 无 localPath → git null
  const noPath = await project('collect-nopath', { withPath: false });
  const noGit = await collectProfileInputs(U, noPath.id, noPath.id);
  assert.equal(noGit.git, null);
});

test('checkProfiles/checkSingleProfile：no-profile → fresh → stale（任务/元数据）', async () => {
  const { id } = await project('check');
  const noProfile = await checkProfiles(U);
  assert.ok(noProfile.noProfile.some((p) => p.id === id));
  assert.equal((await checkSingleProfile(U, id, id, 'check')).status, 'no-profile');

  await writeProfileSummary(U, id, 'summary');
  await markProfileDone(U, id, id);
  assert.ok(await readProfileCache(U, id));
  assert.ok((await getProjectMeta(U, id))?.profileUpdated);

  await checkProfiles(U);
  assert.equal((await checkSingleProfile(U, id, id, 'check')).status, 'fresh');

  // 新任务 → 新增任务
  await createTask(U, '新任务', { projects: [id] });
  const single = await checkSingleProfile(U, id, id, 'check');
  assert.equal(single.status, 'stale');
  assert.ok(single.reasons.some((r) => r.includes('新增任务')));

  await markProfileDone(U, id, id);
  await updateProjectMeta(U, id, { description: '改描述' });
  const metaStale = await checkProfiles(U);
  assert.ok(
    metaStale.stale.some((p) => p.id === id && p.reasons.some((r) => r.includes('项目元数据更新'))),
  );

  // 删除 summary → no-profile
  const summaryPath = getProjectProfileSummaryPath(U, id);
  const { rm } = await import('node:fs/promises');
  await rm(summaryPath);
  assert.equal((await checkSingleProfile(U, id, id, 'check')).status, 'no-profile');
});

test('checkProfiles：schema 过期 / spec 标题变化 / 关系变化 / git 提交变化', async () => {
  const { id, dir } = await project('stale', { git: true });
  await writeProfileSummary(U, id, 's');
  await writeSpec(id, 'p.md', '标题一');
  await markProfileDone(U, id, id);

  // schema 版本过期
  const cachePath = getProjectProfileCachePath(U, id);
  const cache = await readProfileCache(U, id);
  await writeJSON(cachePath, { ...cache, schemaVersion: 999 });
  assert.equal((await checkSingleProfile(U, id, id, 'stale')).status, 'stale');
  await markProfileDone(U, id, id);

  // spec 标题变化
  await writeSpec(id, 'p.md', '标题二');
  const specStale = await checkSingleProfile(U, id, id, 'stale');
  assert.ok(specStale.reasons.some((r) => r.includes('spec 标题变化')));
  await markProfileDone(U, id, id);

  // 关系变化
  const other = await project('stale-other');
  await upsertRelation(U, { projectA: id, projectB: other.id, type: 'related' });
  const relStale = await checkSingleProfile(U, id, id, 'stale');
  assert.ok(relStale.reasons.some((r) => r.includes('项目关系变化')));
  await markProfileDone(U, id, id);

  // git 新提交
  const { execFileSync } = await import('node:child_process');
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'next'],
    { cwd: dir },
  );
  const gitStale = await checkSingleProfile(U, id, id, 'stale');
  assert.ok(gitStale.reasons.some((r) => r.includes('新提交 1 条')));
});

test('checkProfiles：旧缓存 git=null → 新增 git 仓库；数据库无项目时为空', async () => {
  const { id } = await project('newgit', { git: true });
  await writeProfileSummary(U, id, 's');
  const cachePath = getProjectProfileCachePath(U, id);
  await writeJSON(cachePath, {
    generatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
    inputsHash: 'old',
    detail: {
      git: null,
      tasks: { count: 0, idsSnapshot: [] },
      specs: { count: 0, titlesSnapshot: [] },
      relations: { count: 0 },
      projectMetaUpdated: null,
    },
  });
  const result = await checkProfiles(U);
  assert.ok(result.stale.some((p) => p.id === id && p.reasons.includes('新增 git 仓库')));
});

test('getProfileShow/buildProfileSection/getProfileBrief', async () => {
  const { id } = await project('brief');
  const emptyShow = await getProfileShow(U, id);
  assert.equal(emptyShow.summary, null);
  assert.deepEqual(emptyShow.tags, []);
  assert.equal(await buildProfileSection(U, id), null);

  await writeProfileSummary(U, id, '正文');
  await writeProfileTags(U, id, ['tag1']);
  const show = await getProfileShow(U, id);
  assert.equal(show.summary, '正文');
  assert.deepEqual(show.tags, ['tag1']);
  assert.match(show.summaryPath, /summary\.md$/);
  assert.match(show.tagsPath, /tags\.json$/);

  const section = await buildProfileSection(U, id);
  assert.match(section ?? '', /## 项目画像/);
  assert.match(section ?? '', /标签：tag1/);
  assert.match(section ?? '', /正文/);

  // 无 tags 的画像段
  await writeProfileTags(U, id, []);
  assert.ok(!(await buildProfileSection(U, id))?.includes('标签：'));

  const task = await createTask(U, '简报任务', { projects: [id] });
  await writeSpec(id, 'brief.md', '简报规范');
  const other = await project('brief-other');
  await upsertRelation(U, {
    projectA: id,
    projectB: other.id,
    type: 'related',
    description: '关系描述',
  });

  const brief = await getProfileBrief(U, id, id);
  assert.ok(brief);
  assert.equal(brief.project.id, id);
  assert.equal(brief.summary, '正文');
  assert.deepEqual(brief.tags, []);
  assert.ok(brief.specs.some((s) => s.fileName === 'brief.md'));
  assert.ok(brief.tasks.some((t) => t.id === task.id));
  assert.ok(
    brief.relations.some((r) => r.projectName === 'brief-other' && r.description === '关系描述'),
  );

  assert.equal(await getProfileBrief(U, 'legacy:missing', 'legacy:missing'), null);
});

test('markProfileDone：无项目元数据时不报错（空输入哈希）', async () => {
  const dir = join(env.tmpRoot, 'nometa');
  await mkdir(dir, { recursive: true });
  await markProfileDone(U, 'legacy:nometa00000000', 'legacy:nometa00000000');
  assert.ok(await readProfileCache(U, 'legacy:nometa00000000'));
  assert.ok(await getTasksForProject('legacy:nometa00000000'));
});
