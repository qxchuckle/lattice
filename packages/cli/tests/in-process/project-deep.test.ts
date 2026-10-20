import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  initDb,
  updateProjectMeta,
  updateProjectGroups,
  registerProjectWithIds,
  updateProjectPaths,
  upsertRelationFile,
  getProjectSpecDir,
} from '@qcqx/lattice-core';
import { registerProjectCommand } from '../../src/commands/project';
import {
  createCliEnv,
  runCli,
  seedProject,
  seedTask,
  parseCliJson,
  putFile,
  ID_A,
  ID_B,
  DERIVED,
  U,
  type CliEnv,
  type CliRunResult,
} from './helpers';

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

async function enrichA() {
  await initDb();
  const second = join(env.tmpRoot, 'projA-second');
  await mkdir(second, { recursive: true });
  await updateProjectPaths(ID_A, U, second);
  await updateProjectMeta(U, ID_A, {
    name: 'projA',
    description: '项目甲描述',
    tags: ['alpha', 'beta'],
    gitRemotes: ['github.com/acme/proj-a'],
    gitFirstCommit: 'abcdef1234567890abcdef1234567890abcdef12',
    gitDefaultBranch: 'main',
    packageNames: ['@acme/a'],
    monorepoPackages: ['pkg-a', 'pkg-b'],
  });
  await updateProjectGroups(U, ID_A, { set: ['团队/前端'] });
}

function initGitRepo(dir: string) {
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

test('project list：人类输出/分组/标签/has-git/orphaned/搜索/关系/分页/空态', async () => {
  await enrichA();
  const orphanPath = join(env.tmpRoot, 'orphan-missing');
  await registerProjectWithIds(U, ['legacy:9999000011112222'], orphanPath, DERIVED);
  await upsertRelationFile(U, {
    projectA: ID_A,
    projectB: ID_B,
    type: 'depends-on',
    description: '关系描述',
  });

  const human = await run(['project', 'list']);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /projA/);
  assert.match(human.stdout, /github\.com\/acme\/proj-a/);
  assert.match(human.stdout, /@acme\/a/);
  assert.match(human.stdout, /团队\/前端/);
  assert.match(human.stdout, /alpha, beta/);

  const byTag = await run(['project', 'list', '--tag', 'alpha', '--json']);
  assert.ok(JSON.stringify(parseCliJson(byTag)).includes('projA'));
  assert.ok(!JSON.stringify(parseCliJson(byTag)).includes('projB'));

  const byGroup = await run(['project', 'list', '--group', '团队', '--json']);
  assert.ok(JSON.stringify(parseCliJson(byGroup)).includes('projA'));

  const hasGit = await run(['project', 'list', '--has-git', '--json']);
  assert.ok(JSON.stringify(parseCliJson(hasGit)).includes('projA'));
  assert.ok(!JSON.stringify(parseCliJson(hasGit)).includes('projB'));

  const orphaned = await run(['project', 'list', '--orphaned', '--json']);
  const orphanText = JSON.stringify(parseCliJson(orphaned));
  assert.ok(orphanText.includes('9999000011112222'));
  assert.ok(!orphanText.includes('projA'));

  for (const args of [
    ['project', 'list', '--search', 'proj', '--json'],
    ['project', 'list', '--search', 'proj', '--keyword-only'],
    ['project', 'list', '--search', '不存在词zzq', '--keyword-only'],
  ]) {
    const r = await run(args);
    assert.equal(r.exitCode, 0, r.stderr);
  }
  const noMatch = await run(['project', 'list', '--search', '不存在词zzq', '--keyword-only']);
  assert.match(noMatch.stdout, /暂无符合条件的项目/);
  assert.match(noMatch.stdout, /去掉 --keyword-only/);

  const withRelJson = await run(['project', 'list', '--with-relations', '--json']);
  const relText = JSON.stringify(parseCliJson(withRelJson));
  assert.ok(relText.includes(ID_A));
  assert.ok(relText.includes('depends-on'));
  assert.ok(relText.includes('relations'));
  const withRelHuman = await run(['project', 'list', '--with-relations']);
  assert.match(withRelHuman.stdout, /→ projB\(depends-on\)/);

  const paged = await run(['project', 'list', '--page', '1', '--page-size', '1']);
  assert.equal(paged.exitCode, 0, paged.stderr);
  const full = await run(['project', 'list', '--json-full']);
  assert.equal(full.exitCode, 0, full.stderr);
});

