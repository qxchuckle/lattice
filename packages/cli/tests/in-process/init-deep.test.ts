import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import {
  closeDb,
  getUserSpecDir,
  initDb,
  readGlobalConfig,
  readInitMeta,
  readLocalConfig,
} from '@qcqx/lattice-core';
import { registerInitCommand } from '../../src/commands/init';
import { resolveBundledSpecTemplateNames } from '../../src/utils/spec-templates';
import { createCliEnv, runCli, putFile, U, type CliEnv, type CliRunResult } from './helpers';

const prompts = vi.hoisted(() => ({
  input: vi.fn(),
  confirm: vi.fn(),
  checkbox: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: prompts.input,
  confirm: prompts.confirm,
  checkbox: prompts.checkbox,
  select: prompts.select,
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
  await putFile(
    join(latticeHome, 'config', 'config.json'),
    JSON.stringify({
      rag: {
        embedding: {
          allowRemoteModels: false,
          // 隔离真实 ~/.lattice 缓存：DEFAULT_GLOBAL_CONFIG 在模块加载时已求值
          localModelPath: join(latticeHome, 'models'),
          cacheDir: join(latticeHome, '.cache', 'huggingface'),
        },
      },
    }),
  );
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

/** 临时把 stdin 标记为 TTY，用于覆盖交互分支 */
async function withTTY<T>(fn: () => Promise<T>): Promise<T> {
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  try {
    return await fn();
  } finally {
    if (originalIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  }
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'lattice-fake-home-'));
  process.env.HOME = fakeHome;
  for (const dir of ['.claude', '.cursor', '.agents', '.agent', '.codex', '.trae', '.trae-cn']) {
    await mkdir(join(fakeHome, dir), { recursive: true });
  }
  prompts.input.mockReset().mockResolvedValue('promptuser');
  prompts.confirm.mockReset().mockResolvedValue(false);
  prompts.checkbox.mockReset().mockResolvedValue([]);
  prompts.select.mockReset().mockResolvedValue('Xenova/bge-small-zh-v1.5');
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

test('init --model：按预设写入模型、维度与查询前缀并展示生效模型', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run([
    'init',
    '-f',
    '--username',
    'alice',
    '--model',
    'Xenova/all-MiniLM-L6-v2',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Embedding 模型：Xenova\/all-MiniLM-L6-v2（384 维）/);

  const config = await readGlobalConfig();
  assert.equal(config.rag?.embedding?.modelId, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(config.rag?.embedding?.dimension, 384);
  assert.equal(config.rag?.embedding?.queryPrefix, '');
});

test('init --model 自定义：--dimension / 查询与文档前缀直接写入', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run([
    'init',
    '-f',
    '--no-download-model',
    '--username',
    'alice',
    '--model',
    'custom/e5-embedding',
    '--dimension',
    '768',
    '--query-prefix',
    'query: ',
    '--document-prefix',
    'passage: ',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /使用自定义模型参数：custom\/e5-embedding/);

  const config = await readGlobalConfig();
  assert.equal(config.rag?.embedding?.modelId, 'custom/e5-embedding');
  assert.equal(config.rag?.embedding?.dimension, 768);
  assert.equal(config.rag?.embedding?.queryPrefix, 'query: ');
  assert.equal(config.rag?.embedding?.documentPrefix, 'passage: ');
});

test('init 模型参数未配合 --model 时明确报错', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run(['init', '-f', '--dimension', '768', '--builtin-spec-templates', names[0]]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /需要与 --model 一起使用/);
});

test('init 自定义模型未指定维度时拒绝写入', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run([
    'init',
    '-f',
    '--no-download-model',
    '--username',
    'alice',
    '--model',
    'custom/e5-embedding',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /需要同时指定 --dimension/);
});

test('init 切换自定义模型且未指定前缀时清空旧模型前缀', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run([
    'init',
    '-f',
    '--no-download-model',
    '--username',
    'alice',
    '--model',
    'custom/e5-embedding',
    '--dimension',
    '768',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /已清空/);

  const config = await readGlobalConfig();
  assert.equal(config.rag?.embedding?.modelId, 'custom/e5-embedding');
  assert.equal(config.rag?.embedding?.dimension, 768);
  assert.equal(config.rag?.embedding?.queryPrefix, '');
  assert.equal(config.rag?.embedding?.documentPrefix, '');
});

test('init --dimension 与内置预设不一致时提示并允许显式覆盖', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run([
    'init',
    '-f',
    '--no-download-model',
    '--username',
    'alice',
    '--model',
    'Xenova/all-MiniLM-L6-v2',
    '--dimension',
    '512',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /预设维度 384 不一致/);
  assert.equal((await readGlobalConfig()).rag?.embedding?.dimension, 512);
});

test('init --dimension 非法值在写入配置前报错', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run([
    'init',
    '-f',
    '--no-download-model',
    '--username',
    'alice',
    '--model',
    'custom/e5-embedding',
    '--dimension',
    '0',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /无效的 --dimension/);
});

test('init 交互式自定义模型：依次询问维度、查询前缀与文档前缀', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');
  prompts.select.mockResolvedValueOnce('__custom_embedding_model__');
  prompts.input
    .mockResolvedValueOnce('custom/model')
    .mockResolvedValueOnce('640')
    .mockResolvedValueOnce('query: ')
    .mockResolvedValueOnce('passage: ');
  prompts.confirm.mockResolvedValue(false);

  const r = await withTTY(() =>
    run(['init', '--username', 'alice', '--builtin-spec-templates', names[0]]),
  );
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(prompts.input.mock.calls.length, 4);

  const config = await readGlobalConfig();
  assert.equal(config.rag?.embedding?.modelId, 'custom/model');
  assert.equal(config.rag?.embedding?.dimension, 640);
  assert.equal(config.rag?.embedding?.queryPrefix, 'query: ');
  assert.equal(config.rag?.embedding?.documentPrefix, 'passage: ');
});

test('init -f 非交互：无 --username 时回落到系统用户且不弹任何交互', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run(['init', '-f', '--git', 'false', '--builtin-spec-templates', names[0]]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /使用用户名：/);
  assert.equal((await readLocalConfig())?.username, userInfo().username);
  assert.equal(prompts.input.mock.calls.length, 0);
  assert.equal(prompts.select.mock.calls.length, 0);
  assert.equal(prompts.checkbox.mock.calls.length, 0);
  assert.equal(prompts.confirm.mock.calls.length, 0);
});

test('init 非 TTY 且无 -f：自动回落到系统用户并跳过所有确认', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run(['init', '--git', 'false', '--builtin-spec-templates', names[0]]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal((await readLocalConfig())?.username, userInfo().username);
  assert.equal(prompts.input.mock.calls.length, 0);
  assert.equal(prompts.confirm.mock.calls.length, 0);
});

test('init --no-download-model：-f 下跳过下载并提示重建方式', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await run([
    'init',
    '-f',
    '--no-download-model',
    '--username',
    'alice',
    '--git',
    'false',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stdout, /正在下载并预热 embedding 模型/);
  assert.match(r.stdout, /未安装 embedding 模型/);
  assert.match(r.stdout, /ltc rag rebuild/);
  assert.match(r.stdout, /模型状态：未安装（运行 ltc rag rebuild 下载模型并建立索引）/);
});

test('init 交互式模型选择：TTY 下 select 预设并写入配置', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');
  prompts.select.mockResolvedValueOnce('Xenova/all-MiniLM-L6-v2');
  prompts.confirm.mockResolvedValue(false);

  const r = await withTTY(() => run(['init', '--builtin-spec-templates', names[0]]));
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(prompts.select.mock.calls.length, 1);

  const config = await readGlobalConfig();
  assert.equal(config.rag?.embedding?.modelId, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(config.rag?.embedding?.dimension, 384);
});

test('init -f 在 TTY 下也跳过 AI 工具勾选与模型选择', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all');

  const r = await withTTY(() =>
    run([
      'init',
      '-f',
      '--username',
      'alice',
      '--git',
      'false',
      '--builtin-spec-templates',
      names[0],
    ]),
  );
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(prompts.select.mock.calls.length, 0);
  assert.equal(prompts.checkbox.mock.calls.length, 0);
  assert.equal(prompts.confirm.mock.calls.length, 0);
});

