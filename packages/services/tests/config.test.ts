import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, test } from 'vitest';
import { createFixtureHome } from './fixture';

const fixture = createFixtureHome();
process.env.LATTICE_HOME = fixture.home;

const services = await import('../src/index');
const core = await import('@qcqx/lattice-core');

beforeAll(async () => {
  await core.initDb();
});

afterAll(() => {
  core.closeDb();
  fixture.cleanup();
});

test('applyConfigPatch：global 写入 / 模型预设联动 / 未知键安全', async () => {
  const result = await services.applyConfigPatch('global', {
    set: {
      'rag.embedding.modelId': 'Xenova/all-MiniLM-L6-v2',
      'rag.embedding.allowRemoteModels': false,
    },
  });
  assert.ok(result.changedKeys.includes('rag.embedding.modelId'));
  assert.ok(result.changedKeys.includes('rag.embedding.dimension'));
  assert.equal(result.requiresRagRebuild, true);

  const config = await core.readGlobalConfig();
  assert.equal(config.rag?.embedding?.modelId, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(config.rag?.embedding?.dimension, 384);
  assert.equal(config.rag?.embedding?.allowRemoteModels, false);

  await assert.rejects(
    () => services.applyConfigPatch('global', { set: { '__proto__.polluted': true } }),
    /非法配置项路径/,
  );
  await assert.rejects(
    () => services.applyConfigPatch('global', { set: { 'rag.embedding.modelId': '   ' } }),
    /模型 ID 不能为空/,
  );
});

test('applyConfigPatch：local 禁止直接改 username，unset 删除键', async () => {
  await services.applyConfigPatch('local', { set: { language: 'en' } });
  assert.equal((await core.readLocalConfig())?.language, 'en');

  await assert.rejects(
    () => services.applyConfigPatch('local', { set: { username: 'other' } }),
    /切换用户/,
  );

  await services.applyConfigPatch('local', { unset: ['language'] });
  assert.equal((await core.readLocalConfig())?.language, undefined);
});

test('registerProjectAtPath：非 Git 目录必须显式创建锚点，且幂等', async () => {
  const dir = join(fixture.workspace, 'plain-project');
  mkdirSync(dir, { recursive: true });

  await assert.rejects(() => services.registerProjectAtPath('tester', dir), /Git 指纹/);

  const first = await services.registerProjectAtPath('tester', dir, { createAnchor: true });
  assert.equal(first.created, true);
  assert.ok(first.anchorPath);
  const anchor = JSON.parse(readFileSync(first.anchorPath!, 'utf8')) as { id?: string };
  assert.ok(anchor.id);

  const second = await services.registerProjectAtPath('tester', dir, { createAnchor: true });
  assert.equal(second.created, false);
  assert.equal(second.projectId, first.projectId);
});

test('registerProjectAtPath：Git 项目默认不写 lattice.json', async () => {
  const dir = join(fixture.workspace, 'git-project');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# demo\n');
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=Tester', '-c', 'user.email=tester@example.com', 'commit', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' },
  );

  const result = await services.registerProjectAtPath('tester', dir);
  assert.equal(result.created, true);
  assert.equal(result.anchorPath, undefined);
  assert.equal(existsSync(join(dir, 'lattice.json')), false);
  assert.ok(result.ids.some((id) => id.startsWith('git:')));
});

test('scanProjects：空目录列表返回空结果并回调进度', async () => {
  const progress: string[] = [];
  const result = await services.scanProjects('tester', [fixture.workspace], (item) => {
    progress.push(item.currentDir);
  });
  assert.ok(Array.isArray(result.added));
  assert.ok(Array.isArray(result.updated));
  assert.ok(progress.length > 0);
});

test('本地配置写入不泄露 webAuth 以外字段（服务层只负责补丁）', async () => {
  const localPath = join(fixture.home, 'config', 'config-local.json');
  const local = JSON.parse(readFileSync(localPath, 'utf8')) as Record<string, unknown>;
  local.webAuth = { passwordHash: 'x', salt: 'y', jwtSecret: 'z' };
  writeFileSync(localPath, JSON.stringify(local));
  const loaded = await core.readLocalConfig();
  assert.equal(loaded?.username, 'tester');
  assert.ok(loaded?.webAuth);
});
