import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import {
  initDb,
  listTasks,
  listTrashItems,
  deleteTask,
  getUserSpecDir,
  getGlobalSpecDir,
  upsertFtsEntry,
  upsertSpecSearchMeta,
} from '@qcqx/lattice-core';
import { Command } from 'commander';
import { registerStatusCommand } from '../../src/commands/status';
import { registerConfigCommand } from '../../src/commands/config';
import { registerTrashCommand } from '../../src/commands/trash';
import { registerDoctorCommand } from '../../src/commands/doctor';
import { registerRagCommand } from '../../src/commands/rag';
import { registerUserCommand } from '../../src/commands/user';
import { registerFastStartCommand } from '../../src/commands/fast-start';
import { registerContextCommand } from '../../src/commands/context';
import { registerSearchCommand } from '../../src/commands/search';
import {
  createCliEnv,
  runCli,
  seedProject,
  seedTask,
  putFile,
  parseCliJson,
  U,
  ID_A,
  type CliEnv,
  type CliRunResult,
} from './helpers';

/**
 * 系统命令组进程内测试：
 * status / config（show·get·set·unset）/ trash（list·restore·purge）/
 * doctor（--json·--fix）/ rag status / user（list·current·create）/
 * fast-start（add·list·search·clear）/ context / search。
 */

let env: CliEnv;

beforeEach(async () => {
  env = await createCliEnv();
  await seedProject(env, { ids: [ID_A], dirName: 'projA' });
});

afterEach(async () => {
  await env.cleanup();
});

const runWith =
  (register: (program: Command) => void) =>
  (args: string[]): Promise<CliRunResult> =>
    runCli(register, args);

const runStatus = runWith(registerStatusCommand);
const runConfig = runWith(registerConfigCommand);
const runTrash = runWith(registerTrashCommand);
const runDoctor = runWith(registerDoctorCommand);
const runRag = runWith(registerRagCommand);
const runUser = runWith(registerUserCommand);
const runFastStart = runWith(registerFastStartCommand);
const runContext = runWith(registerContextCommand);
const runSearch = runWith(registerSearchCommand);

test('status --global --json：全局统计可解析', async () => {
  const r = await runStatus(['status', '--global', '--json']);
  assert.equal(r.exitCode, 0, r.stderr);
  const parsed = parseCliJson(r) as Record<string, unknown>;
  assert.ok(JSON.stringify(parsed).includes('t') || JSON.stringify(parsed).length > 2);
});