test('init --lang en：英文语言包注入并记录到 config/init-meta', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all', 'en');

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

  const specIndex = await readFile(
    join(env.latticeHome, 'templates', 'spec', names[0], 'index.md'),
    'utf-8',
  );
  assert.match(specIndex, /^---\ntitle: /);
  assert.doesNotMatch(specIndex, /[\u4e00-\u9fff]/);
  const manifest = JSON.parse(
    await readFile(join(env.latticeHome, 'templates', 'spec', names[0], 'template.json'), 'utf-8'),
  ) as { description: string };
  assert.match(manifest.description, /API specification template/);
});

test('init --lang zh：中文 spec 模板', async () => {
  env = await createBareEnv(false);
  const names = await resolveBundledSpecTemplateNames('all', 'zh');

  const r = await run([
    'init',
    '-f',
    '--username',
    'alice',
    '--lang',
    'zh',
    '--builtin-spec-templates',
    names[0],
  ]);
  assert.equal(r.exitCode, 0, `${r.stdout}\n${r.stderr}`);

  const specIndex = await readFile(
    join(env.latticeHome, 'templates', 'spec', names[0], 'index.md'),
    'utf-8',
  );
  assert.match(specIndex, /# API 规范总览/);
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
  const prompted = await withTTY(() =>
    run(['init', '--scan-dirs', repo, '--builtin-spec-templates', names[0]]),
  );
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
