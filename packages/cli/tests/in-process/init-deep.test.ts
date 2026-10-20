import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, getUserSpecDir, initDb, readInitMeta, readLocalConfig } from '@qcqx/lattice-core';
import { registerInitCommand } from '../../src/commands/init';
import { resolveBundledSpecTemplateNames } from '../../src/utils/spec-templates';
import { createCliEnv, runCli, putFile, U, type CliEnv, type CliRunResult } from './helpers';

const prompts = vi.hoisted(() => ({
  input: vi.fn(),
  confirm: vi.fn(),
  checkbox: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: prompts.input,
  confirm: prompts.confirm,
  checkbox: prompts.checkbox,
}));

interface BareEnv {
  tmpRoot: string;
  latticeHome: string;
  cleanup(): Promise<void>;
}

let env: CliEnv | BareEnv;
let fakeHome: string;
const originalHome = process.env.HOME;
const repoCwd = process.cwd();

async function createBareEnv(withConfig: boolean): Promise<BareEnv> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'lattice-init-deep-'));
  const latticeHome = join(tmpRoot, 'lattice');
  if (withConfig) {
    await putFile(
      join(latticeHome, 'config', 'config-local.json'),
      JSON.stringify({ username: U, gitEnabled: false }),
    );
  }
  process.env.LATTICE_HOME = latticeHome;
  return {
    tmpRoot,
    latticeHome,
    async cleanup() {
      closeDb();
      delete process.env.LATTICE_HOME;
      await rm(tmpRoot, { recursive: true, force: true });
    },
  };
}

function initGitRepo(name: string): string {
  const dir = join(env.tmpRoot, name);
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
    `init-${name}`,
  ]);
  return dir;
}

const run = (args: string[]): Promise<CliRunResult> => runCli(registerInitCommand, args);

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'lattice-fake-home-'));
  process.env.HOME = fakeHome;
  for (const dir of ['.claude', '.cursor', '.agents', '.agent', '.codex', '.trae', '.trae-cn']) {
    await mkdir(join(fakeHome, dir), { recursive: true });
  }
  prompts.input.mockReset().mockResolvedValue('promptuser');
  prompts.confirm.mockReset().mockResolvedValue(false);
  prompts.checkbox.mockReset().mockResolvedValue([]);
});

afterEach(async () => {
  process.chdir(repoCwd);
  process.env.HOME = originalHome;
  if (env) await env.cleanup();
  await rm(fakeHome, { recursive: true, force: true });
});