test('config：show --json / get / set / unset 全链路（global 层）', async () => {
  const shown = await runConfig(['config', 'show', '--json']);
  assert.equal(shown.exitCode, 0, shown.stderr);
  const shownConfig = parseCliJson(shown);
  // show 也展示实际生效的 embedding 默认值，而不是只显示显式写入项
  assert.match(JSON.stringify(shownConfig), /Xenova\/bge-small-zh-v1\.5/);
  assert.match(JSON.stringify(shownConfig), /"dimension":512/);

  const got = await runConfig(['config', 'get', 'rag.embedding.allowRemoteModels', '--json']);
  assert.equal(got.exitCode, 0, got.stderr);
  assert.match(got.stdout, /false/);

  // 未显式写入的 embedding 默认值也能读取，避免用户只能通过 rag status 才能看到默认模型
  const defaultModel = await runConfig(['config', 'get', 'rag.embedding.modelId', '--json']);
  assert.equal(defaultModel.exitCode, 0, defaultModel.stderr);
  assert.match(defaultModel.stdout, /Xenova\/bge-small-zh-v1\.5/);
  const defaultDimension = await runConfig(['config', 'get', 'rag.embedding.dimension', '--json']);
  assert.equal(defaultDimension.exitCode, 0, defaultDimension.stderr);
  assert.match(defaultDimension.stdout, /512/);

  // 切换模型时自动同步 dimension/queryPrefix，避免只改 modelId 留下旧参数
  const setModel = await runConfig([
    'config',
    'set',
    'rag.embedding.modelId',
    'Xenova/all-MiniLM-L6-v2',
  ]);
  assert.equal(setModel.exitCode, 0, setModel.stderr);
  assert.match(setModel.stdout, /已同步模型预设/);
  assert.match(setModel.stdout, /Xenova\/all-MiniLM-L6-v2 尚未安装/);
  assert.match(setModel.stdout, /ltc rag rebuild 下载模型并重建索引/);
  const modelDimension = await runConfig(['config', 'get', 'rag.embedding.dimension', '--json']);
  assert.equal(modelDimension.exitCode, 0, modelDimension.stderr);
  assert.match(modelDimension.stdout, /384/);
  const modelPrefix = await runConfig(['config', 'get', 'rag.embedding.queryPrefix', '--json']);
  assert.equal(modelPrefix.exitCode, 0, modelPrefix.stderr);
  assert.match(modelPrefix.stdout, /""/);

  // 重复设置同一模型时保留用户手动调整的 dtype，避免预设覆盖自定义参数
  const setDtype = await runConfig(['config', 'set', 'rag.embedding.dtype', 'fp32']);
  assert.equal(setDtype.exitCode, 0, setDtype.stderr);
  assert.match(setDtype.stdout, /embedding 参数已变更/);
  assert.match(setDtype.stdout, /ltc rag rebuild/);
  const setSameModel = await runConfig([
    'config',
    'set',
    'rag.embedding.modelId',
    'Xenova/all-MiniLM-L6-v2',
  ]);
  assert.equal(setSameModel.exitCode, 0, setSameModel.stderr);
  assert.match(setSameModel.stdout, /模型未变化/);
  const preservedDtype = await runConfig(['config', 'get', 'rag.embedding.dtype', '--json']);
  assert.equal(preservedDtype.exitCode, 0, preservedDtype.stderr);
  assert.match(preservedDtype.stdout, /fp32/);

  const unsetModel = await runConfig([
    'config',
    'unset',
    'rag.embedding.modelId',
    '--scope',
    'global',
  ]);
  assert.equal(unsetModel.exitCode, 0, unsetModel.stderr);
  assert.match(unsetModel.stdout, /回落到默认模型参数/);
  assert.match(unsetModel.stdout, /Xenova\/bge-small-zh-v1\.5 尚未安装/);
  assert.match(unsetModel.stdout, /ltc rag rebuild 下载模型并重建索引/);
  const resetDimension = await runConfig(['config', 'get', 'rag.embedding.dimension', '--json']);
  assert.equal(resetDimension.exitCode, 0, resetDimension.stderr);
  assert.match(resetDimension.stdout, /512/);

  // 手写配置只改了 modelId 时，再次 set 同一模型会补齐缺失的预设参数
  await putFile(
    join(env.latticeHome, 'config', 'config.json'),
    JSON.stringify({ rag: { embedding: { modelId: 'Xenova/all-MiniLM-L6-v2' } } }),
  );
  const repair = await runConfig([
    'config',
    'set',
    'rag.embedding.modelId',
    'Xenova/all-MiniLM-L6-v2',
  ]);
  assert.equal(repair.exitCode, 0, repair.stderr);
  assert.match(repair.stdout, /已补齐缺失参数/);
  const repairedDimension = await runConfig(['config', 'get', 'rag.embedding.dimension', '--json']);
  assert.equal(repairedDimension.exitCode, 0, repairedDimension.stderr);
  assert.match(repairedDimension.stdout, /384/);
  const repairedPrefix = await runConfig(['config', 'get', 'rag.embedding.queryPrefix', '--json']);
  assert.equal(repairedPrefix.exitCode, 0, repairedPrefix.stderr);
  assert.match(repairedPrefix.stdout, /""/);

  // 切换到未知自定义模型时清空旧模型前缀，避免继续沿用 BGE/MiniLM 前缀
  const setCustomModel = await runConfig([
    'config',
    'set',
    'rag.embedding.modelId',
    'custom/model',
  ]);
  assert.equal(setCustomModel.exitCode, 0, setCustomModel.stderr);
  assert.match(setCustomModel.stdout, /清空旧模型前后缀/);
  const customPrefix = await runConfig(['config', 'get', 'rag.embedding.queryPrefix', '--json']);
  assert.equal(customPrefix.exitCode, 0, customPrefix.stderr);
  assert.match(customPrefix.stdout, /""/);

  const emptyModel = await runConfig(['config', 'set', 'rag.embedding.modelId', '']);
  assert.equal(emptyModel.exitCode, 1);
  assert.match(emptyModel.stderr, /模型 ID 不能为空/);

  const nonStringModel = await runConfig(['config', 'set', 'rag.embedding.modelId', '123']);
  assert.equal(nonStringModel.exitCode, 1);
  assert.match(nonStringModel.stderr, /模型 ID 不能为空/);

  const set = await runConfig([
    'config',
    'set',
    'rag.embedding.allowRemoteModels',
    'false',
    '--scope',
    'global',
  ]);
  assert.equal(set.exitCode, 0, set.stderr);
  const configPath = join(env.latticeHome, 'config', 'config.json');
  assert.match(await readFile(configPath, 'utf-8'), /allowRemoteModels/);

  const unset = await runConfig([
    'config',
    'unset',
    'rag.embedding.allowRemoteModels',
    '--scope',
    'global',
  ]);
  assert.equal(unset.exitCode, 0, unset.stderr);
  const after = await readFile(configPath, 'utf-8');
  assert.ok(!after.includes('allowRemoteModels'), `unset 后不应包含该键：${after}`);
});

