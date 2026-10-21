import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { getGlobalSpecDir, getProjectSpecDir, getUserSpecDir } from '@qcqx/lattice-core';
import { registerSpecCommand } from '../../src/commands/spec';
import { clearCurrentProjectCache } from '../../src/utils/current-project';
import {
  createCliEnv,
  runCli,
  seedProject,
  parseCliJson,
  putFile,
  ID_A,
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
  process.chdir(env.tmpRoot);
  clearCurrentProjectCache();
});

afterEach(async () => {
  clearCurrentProjectCache();
  process.chdir(repoCwd);
  await env.cleanup();
});

const run = (args: string[]): Promise<CliRunResult> => runCli(registerSpecCommand, args);

function inProject<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(projectDir);
  clearCurrentProjectCache();
  return fn().finally(() => {
    process.chdir(prev);
    clearCurrentProjectCache();
  });
}

async function seedSpecs() {
  await putFile(
    join(getGlobalSpecDir(), 'global-guide.md'),
    '---\nid: spec-global01\ntitle: 全局规范\ntags: [shared]\ndescription: 全局摘要\n---\n\n# 全局\n\n正文',
  );
  await putFile(
    join(getUserSpecDir(U), 'user-guide.md'),
    '---\nid: spec-user001\ntitle: 用户规范\ntags: [shared, user]\n---\n\n# 用户\n\n正文',
  );
  await putFile(
    join(getProjectSpecDir(U, ID_A), 'project-guide.md'),
    '---\nid: spec-proj001\ntitle: 项目规范\n---\n\n# 项目\n\n正文',
  );
}

test('spec list/show：跨层级人类输出/标签/分页/ID/详情/多匹配/坏 YAML/用户校验', async () => {
  await seedSpecs();
  await putFile(
    join(getGlobalSpecDir(), 'dup.md'),
    '---\nid: spec-dup0001\ntitle: 同名规范\n---\n\n# 全局同名\n',
  );
  await putFile(
    join(getUserSpecDir(U), 'dup.md'),
    '---\nid: spec-dup0002\ntitle: 同名规范\n---\n\n# 用户同名\n',
  );
  await putFile(
    join(getProjectSpecDir(U, ID_A), 'dup.md'),
    '---\nid: spec-dup0003\ntitle: 同名规范\n---\n\n# 项目同名\n',
  );
  await putFile(join(getGlobalSpecDir(), 'broken.md'), '---\ntitle: [broken\n---\n\n# 坏 YAML\n');

  await inProject(async () => {
    const human = await run(['spec', 'list']);
    assert.equal(human.exitCode, 0, human.stderr);
    for (const scope of ['global', 'user', 'project']) {
      assert.match(human.stdout, new RegExp(`\\[${scope}\\]`));
    }
    assert.match(human.stdout, /共享标签?|shared/);
    assert.match(human.stdout, /缺少「适用范围」声明/);
    assert.match(human.stdout, /id：spec-global01/);

    const byTag = await run(['spec', 'list', '--tag', 'user', '--json']);
    assert.equal(byTag.exitCode, 0, byTag.stderr);
    assert.ok(JSON.stringify(parseCliJson(byTag)).includes('spec-user001'));
    assert.ok(!JSON.stringify(parseCliJson(byTag)).includes('spec-global01'));
    const noTag = await run(['spec', 'list', '--tag', 'nope']);
    assert.match(noTag.stdout, /暂无 spec/);

    for (const args of [
      ['spec', 'list', '--scope', 'user', '--json'],
      ['spec', 'list', '--page', '1', '--page-size', '2', '--json'],
      ['spec', 'list', '--json-full'],
      ['spec', 'list', '--page', '1', '--page-size', '2'],
    ]) {
      const r = await run(args);
      assert.equal(r.exitCode, 0, `${args.join(' ')}: ${r.stderr}`);
    }

    const byId = await run(['spec', 'show', 'spec-global01', '--json', '--detail']);
    assert.equal(byId.exitCode, 0, byId.stderr);
    const parsed = parseCliJson(byId) as { id: string; content: string }[];
    assert.equal(parsed[0].id, 'spec-global01');
    assert.match(parsed[0].content, /正文/);

    const humanShow = await run(['spec', 'show', 'global-guide.md', '--detail']);
    assert.match(humanShow.stdout, /全局规范/);
    assert.match(humanShow.stdout, /全局摘要/);
    assert.match(humanShow.stdout, /正文/);

    const multi = await run(['spec', 'show', 'dup.md']);
    assert.match(multi.stdout, /同名 spec/);
    const glob = await run(['spec', 'show', '*.md']);
    assert.match(glob.stdout, /共匹配/);

    const broken = await run(['spec', 'show', 'broken.md']);
    assert.match(broken.stdout, /frontmatter YAML 解析失败/);

    const invalidUser = await run([
      'spec',
      'show',
      'global-guide.md',
      '--user',
      'nobody',
      '--json',
    ]);
    assert.equal(invalidUser.exitCode, 1);
    assert.match(invalidUser.stderr, /用户不存在/);

    const missing = await run(['spec', 'show', 'missing-file.md', '--json']);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, /未找到 spec/);

    const scoped = await run(['spec', 'show', 'global-guide.md', '--scope', 'user', '--json']);
    assert.equal(scoped.exitCode, 1);

    const byOtherUser = await run(['spec', 'show', 'global-guide.md', '--user', U, '--json']);
    assert.equal(byOtherUser.exitCode, 0, byOtherUser.stderr);
    const byTitle = await run(['spec', 'show', '用户规范', '--json']);
    assert.ok(JSON.stringify(parseCliJson(byTitle)).includes('spec-user001'));
  });
});

