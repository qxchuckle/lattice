import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  collectFingerprint,
  computeProjectIds,
  getProjectMeta,
  initDb,
  listProjects,
  listRelations,
  listTrashItems,
  registerProjectWithIds,
  syncBundledSpecTemplates,
} from '@qcqx/lattice-core';
import { registerLinkCommand } from '../../src/commands/link';
import { registerUnlinkCommand } from '../../src/commands/unlink';
import { clearCurrentProjectCache } from '../../src/utils/current-project';
import { resolveBundledSpecTemplateNames } from '../../src/utils/spec-templates';
import {
  createCliEnv,
  runCli,
  seedProject,
  putFile,
  ID_A,
  U,
  type CliEnv,
  type CliRunResult,
} from './helpers';

const prompts = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('@inquirer/prompts', () => ({ confirm: prompts.confirm }));

let env: CliEnv;
const repoCwd = process.cwd();

beforeEach(async () => {
  env = await createCliEnv();
  process.chdir(env.tmpRoot);
  clearCurrentProjectCache();
  prompts.confirm.mockReset().mockResolvedValue(false);
});

afterEach(async () => {
  clearCurrentProjectCache();
  process.chdir(repoCwd);
  await env.cleanup();
});

const runLink = (args: string[]): Promise<CliRunResult> => runCli(registerLinkCommand, args);
const runUnlink = (args: string[]): Promise<CliRunResult> => runCli(registerUnlinkCommand, args);

function initGitRepo(name: string, parent?: string): string {
  const dir = join(parent ?? env.tmpRoot, name);
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
    `init-${name}-${Date.now()}`,
  ]);
  execFileSync('git', [
    '-C',
    dir,
    'remote',
    'add',
    'origin',
    `https://github.com/acme/${name}.git`,
  ]);
  return dir;
}

async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  clearCurrentProjectCache();
  return fn().finally(() => {
    process.chdir(prev);
    clearCurrentProjectCache();
  });
}

test('link 新建：元数据/分组/标签/lattice.json/嵌套父关系/幂等更新', async () => {
  const parent = initGitRepo('link-parent');
  const child = initGitRepo('link-child', parent);

  const parentRun = await inDir(parent, () =>
    runLink([
      'link',
      '--name',
      '父项目',
      '--description',
      '父描述',
      '--groups',
      'work/root',
      '--tags',
      'p',
    ]),
  );
  assert.equal(parentRun.exitCode, 0, `${parentRun.stdout}\n${parentRun.stderr}`);
  assert.match(parentRun.stdout, /项目已注册/);
  assert.match(parentRun.stdout, /名称：父项目/);
  assert.match(parentRun.stdout, /已创建分组/);
  assert.match(parentRun.stdout, /Git：github\.com\/acme\/link-parent/);

  const childRun = await inDir(child, () =>
    runLink(['link', '--name', '子项目', '--groups', 'work/child', '--tags', 'c']),
  );
  assert.equal(childRun.exitCode, 0, `${childRun.stdout}\n${childRun.stderr}`);
  assert.match(childRun.stdout, /检测到嵌套项目关系/);
  assert.match(childRun.stdout, /直接父级/);

  await initDb();
  const projects = listProjects(U);
  const parentRow = projects.find((p) => p.name === '父项目');
  const childRow = projects.find((p) => p.name === '子项目');
  assert.ok(parentRow && childRow);
  const childMeta = await getProjectMeta(U, childRow.id);
  assert.deepEqual(childMeta?.tags, ['c']);
  const relations = await listRelations(U);
  assert.ok(relations.some((r) => r.projectA === childMeta.id || r.projectB === childMeta.id));
  const lattice = JSON.parse(await readFile(join(child, 'lattice.json'), 'utf-8'));
  assert.ok(lattice.id);

  const relink = await inDir(child, () =>
    runLink(['link', '--name', '子项目改名', '--tags', 'c2']),
  );
  assert.equal(relink.exitCode, 0, `${relink.stdout}\n${relink.stderr}`);
  assert.match(relink.stdout, /已注册为 Lattice 项目，已更新项目元数据/);
  await initDb();
  const updatedRow = listProjects(U).find((p) => p.name === '子项目改名');
  assert.ok(updatedRow);
  assert.deepEqual((await getProjectMeta(U, updatedRow.id))?.tags, ['c2']);
});