test('init 全新环境：目录/配置/模板/AI 注入/git remote/扫描/模型降级/RAG', async () => {
  env = await createBareEnv(false);
  const scanRepo = initGitRepo('scan-a');
  const remote = join(env.tmpRoot, 'origin.git');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  const names = await resolveBundledSpecTemplateNames('all');
  assert.ok(names.length > 0);

  const r = await run([
    'init',
    '-f',
    '--username',
    'alice',
    '--git-remote',
    remote,
    '--scan-dirs',
    scanRepo,
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /正在创建目录结构/);
  assert.match(r.stdout, /已安装 1 个内置模板/);
  assert.match(r.stdout, /检测到 Claude|检测到 Cursor/);
  assert.match(r.stdout, /已注入/);
  assert.match(r.stdout, /扫描完成：新增 1 个/);
  assert.match(r.stdout, /初始化完成/);

  const config = await readLocalConfig();
  assert.equal(config?.username, 'alice');
  assert.deepEqual(config?.scanDirs, [scanRepo]);
  assert.equal(config?.gitRemote, remote);
  assert.equal(config?.gitEnabled, true);
  assert.ok(
    await readdir(join(env.latticeHome, '.git'))
      .then(() => true)
      .catch(() => false),
  );
  assert.ok(await readdir(join(fakeHome, '.claude')).then((files) => files.length > 0));
});

test('init --lang en：英文语言包注入并记录到 config/init-meta', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run([
    'init',
    '-f',
    '--username',
    'alice',
    '--lang',
    'en',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /注入文档语言：English/);

  assert.equal((await readLocalConfig())?.language, 'en');
  assert.equal((await readInitMeta())?.language, 'en');
  const skill = await readFile(join(fakeHome, '.claude', 'skills', 'lattice', 'SKILL.md'), 'utf-8');
  assert.match(skill, /Local-first engineering memory and workflow layer/);
  const rules = await readFile(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf-8');
  assert.match(rules, /Always respond in the user's language/);
});

test('init 重新初始化：用户名迁移、目标已存在报错、跳过扫描/下载确认', async () => {
  env = await createCliEnv();
  await putFile(
    join(getUserSpecDir(U), 'keep.md'),
    '---\nid: spec-keep001\ntitle: 保留\n---\nbody',
  );
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, gitEnabled: false }),
  );
  const names = await resolveBundledSpecTemplateNames('all');

  const migrated = await run([
    'init',
    '-f',
    '--username',
    'alice',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(migrated.exitCode, 0, `${migrated.stdout}\n${migrated.stderr}`);
  assert.match(migrated.stdout, /正在迁移用户数据/);
  assert.match(migrated.stdout, /重新初始化/);
  assert.match(migrated.stdout, /Lattice 已初始化/);
  assert.match(migrated.stdout, /重新初始化完成/);
  const aliceSpec = join(getUserSpecDir('alice'), 'keep.md');
  assert.match(await readFile(aliceSpec, 'utf-8'), /spec-keep001/);

  // 目标用户目录已存在 → 抛错
  await mkdir(join(env.latticeHome, 'users', 'bob'), { recursive: true });
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: 'alice', gitEnabled: false }),
  );
  const conflict = await run(['init', '-f', '--username', 'bob']);
  assert.equal(conflict.exitCode, 1);
  assert.match(conflict.stderr, /目标用户目录已存在/);

  // 无 -f：输入用户名；扫描确认 false → 跳过；模型确认 false → 跳过
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: 'alice', gitEnabled: false }),
  );
  const repo = initGitRepo('scan-b');
  const prompted = await run(['init', '--scan-dirs', repo, '--builtin-spec-templates', names[0]]);
  assert.equal(prompted.exitCode, 0, `${prompted.stdout}\n${prompted.stderr}`);
  assert.match(prompted.stdout, /已跳过项目扫描/);
  assert.equal((await readLocalConfig())?.username, 'promptuser');
  assert.equal(prompts.confirm.mock.calls.length >= 2, true);
});

test('init scan：未初始化/--dirs --force/--auto/交互输入目录并取消', async () => {
  env = await createBareEnv(false);
  const notInit = await run(['init', 'scan', '--dirs', join(env.tmpRoot, 'x'), '-f']);
  assert.match(notInit.stdout, /尚未初始化/);

  await env.cleanup();
  env = await createCliEnv();
  const repoA = initGitRepo('scan-c');
  const repoB = initGitRepo('scan-d');
  const direct = await run(['init', 'scan', '--dirs', repoA, '--auto']);
  assert.equal(direct.exitCode, 0, `${direct.stdout}\n${direct.stderr}`);
  assert.match(direct.stdout, /扫描完成/);
  assert.match(direct.stdout, /新增项目：1/);
  assert.match(direct.stdout, /新增项目路径/);
  const scanCache = JSON.parse(
    await readFile(join(env.latticeHome, '.cache', 'last-scan.json'), 'utf-8'),
  );
  assert.equal(scanCache.lastResult.added, 1);

  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, scanDirs: [repoB] }),
  );
  const auto = await run(['init', 'scan', '--auto']);
  assert.equal(auto.exitCode, 0, `${auto.stdout}\n${auto.stderr}`);
  assert.match(auto.stdout, /扫描完成/);

  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
  );
  prompts.input.mockResolvedValueOnce(`${repoA}, ${repoB}`);
  const interactive = await run(['init', 'scan']);
  assert.match(interactive.stdout, /已保存扫描目录到配置/);
  assert.match(interactive.stdout, /已取消/);
  assert.deepEqual((await readLocalConfig())?.scanDirs, [repoA, repoB]);
});