test('project info：前缀解析/多路径/上下文/任务/关系/未知项目', async () => {
  await enrichA();
  const task = await seedTask('关联任务', [ID_A]);
  await upsertRelationFile(U, { projectA: ID_A, projectB: ID_B, type: 'related' });

  const prefix = await run(['project', 'info', ID_A.slice(0, 16), '--json']);
  assert.equal(prefix.exitCode, 0, prefix.stderr);
  const parsed = parseCliJson(prefix) as { meta: { id: string }; taskIds: string[] };
  assert.equal(parsed.meta.id, ID_A);
  assert.deepEqual(parsed.taskIds, [task.id]);

  const human = await run(['project', 'info', ID_A]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /路径（2 个）/);
  assert.match(human.stdout, /项目甲描述/);
  assert.match(human.stdout, /Git remote/);
  assert.match(human.stdout, /默认分支/);
  assert.match(human.stdout, /Monorepo 包：2 个/);
  assert.match(human.stdout, /分组：团队\/前端/);
  assert.match(human.stdout, /标签：alpha, beta/);
  assert.match(human.stdout, /关联任务：1 个/);
  assert.match(human.stdout, /项目关系：1 个/);

  const missing = await run(['project', 'info', 'legacy:0000000000000000', '--json']);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /未找到项目/);
});

test('project update / group：错误分支与 move/rename/remove 全路径', async () => {
  await initDb();
  await updateProjectGroups(U, ID_A, { set: ['团队/后端'] });

  const update = await run([
    'project',
    'update',
    ID_A,
    '--name',
    '改名项目',
    '--description',
    '新描述',
    '--tags',
    't1,t2',
    '--add-groups',
    '新组/子组',
    '--remove-groups',
    '不存在组',
  ]);
  assert.equal(update.exitCode, 0, update.stderr);
  assert.match(update.stdout, /已更新/);
  assert.match(update.stdout, /已新建分组/);
  assert.match(update.stdout, /未找到分组/);

  const unknown = await run(['project', 'update', 'legacy:0000000000000000', '--name', 'x']);
  assert.equal(unknown.exitCode, 0);
  assert.match(unknown.stdout, /未找到项目/);

  const created = await run(['project', 'group', 'create', ' ', '空组/甲', '空组/甲']);
  assert.equal(created.exitCode, 0, created.stderr);
  assert.match(created.stdout, /忽略空路径/);
  assert.match(created.stdout, /已创建分组/);
  assert.match(created.stdout, /已存在：空组\/甲/);
  const noCreate = await run(['project', 'group', 'create', '空组/甲']);
  assert.match(noCreate.stdout, /已存在/);

  const renameMissing = await run(['project', 'group', 'rename', '不存在', '新名', '-f']);
  assert.match(renameMissing.stdout, /未找到分组/);
  const rename = await run(['project', 'group', 'rename', '空组/甲', '乙', '-f']);
  assert.equal(rename.exitCode, 0, rename.stderr);
  assert.match(rename.stdout, /已重命名/);

  const both = await run(['project', 'group', 'move', '团队/后端', '空组', '--root', '-f']);
  assert.match(both.stdout, /不能同时指定/);
  const neither = await run(['project', 'group', 'move', '团队/后端']);
  assert.match(neither.stdout, /请指定目标父分组/);
  const moveMissing = await run(['project', 'group', 'move', '不存在', '--root', '-f']);
  assert.match(moveMissing.stdout, /未找到分组/);
  const parentMissing = await run(['project', 'group', 'move', '团队/后端', '不存在', '-f']);
  assert.match(parentMissing.stdout, /未找到目标父分组/);
  const moved = await run(['project', 'group', 'move', '团队/后端', '空组', '-f']);
  assert.equal(moved.exitCode, 0, moved.stderr);
  assert.match(moved.stdout, /已移动/);
  const toRoot = await run(['project', 'group', 'move', '团队/后端', '--root', '-f']);
  assert.equal(toRoot.exitCode, 0, toRoot.stderr);

  const rmMissing = await run(['project', 'group', 'remove', '不存在', '-f']);
  assert.match(rmMissing.stdout, /未找到分组/);
  const removed = await run(['project', 'group', 'remove', '空组', '-f']);
  assert.equal(removed.exitCode, 0, removed.stderr);
  assert.match(removed.stdout, /已删除/);

  // 空注册表的人类输出
  await run(['project', 'group', 'remove', '团队', '-f']);
  await run(['project', 'group', 'remove', '新组', '-f']);
  const emptyList = await run(['project', 'group', 'list']);
  assert.match(emptyList.stdout, /暂无分组/);
});