test('link 边界：无 git/仅 lattice.json/A2 保留原项目/其他用户同名/模板/restore', async () => {
  const plain = join(env.tmpRoot, 'plain-dir');
  await mkdir(plain, { recursive: true });
  const noGit = await inDir(plain, () => runLink(['link']));
  assert.match(noGit.stdout, /无法注册/);
  assert.match(noGit.stdout, /请确保在 git 仓库中运行/);

  const legacyOnly = join(env.tmpRoot, 'legacy-only');
  await mkdir(legacyOnly, { recursive: true });
  await putFile(join(legacyOnly, 'lattice.json'), JSON.stringify({ id: 'abcd1234abcd1234' }));
  const legacyRun = await inDir(legacyOnly, () => runLink(['link', '--name', '仅有 Legacy']));
  assert.equal(legacyRun.exitCode, 0, `${legacyRun.stdout}\n${legacyRun.stderr}`);
  assert.match(legacyRun.stdout, /项目已注册/);
  await initDb();
  const legacyRow = listProjects(U).find((p) => p.name === '仅有 Legacy');
  assert.ok(legacyRow);
  assert.ok((await getProjectMeta(U, legacyRow.id))?.ids?.some((id) => id.startsWith('legacy:')));

  // A2：既有项目只有 git ID，无 legacy → 新建并写 lattice.json
  const a2Repo = initGitRepo('a2-repo');
  const { derived } = await collectFingerprint(a2Repo);
  const gitOnlyIds = computeProjectIds(derived, null);
  await registerProjectWithIds(U, gitOnlyIds, a2Repo, derived);
  await initDb();
  const before = listProjects(U).length;
  const a2 = await inDir(a2Repo, () => runLink(['link', '--name', 'A2 新项目']));
  assert.equal(a2.exitCode, 0, `${a2.stdout}\n${a2.stderr}`);
  assert.match(a2.stdout, /新建，原项目通过虚拟合并关联/);
  await initDb();
  assert.equal(listProjects(U).length, before + 1);
  assert.ok(JSON.parse(await readFile(join(a2Repo, 'lattice.json'), 'utf-8')).id);

  // 其他用户已注册同一 git 指纹 → 当前用户新建
  const otherRepo = initGitRepo('other-user-repo');
  const otherDerived = (await collectFingerprint(otherRepo)).derived;
  const otherIds = computeProjectIds(otherDerived, null);
  await registerProjectWithIds('u2', otherIds, otherRepo, otherDerived);
  const asCurrent = await inDir(otherRepo, () => runLink(['link', '--name', '当前用户副本']));
  assert.equal(asCurrent.exitCode, 0, `${asCurrent.stdout}\n${asCurrent.stderr}`);
  assert.match(asCurrent.stdout, /项目已注册/);
  await initDb();
  assert.ok(listProjects(U).some((p) => p.name === '当前用户副本'));

  // 模板成功 + all + 未知模板
  const names = await resolveBundledSpecTemplateNames('all');
  await syncBundledSpecTemplates([names[0]]);
  const templateRepo = initGitRepo('template-repo');
  const templated = await inDir(templateRepo, () => runLink(['link', '--template', names[0]]));
  assert.equal(templated.exitCode, 0, `${templated.stdout}\n${templated.stderr}`);
  assert.match(templated.stdout, /模板：/);
  const allTemplatesRepo = initGitRepo('all-template-repo');
  const allTemplates = await inDir(allTemplatesRepo, () => runLink(['link', '--template', 'all']));
  assert.equal(allTemplates.exitCode, 0, `${allTemplates.stdout}\n${allTemplates.stderr}`);
  const badTemplateRepo = initGitRepo('bad-template-repo');
  const badTemplate = await inDir(badTemplateRepo, () =>
    runLink(['link', '--template', 'no-such-template']),
  );
  assert.equal(badTemplate.exitCode, 1);
  assert.match(badTemplate.stderr, /未找到模板/);

  // --restore 成功与失败
  await seedProject(env, { ids: [ID_A], dirName: 'restore-target' });
  const restoreRepo = initGitRepo('restore-repo');
  const restored = await inDir(restoreRepo, () =>
    runLink(['link', '--restore', ID_A, '--name', '恢复项目', '--tags', 'r']),
  );
  assert.equal(restored.exitCode, 0, `${restored.stdout}\n${restored.stderr}`);
  assert.match(restored.stdout, /已将当前目录关联到项目/);
  assert.match(await readFile(join(restoreRepo, 'lattice.json'), 'utf-8'), /aaaabbbbccccdddd/);
  await initDb();
  const restoredMeta = await getProjectMeta(U, ID_A);
  assert.equal(restoredMeta?.name, '恢复项目');
  assert.deepEqual(restoredMeta?.tags, ['r']);

  const missingRestore = await inDir(restoreRepo, () =>
    runLink(['link', '--restore', 'legacy:0000000000000000']),
  );
  assert.equal(missingRestore.exitCode, 1);
  assert.match(missingRestore.stdout, /未找到项目/);
});