test('spec init/set：global/project 层、非法路径、强制覆盖、标签/id 与多匹配拒绝', async () => {
  const globalInit = await run([
    'spec',
    'init',
    'deep/note.md',
    '--scope',
    'global',
    '--title',
    '全局笔记',
    '--description',
    '摘要',
    '--tags',
    'a,b',
  ]);
  assert.equal(globalInit.exitCode, 0, globalInit.stderr);
  assert.match(globalInit.stdout, /已创建 spec/);
  assert.match(
    await readFile(join(getGlobalSpecDir(), 'deep/note.md'), 'utf-8'),
    /title: 全局笔记/,
  );

  const badPath = await run(['spec', 'init', '../escape.md', '--scope', 'user', '--title', 'x']);
  assert.equal(badPath.exitCode, 1);
  assert.match(badPath.stdout, /非法的相对路径/);

  const noProject = await run(['spec', 'init', 'no-scope.md', '--title', 'x']);
  assert.equal(noProject.exitCode, 1);
  assert.match(noProject.stdout, /无法确定 spec 写入目录/);

  await inProject(async () => {
    const init = await run(['spec', 'init', 'proj-note.md', '--title', '项目笔记', '--tags', 'p']);
    assert.equal(init.exitCode, 0, init.stderr);
    assert.match(init.stdout, /id: spec-/);

    const set = await run([
      'spec',
      'set',
      'proj-note.md',
      '--title',
      '项目笔记 2',
      '--description',
      '新摘要',
      '--add-tag',
      'x',
      '--add-tag',
      'y',
      '--rm-tag',
      'p',
      '--id',
      'spec-manual01',
    ]);
    assert.equal(set.exitCode, 0, set.stderr);
    const content = await readFile(join(getProjectSpecDir(U, ID_A), 'proj-note.md'), 'utf-8');
    assert.match(content, /title: 项目笔记 2/);
    assert.match(content, /id: spec-manual01/);
    assert.match(content, /description: 新摘要/);

    const badId = await run(['spec', 'set', 'proj-note.md', '--id', 'bad id']);
    assert.equal(badId.exitCode, 1);
    assert.match(badId.stdout, /非法 id/);

    const missing = await run(['spec', 'set', 'missing.md', '--title', 'x']);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stdout, /未找到 spec/);

    await putFile(
      join(getGlobalSpecDir(), 'same.md'),
      '---\nid: spec-same001\ntitle: 同名\n---\n\nbody',
    );
    await putFile(
      join(getUserSpecDir(U), 'same.md'),
      '---\nid: spec-same002\ntitle: 同名\n---\n\nbody',
    );
    const multi = await run(['spec', 'set', 'same.md', '--title', '新标题']);
    assert.equal(multi.exitCode, 1);
    assert.match(multi.stdout, /匹配到 2 个 spec/);
    assert.match(multi.stdout, /--scope/);

    await putFile(join(getUserSpecDir(U), 'bad-yaml.md'), '---\ntitle: [bad\n---\n\nbody');
    const badYaml = await run(['spec', 'set', 'bad-yaml.md', '--title', 'x']);
    assert.equal(badYaml.exitCode, 1);
    assert.match(badYaml.stdout, /已拒绝写入/);
  });
});

