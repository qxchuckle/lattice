import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, initDb, isBlacklisted, scanForProjects } from '../src/index';
import { collectFingerprint, isPathPrefixOf, normalizeLocalPath } from '../src/project/fingerprint';
import { createFakeProject, createTempLatticeHome, putFile } from './helpers';

const U = 't';

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

test('isBlacklisted / normalizeLocalPath / isPathPrefixOf', () => {
  for (const name of ['node_modules', '.git', 'dist', 'coverage', 'foo.tmp', 'vendor']) {
    assert.equal(isBlacklisted(name), true, name);
  }
  for (const name of ['src', 'my-project', 'vendor-code', 'package.json']) {
    assert.equal(isBlacklisted(name), false, name);
  }

  assert.equal(normalizeLocalPath('/a/b///'), '/a/b');
  assert.equal(normalizeLocalPath('/a/b'), '/a/b');
  assert.equal(isPathPrefixOf('/a/b', '/a/b'), true);
  assert.equal(isPathPrefixOf('/a/b/', '/a/b/c'), true);
  assert.equal(isPathPrefixOf('/a/b', '/a/bc'), false);
  assert.equal(isPathPrefixOf('/a/b', '/a/c'), false);
});

test('collectFingerprint：git 指纹 + package.json workspaces + pnpm-workspace', async () => {
  const dir = join(env.tmpRoot, 'fp-git');
  const sha = await createFakeProject(dir, { remote: 'https://github.com/acme/repo.git' });
  await putFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@acme/root', workspaces: ['packages/*'] }),
  );
  await putFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  await putFile(join(dir, 'packages', 'a', 'package.json'), JSON.stringify({ name: '@acme/a' }));
  await putFile(join(dir, 'apps', 'b', 'package.json'), JSON.stringify({ name: '@acme/b' }));
  await putFile(join(dir, 'packages', 'no-pkg', 'README.md'), '# no package');

  const { derived } = await collectFingerprint(dir);
  assert.equal(derived.gitFirstCommit, sha);
  assert.equal(derived.gitDefaultBranch, 'main');
  assert.equal(derived.gitRemotes.length, 1);
  assert.match(derived.gitRemotes[0], /github\.com\/acme\/repo/);
  assert.deepEqual(derived.packageNames, ['@acme/root']);
  assert.deepEqual(new Set(derived.monorepoPackages), new Set(['@acme/a', '@acme/b']));

  // workspaces 对象形态
  const dir2 = join(env.tmpRoot, 'fp-object');
  await mkdir(dir2, { recursive: true });
  await putFile(
    join(dir2, 'package.json'),
    JSON.stringify({ name: 'obj-root', workspaces: { packages: ['libs/*'] } }),
  );
  await putFile(join(dir2, 'libs', 'x', 'package.json'), JSON.stringify({ name: 'lib-x' }));
  const obj = await collectFingerprint(dir2);
  assert.equal(obj.derived.gitFirstCommit, undefined);
  assert.deepEqual(obj.derived.packageNames, ['obj-root']);
  assert.deepEqual(obj.derived.monorepoPackages, ['lib-x']);
});

test('collectFingerprint：坏 package.json / 空目录安全降级', async () => {
  const dir = join(env.tmpRoot, 'fp-bad');
  await createFakeProject(dir);
  await putFile(join(dir, 'package.json'), '{ not json');
  const bad = await collectFingerprint(dir);
  assert.ok(bad.derived.gitFirstCommit);
  assert.deepEqual(bad.derived.packageNames, []);
  assert.deepEqual(bad.derived.monorepoPackages, []);

  const empty = join(env.tmpRoot, 'fp-empty');
  await mkdir(empty, { recursive: true });
  const none = await collectFingerprint(empty);
  assert.deepEqual(none.derived, {
    gitRemotes: [],
    packageNames: [],
    monorepoPackages: [],
  });
});

test('scanForProjects：git/lattice.json/黑名单/嵌套/进度/幂等', async () => {
  const { execFileSync } = await import('node:child_process');
  const initRepo = async (dir: string, marker: string) => {
    await mkdir(dir, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await putFile(join(dir, 'unique.txt'), marker);
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', marker],
      { cwd: dir },
    );
  };

  const root = join(env.tmpRoot, 'scan-root');
  await initRepo(root, 'scan-root');
  await putFile(join(root, 'package.json'), JSON.stringify({ name: 'scan-root' }));

  const child = join(root, 'child');
  await initRepo(child, 'scan-child');
  await putFile(join(child, 'package.json'), JSON.stringify({ name: 'scan-child' }));

  const legacy = join(root, 'legacy-project');
  await mkdir(legacy, { recursive: true });
  await putFile(join(legacy, 'lattice.json'), JSON.stringify({ id: 'aaaabbbbccccdddd' }));

  const blacklisted = join(root, 'node_modules', 'dep');
  await initRepo(blacklisted, 'blacklisted');

  // 无 id 源的普通目录
  await mkdir(join(root, 'plain'), { recursive: true });

  // 空 git 仓库（无 commit、无 remote、无 lattice.json）→ 不注册
  const emptyGit = join(root, 'empty-git');
  await mkdir(emptyGit, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: emptyGit });

  const progress: { currentDir: string; found: number }[] = [];
  const first = await scanForProjects(U, [root, join(env.tmpRoot, 'missing')], (p) => {
    progress.push({ currentDir: p.currentDir, found: p.found });
  });
  assert.equal(first.added.length, 3, first.added.join(','));
  assert.ok(first.added.includes(root));
  assert.ok(first.added.includes(child));
  assert.ok(first.added.includes(legacy));
  assert.ok(!first.added.includes(blacklisted));
  assert.ok(!first.added.includes(emptyGit));
  assert.ok(progress.length > 0);
  assert.ok(progress.some((p) => p.currentDir === root));
  assert.ok(progress.some((p) => p.currentDir === join(env.tmpRoot, 'missing')));

  const second = await scanForProjects(U, [root]);
  assert.deepEqual(second.added, []);
  assert.equal(second.updated.length, 3);

  // 嵌套关系已建立：child nested-in root
  const { readRelationsFile } = await import('../src/project/relation');
  const relations = await readRelationsFile(U);
  assert.ok(
    relations.relations.some((r) => r.type === 'nested-in' && r.description === '直接父级项目'),
  );
});