test('project where / register：精确/前缀/无命中/多路径/无 ID 源', async () => {
  const exact = await run(['project', 'where', join(env.tmpRoot, 'projA'), '--json']);
  const exactParsed = parseCliJson(exact) as { exact: { id: string } };
  assert.equal(exactParsed.exact.id, ID_A);
  const exactHuman = await run(['project', 'where', join(env.tmpRoot, 'projA')]);
  assert.match(exactHuman.stdout, /精确匹配/);

  const child = join(env.tmpRoot, 'projA', 'src', 'deep');
  const prefix = await run(['project', 'where', child, '--json']);
  const prefixParsed = parseCliJson(prefix) as { prefixMatches: { id: string }[] };
  assert.deepEqual(
    prefixParsed.prefixMatches.map((m) => m.id),
    [ID_A],
  );
  const prefixHuman = await run(['project', 'where', child]);
  assert.match(prefixHuman.stdout, /父目录前缀匹配/);
  assert.match(prefixHuman.stdout, /命中/);

  const noMatch = await run(['project', 'where', join(env.tmpRoot, 'nowhere')]);
  assert.match(noMatch.stdout, /未找到与该路径匹配/);

  const noId = await run(['project', 'register', join(env.tmpRoot, 'no-id-dir')]);
  assert.equal(noId.exitCode, 0);
  assert.match(noId.stdout, /未发现 ID 源/);
  const noIdJson = await run(['project', 'register', join(env.tmpRoot, 'no-id-dir'), '--json']);
  assert.equal('current' in (parseCliJson(noIdJson) as Record<string, unknown>[])[0], false);

  const nested = join(env.tmpRoot, 'repo-parent', 'repo-child');
  initGitRepo(join(env.tmpRoot, 'repo-parent'));
  initGitRepo(nested);
  const registered = await run(['project', 'register', nested, '--json']);
  assert.equal(registered.exitCode, 0, registered.stderr);
  const regHuman = await run(['project', 'register', nested]);
  assert.match(regHuman.stdout, /✓ git:/);
  assert.match(regHuman.stdout, /根目录/);
});

test('project relation：过滤/错误分支/ai 来源/人类输出', async () => {
  const empty = await run(['project', 'relation', 'list']);
  assert.match(empty.stdout, /暂无项目关系/);

  const badUser = await run(['project', 'relation', 'list', '--user', 'nobody', '--json']);
  assert.equal(badUser.exitCode, 1);
  assert.match(badUser.stderr, /用户不存在/);
  const both = await run(['project', 'relation', 'list', '--current-user', '--user', U, '--json']);
  assert.equal(both.exitCode, 1);
  assert.match(both.stderr, /不能同时使用/);
  const missingId = await run(['project', 'relation', 'list', 'legacy:0000000000000000', '--json']);
  assert.equal(missingId.exitCode, 1);
  assert.match(missingId.stderr, /未找到项目/);

  const noA = await run(['project', 'relation', 'add', 'legacy:0000000000000000', ID_A]);
  assert.match(noA.stdout, /未找到项目 A/);
  const noB = await run(['project', 'relation', 'add', ID_A, 'legacy:0000000000000000']);
  assert.match(noB.stdout, /未找到项目 B/);
  const self = await run(['project', 'relation', 'add', ID_A, ID_A]);
  assert.match(self.stdout, /不能创建项目与自身的关系/);

  const add = await run([
    'project',
    'relation',
    'add',
    ID_A,
    ID_B,
    '--type',
    'related',
    '--description',
    'AI 关系',
    '--from-task',
    'task-1',
    '--ai-inferred',
  ]);
  assert.equal(add.exitCode, 0, add.stderr);
  assert.match(add.stdout, /已创建关系/);
  const byId = await run(['project', 'relation', 'list', ID_A]);
  assert.equal(byId.exitCode, 0, byId.stderr);
  assert.match(byId.stdout, /类型：related/);
  assert.match(byId.stdout, /来源：ai-inferred \/ task-1/);
  const updated = await run([
    'project',
    'relation',
    'add',
    ID_A,
    ID_B,
    '--description',
    '更新后的关系',
  ]);
  assert.match(updated.stdout, /已更新关系/);

  const byIdUser = await run(['project', 'relation', 'list', ID_A, '--user', U]);
  assert.equal(byIdUser.exitCode, 0, byIdUser.stderr);
  const allUser = await run(['project', 'relation', 'list', '--current-user']);
  assert.equal(allUser.exitCode, 0, allUser.stderr);

  const rmMissing = await run(['project', 'relation', 'remove', 'rel-missing', '-f']);
  assert.match(rmMissing.stdout, /未找到关系/);
});