test('spec lint/conflicts/migrate/suggest-description：项目内/外与 JSON 分支', async () => {
  const outsideConflicts = await run(['spec', 'conflicts']);
  assert.match(outsideConflicts.stdout, /当前目录不是 Lattice 项目/);
  const outsideJson = await run(['spec', 'conflicts', '--json']);
  assert.equal(outsideJson.exitCode, 1);
  assert.match(outsideJson.stderr, /当前目录不是/);

  await seedSpecs();
  await putFile(
    join(getGlobalSpecDir(), 'dup.md'),
    '---\nid: spec-dup0001\ntitle: 同名\n---\n\nglobal',
  );
  await putFile(
    join(getProjectSpecDir(U, ID_A), 'dup.md'),
    '---\nid: spec-dup0003\ntitle: 同名\n---\n\nproject',
  );
  await putFile(
    join(getUserSpecDir(U), 'needs-migrate.md'),
    '---\ntitle: 待迁移\n---\n\n# 待迁移\n',
  );
  await putFile(
    join(getUserSpecDir(U), 'no-desc.md'),
    '---\nid: spec-nodesc1\ntitle: 无摘要\n---\n\nx',
  );

  await inProject(async () => {
    const conflicts = await run(['spec', 'conflicts']);
    assert.match(conflicts.stdout, /检测到 1 个冲突/);
    assert.match(conflicts.stdout, /提示：/);
    const conflictsJson = await run(['spec', 'conflicts', '--json']);
    assert.equal(conflictsJson.exitCode, 0, conflictsJson.stderr);
    assert.ok(JSON.stringify(parseCliJson(conflictsJson)).includes('dup.md'));
    const conflictsFull = await run(['spec', 'conflicts', '--json-full']);
    assert.equal(conflictsFull.exitCode, 0);

    const lintAll = await run(['spec', 'lint', '--all']);
    assert.ok([0, 1].includes(lintAll.exitCode), lintAll.stderr);
    assert.match(lintAll.stdout, /个 spec/);
    const lintUser = await run(['spec', 'lint', '--all', '--scope', 'user']);
    assert.ok([0, 1].includes(lintUser.exitCode));
    const lintJson = await run(['spec', 'lint', '--all', '--json']);
    assert.ok(parseCliJson(lintJson));
    const lintMissing = await run(['spec', 'lint', 'missing.md', '--json']);
    assert.equal(lintMissing.exitCode, 1);
    const lintUsage = await run(['spec', 'lint', '--json']);
    assert.equal(lintUsage.exitCode, 1);

    const dry = await run(['spec', 'migrate', '--scope', 'user', '--dry-run']);
    assert.equal(dry.exitCode, 0, dry.stderr);
    assert.match(dry.stdout, /dry-run 模式/);
    const migrate = await run(['spec', 'migrate', '--scope', 'user', '--json']);
    assert.equal(migrate.exitCode, 0, migrate.stderr);
    assert.ok(JSON.stringify(parseCliJson(migrate)).includes('needs-migrate.md'));
    const migrateHuman = await run(['spec', 'migrate', '--scope', 'user']);
    assert.match(migrateHuman.stdout, /跳过（已合规）/);

    const suggest = await run(['spec', 'suggest-description', '--scope', 'user', '--limit', '1']);
    assert.equal(suggest.exitCode, 0, suggest.stderr);
    const suggestJson = await run(['spec', 'suggest-description', '--scope', 'global', '--json']);
    assert.equal(suggestJson.exitCode, 0, suggestJson.stderr);
  });
});

test('spec template sync-builtins：按 config-local.language 安装英文模板', async () => {
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, language: 'en' }),
  );
  const { resolveBundledSpecTemplateNames } = await import('../../src/utils/spec-templates');
  const names = await resolveBundledSpecTemplateNames('all', 'en');
  const target = names[0];

  const synced = await run(['spec', 'template', 'sync-builtins', '--template', target]);
  assert.equal(synced.exitCode, 0, synced.stderr);
  assert.match(synced.stdout, /已同步/);

  const content = await readFile(
    join(env.latticeHome, 'templates', 'spec', target, 'index.md'),
    'utf-8',
  );
  assert.doesNotMatch(content, /[\u4e00-\u9fff]/);
});

test('spec template：内置同步/列表/应用/无仓库/未注册删除/拉取失败', async () => {
  const { resolveBundledSpecTemplateNames } = await import('../../src/utils/spec-templates');
  const names = await resolveBundledSpecTemplateNames('all');
  assert.ok(names.length > 0, '应有内置模板');
  const target = names[0];

  const synced = await run(['spec', 'template', 'sync-builtins', '--template', target]);
  assert.equal(synced.exitCode, 0, synced.stderr);
  assert.match(synced.stdout, /已同步/);

  const listHuman = await run(['spec', 'template', 'list']);
  assert.match(listHuman.stdout, /共 \d+ 个模板/);
  assert.match(listHuman.stdout, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const listJson = await run(['spec', 'template', 'list', '--json']);
  assert.equal(listJson.exitCode, 0);

  const syncNone = await run(['spec', 'template', 'sync']);
  assert.match(syncNone.stdout, /当前没有已配置的模板仓库/);
  const registryEmpty = await run(['spec', 'template', 'registry', 'list']);
  assert.match(registryEmpty.stdout, /暂无已注册模板仓库/);
  const registryJson = await run(['spec', 'template', 'registry', 'list', '--json']);
  assert.equal(registryJson.exitCode, 0);
  const removeUnknown = await run([
    'spec',
    'template',
    'registry',
    'remove',
    'https://example.com/x',
  ]);
  assert.match(removeUnknown.stdout, /未注册该模板仓库/);

  const applyOutside = await run(['spec', 'template', 'apply', target]);
  assert.match(applyOutside.stdout, /当前目录不是 Lattice 项目/);

  await inProject(async () => {
    const applied = await run(['spec', 'template', 'apply', target]);
    assert.equal(applied.exitCode, 0, applied.stderr);
    assert.match(applied.stdout, /已应用|未找到模板/);
    const unknown = await run(['spec', 'template', 'apply', 'no-such-template']);
    assert.match(unknown.stdout, /未找到模板/);
  });

  const pullFail = await run(['spec', 'template', 'pull', join(env.tmpRoot, 'no-repo')]);
  assert.equal(pullFail.exitCode, 1);
  assert.match(pullFail.stderr, /拉取模板失败/);
});