test('config set 模型：本机覆盖时提示实际生效模型', async () => {
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({
      username: U,
      rag: { embedding: { modelId: 'Xenova/bge-small-zh-v1.5', dimension: 512 } },
    }),
  );

  const r = await runConfig(['config', 'set', 'rag.embedding.modelId', 'Xenova/all-MiniLM-L6-v2']);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /本机配置中的 rag.embedding.modelId 覆盖了本次设置/);
  assert.match(r.stdout, /当前生效：Xenova\/bge-small-zh-v1\.5/);
  assert.match(r.stdout, /模型 Xenova\/bge-small-zh-v1\.5 尚未安装/);
});

test('trash：list --json 可见 / restore 恢复 / purge -f 彻底删除', async () => {
  const task = await seedTask('垃圾桶任务');
  await initDb();
  await deleteTask(U, task.id);

  const list = await runTrash(['trash', 'list', '--json']);
  assert.equal(list.exitCode, 0, list.stderr);
  assert.ok(list.stdout.includes('垃圾桶任务'));

  await initDb();
  const item = (await listTrashItems()).find((i) => i.title === '垃圾桶任务');
  assert.ok(item);

  const restore = await runTrash(['trash', 'restore', item.id, '-f']);
  assert.equal(restore.exitCode, 0, restore.stderr);
  await initDb();
  assert.ok((await listTasks(U)).some((t) => t.id === task.id));

  // 再次删除后 purge
  const task2 = await seedTask('待清空任务');
  await initDb();
  await deleteTask(U, task2.id);
  await initDb();
  const item2 = (await listTrashItems()).find((i) => i.title === '待清空任务');
  assert.ok(item2);
  const purge = await runTrash(['trash', 'purge', item2.id, '-f']);
  assert.equal(purge.exitCode, 0, purge.stderr);
  await initDb();
  assert.ok(!(await listTrashItems()).some((i) => i.id === item2.id));
});

test('doctor --json：隔离 home 报告可解析；doctor --fix 正常', async () => {
  const json = await runDoctor(['doctor', '--json']);
  assert.equal(json.exitCode, 0, json.stderr);
  const parsed = parseCliJson(json);
  assert.ok(JSON.stringify(parsed).includes('Lattice 初始化'));

  const fix = await runDoctor(['doctor', '--fix']);
  assert.equal(fix.exitCode, 0, fix.stderr);
  assert.match(fix.stdout, /Lattice 初始化|修复|healthy|通过/i);
});