test('project profile：check/done/show/path/brief/tags 全链路与错误分支', async () => {
  await enrichA();
  const task = await seedTask('画像任务', [ID_A]);
  await upsertRelationFile(U, { projectA: ID_A, projectB: ID_B, type: 'related' });
  await putFile(
    join(getProjectSpecDir(U, ID_A), 'guide.md'),
    '---\nid: spec-proj-a\ntitle: 项目规范\ndescription: 规范摘要\n---\n\n# 规范\n',
  );

  const checkMissing = await run([
    'project',
    'profile',
    'check',
    '--project',
    'legacy:0000000000000000',
    '--json',
  ]);
  assert.equal(checkMissing.exitCode, 1);
  const checkOne = await run(['project', 'profile', 'check', '--project', ID_A, '--json']);
  assert.equal(checkOne.exitCode, 0, checkOne.stderr);
  const checkOneHuman = await run(['project', 'profile', 'check', '--project', ID_A]);
  assert.match(checkOneHuman.stdout, /projA/);
  const checkAll = await run(['project', 'profile', 'check', '--json']);
  assert.equal(checkAll.exitCode, 0, checkAll.stderr);
  const checkAllFull = await run(['project', 'profile', 'check', '--json-full']);
  assert.equal(checkAllFull.exitCode, 0, checkAllFull.stderr);
  const checkAllHuman = await run(['project', 'profile', 'check']);
  assert.match(checkAllHuman.stdout, /共 \d+ 个项目/);

  const doneMissing = await run(['project', 'profile', 'done', 'legacy:0000000000000000']);
  assert.match(doneMissing.stdout, /未找到项目/);
  const done = await run(['project', 'profile', 'done', ID_A]);
  assert.equal(done.exitCode, 0, done.stderr);
  assert.match(done.stdout, /画像缓存已更新/);

  const tagsSet = await run(['project', 'profile', 'tags', 'set', ID_A, '--tags', 'a,b,a']);
  assert.match(tagsSet.stdout, /标签已设置：a, b/);
  const tagsAdd = await run(['project', 'profile', 'tags', 'add', ID_A, '--tags', 'c']);
  assert.match(tagsAdd.stdout, /a, b, c/);
  const tagsRemove = await run(['project', 'profile', 'tags', 'remove', ID_A, '--tags', 'a,b,c']);
  assert.match(tagsRemove.stdout, /剩余：无/);
  const tagsShow = await run(['project', 'profile', 'tags', 'show', ID_A]);
  assert.match(tagsShow.stdout, /标签：无/);
  for (const sub of ['show', 'brief']) {
    const missing = await run(['project', 'profile', sub, 'legacy:0000000000000000', '--json']);
    assert.equal(missing.exitCode, 1, sub);
  }
  const pathMissing = await run(['project', 'profile', 'path', 'legacy:0000000000000000']);
  assert.match(pathMissing.stdout, /未找到项目/);
  for (const sub of ['set', 'add', 'remove']) {
    const missing = await run([
      'project',
      'profile',
      'tags',
      sub,
      'legacy:0000000000000000',
      '--tags',
      'x',
    ]);
    assert.equal(missing.exitCode, 0, sub);
    assert.match(missing.stdout, /未找到项目/);
  }
  const tagsShowMissing = await run([
    'project',
    'profile',
    'tags',
    'show',
    'legacy:0000000000000000',
    '--json',
  ]);
  assert.equal(tagsShowMissing.exitCode, 1);
  assert.match(tagsShowMissing.stderr, /未找到项目/);

  const path = await run(['project', 'profile', 'path', ID_A]);
  assert.match(path.stdout, /\/profile$/);
  await putFile(join(path.stdout.trim(), 'summary.md'), '# 画像摘要\n');
  const showHuman = await run(['project', 'profile', 'show', ID_A]);
  assert.match(showHuman.stdout, /项目画像/);
  assert.match(showHuman.stdout, /缓存时间/);
  assert.match(showHuman.stdout, /画像摘要/);
  const showJson = await run(['project', 'profile', 'show', ID_A, '--json']);
  assert.equal(showJson.exitCode, 0, showJson.stderr);

  const briefHuman = await run(['project', 'profile', 'brief', ID_A]);
  assert.equal(briefHuman.exitCode, 0, briefHuman.stderr);
  assert.match(briefHuman.stdout, /项目：/);
  assert.match(briefHuman.stdout, /项目级 Spec（1）/);
  assert.match(briefHuman.stdout, /项目规范/);
  assert.match(briefHuman.stdout, /画像任务/);
  assert.match(briefHuman.stdout, /项目关系/);
  assert.ok(briefHuman.stdout.includes(task.id));
  const briefJson = await run(['project', 'profile', 'brief', ID_A, '--json']);
  assert.equal(briefJson.exitCode, 0, briefJson.stderr);
});