test('unlink：当前目录解绑/确认取消/数据保留/格式无效/--id 模式', async () => {
  const meta = await seedProject(env, { ids: [ID_A], dirName: 'unlink-proj' });
  const dir = meta.localPaths![0];
  await putFile(join(dir, 'lattice.json'), JSON.stringify({ id: 'aaaabbbbccccdddd' }));

  const outside = await runUnlink(['unlink', '-f']);
  assert.match(outside.stdout, /当前目录不是 Lattice 项目/);

  const cancelled = await inDir(dir, () => runUnlink(['unlink']));
  assert.match(cancelled.stdout, /已取消/);
  assert.match(await readFile(join(dir, 'lattice.json'), 'utf-8'), /aaaabbbbccccdddd/);

  const unbound = await inDir(dir, () => runUnlink(['unlink', '-f']));
  assert.equal(unbound.exitCode, 0, unbound.stderr);
  assert.match(unbound.stdout, /已删除 lattice.json/);
  assert.match(unbound.stdout, /仍保留/);
  await initDb();
  assert.ok(listProjects(U).some((p) => p.id === ID_A));

  const again = await inDir(dir, () => runUnlink(['unlink', '-f']));
  assert.match(again.stdout, /当前目录不是 Lattice 项目/);

  const noData = await runUnlink(['unlink', '--id', ID_A, '-f']);
  assert.match(noData.stdout, /未执行任何操作/);
  const missing = await runUnlink(['unlink', '--id', 'legacy:0000000000000000', '-f']);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stdout, /未找到项目/);

  prompts.confirm.mockResolvedValueOnce(false);
  const idCancelled = await runUnlink(['unlink', '--id', ID_A]);
  assert.match(idCancelled.stdout, /已取消/);
  const removed = await runUnlink(['unlink', '--id', ID_A, '--remove-data', '-f']);
  assert.equal(removed.exitCode, 0, removed.stderr);
  assert.match(removed.stdout, /移入垃圾桶/);
  await initDb();
  assert.ok(!listProjects(U).some((p) => p.id === ID_A));
  assert.ok((await listTrashItems()).some((i) => i.type === 'project'));

  // 目录模式 --remove-data
  const meta2 = await seedProject(env, {
    ids: ['legacy:bbbbccccddddeeee'],
    dirName: 'unlink-proj2',
  });
  const dir2 = meta2.localPaths![0];
  await putFile(join(dir2, 'lattice.json'), JSON.stringify({ id: 'bbbbccccddddeeee' }));
  const removedByDir = await inDir(dir2, () => runUnlink(['unlink', '-f', '--remove-data']));
  assert.equal(removedByDir.exitCode, 0, removedByDir.stderr);
  assert.match(removedByDir.stdout, /移入垃圾桶/);
  assert.match(removedByDir.stdout, /已删除 lattice.json/);
  await initDb();
  assert.ok(!listProjects(U).some((p) => p.id === 'legacy:bbbbccccddddeeee'));
});