test('rag status --json：离线环境可读取状态', async () => {
  const r = await runRag(['rag', 'status', '--json']);
  assert.equal(r.exitCode, 0, r.stderr);
  parseCliJson(r);
});

test('user：list/current/create 全链路', async () => {
  const list = await runUser(['user', 'list', '--json']);
  assert.equal(list.exitCode, 0, list.stderr);
  assert.ok(list.stdout.includes('t'));

  const current = await runUser(['user', 'current', '--json']);
  assert.equal(current.exitCode, 0, current.stderr);
  assert.ok(current.stdout.includes('t'));

  const create = await runUser(['user', 'create', 'u2']);
  assert.equal(create.exitCode, 0, create.stderr);
  const usersDir = join(env.latticeHome, 'users');
  assert.ok((await readdir(usersDir)).includes('u2'));
});

test('fast-start：add/list/search/clear 全链路', async () => {
  const add = await runFastStart([
    'fast-start',
    'log',
    'add',
    '快速记录条目',
    '-m',
    '快速记录消息内容',
    '--project',
    ID_A,
    '--files',
    'a.ts',
    'b.ts',
  ]);
  assert.equal(add.exitCode, 0, add.stderr);

  const list = await runFastStart(['fast-start', 'log', 'list', '--project', ID_A, '--json']);
  assert.equal(list.exitCode, 0, list.stderr);
  assert.ok(list.stdout.includes('快速记录条目'));

  const search = await runFastStart(['fast-start', 'log', 'search', '快速记录', '--json']);
  assert.equal(search.exitCode, 0, search.stderr);
  assert.ok(search.stdout.includes('快速记录条目'));

  const clear = await runFastStart(['fast-start', 'log', 'clear', '-f']);
  assert.equal(clear.exitCode, 0, clear.stderr);

  const after = await runFastStart(['fast-start', 'log', 'list', '--project', ID_A, '--json']);
  assert.ok(!after.stdout.includes('快速记录条目'));
});

test('context --project：聚合输出含用户级 spec；--current-user 可用', async () => {
  await putFile(
    join(getUserSpecDir(U), 'ctx-note.md'),
    [
      '---',
      'title: 上下文聚合规范',
      "updated: '2030-01-01T00:00:00.000Z'",
      '---',
      '# 上下文聚合规范',
      '',
    ].join('\n'),
  );
  const r = await runContext(['context', '--project', ID_A]);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /上下文聚合规范/);

  const cur = await runContext(['context', '--project', ID_A, '--current-user']);
  assert.equal(cur.exitCode, 0, cur.stderr);
});

test('search --json：FTS 语料命中链路（离线语义降级）', async () => {
  await initDb();
  upsertFtsEntry({
    file_path: join(getGlobalSpecDir(), 'search-target.md'),
    title: '检索目标标题',
    content: '检索目标内容正文',
    tags: '',
    source_type: 'spec',
    username: U,
    project_id: '',
  });
  upsertSpecSearchMeta({
    filePath: join(getGlobalSpecDir(), 'search-target.md'),
    docKind: 'spec',
    tags: [],
    headings: [],
    keywords: [],
    titleTerms: [],
    pathTerms: [],
    scopeKey: '',
    scopeTerms: [],
    domainTerms: [],
    metaHash: 'h',
  });

  const r = await runSearch(['search', '检索目标', '--json']);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.ok(r.stdout.includes('检索目标标题'));

  const typed = await runSearch(['search', '检索目标', '--type', 'spec', '--json']);
  assert.equal(typed.exitCode, 0, typed.stderr);
  assert.ok(typed.stdout.includes('检索目标标题'));

  const empty = await runSearch(['search', '绝不存在词zzq', '--json']);
  assert.equal(empty.exitCode, 0, empty.stderr);
});
