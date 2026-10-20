import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deleteTask,
  getGlobalSpecDir,
  getProjectSpecDir,
  getUserSpecDir,
  initDb,
  listTrashItems,
  unregisterProject,
  updateTask,
  upsertFtsEntry,
  upsertSpecSearchMeta,
} from '@qcqx/lattice-core';
import { registerStatusCommand } from '../../src/commands/status';
import { registerConfigCommand } from '../../src/commands/config';
import { registerTrashCommand } from '../../src/commands/trash';
import { registerRagCommand } from '../../src/commands/rag';
import { registerUserCommand } from '../../src/commands/user';
import { registerFastStartCommand } from '../../src/commands/fast-start';
import { registerContextCommand } from '../../src/commands/context';
import { registerSearchCommand } from '../../src/commands/search';
import { clearCurrentProjectCache } from '../../src/utils/current-project';
import {
  createCliEnv,
  runCli,
  seedProject,
  seedTask,
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

const runStatus = (args: string[]) => runCli(registerStatusCommand, args);
const runConfig = (args: string[]) => runCli(registerConfigCommand, args);
const runTrash = (args: string[]) => runCli(registerTrashCommand, args);
const runRag = (args: string[]) => runCli(registerRagCommand, args);
const runUser = (args: string[]) => runCli(registerUserCommand, args);
const runFastStart = (args: string[]) => runCli(registerFastStartCommand, args);
const runContext = (args: string[]) => runCli(registerContextCommand, args);
const runSearch = (args: string[]) => runCli(registerSearchCommand, args);

function inProject<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(projectDir);
  clearCurrentProjectCache();
  return fn().finally(() => {
    process.chdir(prev);
    clearCurrentProjectCache();
  });
}

test('status：项目内/全局/JSON full/未知项目', async () => {
  const task = await seedTask('状态任务', [ID_A]);
  await initDb();
  await updateTask(U, task.id, { status: 'in_progress' });

  const globalHuman = await runStatus(['status', '--global']);
  assert.equal(globalHuman.exitCode, 0, globalHuman.stderr);
  assert.match(globalHuman.stdout, /用户|项目|任务|全局/);
  const globalJson = await runStatus(['status', '--global', '--json']);
  assert.equal(globalJson.exitCode, 0, globalJson.stderr);

  await inProject(async () => {
    const human = await runStatus(['status']);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /projA|项目|任务/);
    const json = await runStatus(['status', '--json']);
    assert.equal(json.exitCode, 0, json.stderr);
    assert.ok(JSON.stringify(parseCliJson(json)).includes('projA'));
  });

  const outside = await runStatus(['status', '--json']);
  assert.equal(outside.exitCode, 1);
  assert.match(outside.stderr, /不是 Lattice 项目/);
});

test('config：show diff/get unknown/set local/unset 错误', async () => {
  const diff = await runConfig(['config', 'show', '--diff-defaults']);
  assert.equal(diff.exitCode, 0, diff.stderr);
  const human = await runConfig(['config', 'show']);
  assert.equal(human.exitCode, 0, human.stderr);

  const getUnknown = await runConfig(['config', 'get', 'no.such.key']);
  assert.equal(getUnknown.exitCode, 1);
  const setLocal = await runConfig(['config', 'set', 'foo.bar', 'baz', '--scope', 'local']);
  assert.equal(setLocal.exitCode, 0, setLocal.stderr);
  const configPath = join(env.latticeHome, 'config', 'config-local.json');
  assert.match(await readFile(configPath, 'utf-8'), /foo/);
  const gotLocal = await runConfig(['config', 'get', 'foo.bar', '--scope', 'local', '--json']);
  assert.match(gotLocal.stdout, /baz/);
  const unsetLocal = await runConfig(['config', 'unset', 'foo.bar', '--scope', 'local']);
  assert.equal(unsetLocal.exitCode, 0, unsetLocal.stderr);

  const nested = await runConfig(['config', 'set', 'a.b.c', '1', '--scope', 'global']);
  assert.equal(nested.exitCode, 0, nested.stderr);
  const getNested = await runConfig(['config', 'get', 'a.b.c', '--json']);
  assert.match(getNested.stdout, /1/);
  const unsetMissing = await runConfig(['config', 'unset', 'nothing.here', '--scope', 'global']);
  assert.equal(unsetMissing.exitCode, 1);
});

test('trash：空态/类型过滤/项目恢复/未知/清空', async () => {
  const empty = await runTrash(['trash', 'list']);
  assert.match(empty.stdout, /垃圾桶|暂无/);

  const task = await seedTask('回收任务', [ID_A]);
  await initDb();
  await deleteTask(U, task.id);
  await unregisterProject(U, ID_A);

  const human = await runTrash(['trash', 'list']);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /回收任务|projA/);
  const tasks = await runTrash(['trash', 'list', '--type', 'task', '--json']);
  assert.ok(JSON.stringify(parseCliJson(tasks)).includes('回收任务'));
  const projects = await runTrash(['trash', 'list', '--type', 'project', '--json']);
  assert.ok(JSON.stringify(parseCliJson(projects)).includes('projA'));

  const restoreMissing = await runTrash(['trash', 'restore', 'trash-missing', '-f']);
  assert.match(restoreMissing.stdout, /未找到/);
  const purgeMissing = await runTrash(['trash', 'purge', 'trash-missing', '-f']);
  assert.match(purgeMissing.stdout, /未找到/);
  const purgeHint = await runTrash(['trash', 'purge']);
  assert.match(purgeHint.stdout, /请指定/);

  await initDb();
  const items = await listTrashItems();
  const projectItem = items.find((i) => i.type === 'project');
  assert.ok(projectItem);
  const restoreProject = await runTrash(['trash', 'restore', projectItem.id, '-f']);
  assert.equal(restoreProject.exitCode, 0, restoreProject.stderr);

  const purgeAll = await runTrash(['trash', 'purge', '--all', '-f']);
  assert.equal(purgeAll.exitCode, 0, purgeAll.stderr);
  const after = await runTrash(['trash', 'list', '--json']);
  assert.equal(JSON.stringify(parseCliJson(after)).includes('回收任务'), false);
});

test('user：人类输出/重复创建/switch/rename/remove/自身保护', async () => {
  const list = await runUser(['user', 'list']);
  assert.match(list.stdout, /t/);
  const current = await runUser(['user', 'current']);
  assert.match(current.stdout, /t/);

  const created = await runUser(['user', 'create', 'u2']);
  assert.equal(created.exitCode, 0, created.stderr);
  const duplicate = await runUser(['user', 'create', 'u2']);
  assert.match(duplicate.stdout, /已存在/);
  const switched = await runUser(['user', 'switch', 'u2']);
  assert.equal(switched.exitCode, 0, switched.stderr);
  const current2 = await runUser(['user', 'current', '--json']);
  assert.match(current2.stdout, /u2/);
  const back = await runUser(['user', 'switch', U]);
  assert.equal(back.exitCode, 0, back.stderr);

  const renamed = await runUser(['user', 'rename', 'u2', 'u3', '-f']);
  assert.equal(renamed.exitCode, 0, renamed.stderr);
  const removeSelf = await runUser(['user', 'remove', U, '-f']);
  assert.match(removeSelf.stdout, /不能删除当前活跃用户/);
  const removed = await runUser(['user', 'remove', 'u3', '-f']);
  assert.equal(removed.exitCode, 0, removed.stderr);
  const listAfter = await runUser(['user', 'list', '--json']);
  assert.equal(JSON.stringify(parseCliJson(listAfter)).includes('u3'), false);
});

test('fast-start：add/list/search/show/stats/current/空 clear/未知', async () => {
  const add = await runFastStart([
    'fast-start',
    'log',
    'add',
    '深水记录',
    '-m',
    '消息正文',
    '--project',
    ID_A,
    '--files',
    'a.ts',
    '--json',
  ]);
  assert.equal(add.exitCode, 0, add.stderr);
  const addedEntry = parseCliJson(add) as { id: string };
  assert.ok(addedEntry.id);
  const byCwd = await runFastStart([
    'fast-start',
    'log',
    'add',
    '目录记录',
    '-m',
    '目录消息',
    '--cwd',
    projectDir,
  ]);
  assert.equal(byCwd.exitCode, 0, byCwd.stderr);
  assert.match(byCwd.stdout, new RegExp(ID_A));

  const humanList = await runFastStart(['fast-start', 'log', 'list']);
  assert.match(humanList.stdout, /深水记录/);
  const last = await runFastStart(['fast-start', 'log', 'list', '--project', ID_A, '--last', '1']);
  assert.equal(last.exitCode, 0, last.stderr);
  const json = await runFastStart(['fast-start', 'log', 'list', '--project', ID_A, '--json']);
  assert.ok(json.stdout.includes('深水记录'));
  const id = addedEntry.id;

  const shown = await runFastStart(['fast-start', 'log', 'show', id]);
  assert.equal(shown.exitCode, 0, shown.stderr);
  assert.match(shown.stdout, /深水记录/);
  const shownJson = await runFastStart(['fast-start', 'log', 'show', id, '--json']);
  assert.equal(shownJson.exitCode, 0, shownJson.stderr);
  const missingShow = await runFastStart(['fast-start', 'log', 'show', 'fs-missing', '--json']);
  assert.equal(missingShow.exitCode, 1);

  const humanSearch = await runFastStart(['fast-start', 'log', 'search', '深水']);
  assert.match(humanSearch.stdout, /深水记录/);
  const noSearch = await runFastStart(['fast-start', 'log', 'search', '绝不存在zzq', '--json']);
  assert.equal(noSearch.exitCode, 0);

  await inProject(async () => {
    const addCurrent = await runFastStart([
      'fast-start',
      'log',
      'add',
      '项目内记录',
      '-m',
      '项目内消息',
    ]);
    assert.equal(addCurrent.exitCode, 0, addCurrent.stderr);
    const currentList = await runFastStart(['fast-start', 'log', 'list', '--current']);
    assert.match(currentList.stdout, /项目内记录/);
    const currentSearch = await runFastStart([
      'fast-start',
      'log',
      'search',
      '项目内',
      '--current',
    ]);
    assert.match(currentSearch.stdout, /项目内/);
  });

  const stats = await runFastStart(['fast-start', 'log', 'stats']);
  assert.match(stats.stdout, /总条目数/);
  const statsJson = await runFastStart(['fast-start', 'log', 'stats', '--json']);
  assert.equal(statsJson.exitCode, 0, statsJson.stderr);

  const clear = await runFastStart(['fast-start', 'log', 'clear', '-f']);
  assert.match(clear.stdout, /已清空/);
  const clearEmpty = await runFastStart(['fast-start', 'log', 'clear']);
  assert.match(clearEmpty.stdout, /暂无 fast-start 日志/);
});

test('context：项目/任务/查询/JSON/当前用户/未知项目', async () => {
  await putFile(
    join(getGlobalSpecDir(), 'ctx-global.md'),
    '---\nid: spec-ctxg001\ntitle: 全局上下文规范\n---\n\n# 全局\n',
  );
  await putFile(
    join(getUserSpecDir(U), 'ctx-user.md'),
    '---\nid: spec-ctxu001\ntitle: 用户上下文规范\n---\n\n# 用户\n',
  );
  await putFile(
    join(getProjectSpecDir(U, ID_A), 'ctx-proj.md'),
    '---\nid: spec-ctxp001\ntitle: 项目上下文规范\n---\n\n# 项目\n',
  );
  const task = await seedTask('上下文任务', [ID_A]);
  await initDb();
  await updateTask(U, task.id, {
    referencedSpecs: [
      {
        id: 'spec-ctxu001',
        relativePath: 'ctx-user.md',
        scope: 'user',
        firstReadAt: '2026-10-20T00:00:00.000Z',
      },
    ],
  });

  const taskHuman = await runContext(['context', '--task', task.id]);
  assert.equal(taskHuman.exitCode, 0, taskHuman.stderr);
  assert.match(taskHuman.stdout, /任务上下文：上下文任务/);
  assert.match(taskHuman.stdout, /直接关联 Spec（1）/);
  assert.match(taskHuman.stdout, /项目上下文规范/);
  assert.match(taskHuman.stdout, /摘要：/);
  const taskQueryHuman = await runContext(['context', '--task', task.id, '--query', '上下文']);
  assert.equal(taskQueryHuman.exitCode, 0, taskQueryHuman.stderr);
  const missingTask = await runContext(['context', '--task', '2020-01-01-0000-ghos', '--json']);
  assert.equal(missingTask.exitCode, 1);

  const human = await runContext(['context', '--project', ID_A]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /上下文规范|项目上下文/);
  const json = await runContext(['context', '--project', ID_A, '--json']);
  assert.equal(json.exitCode, 0, json.stderr);
  assert.ok(JSON.stringify(parseCliJson(json)).includes('项目上下文规范'));
  const byTask = await runContext(['context', '--task', task.id, '--json']);
  assert.equal(byTask.exitCode, 0, byTask.stderr);
  assert.ok(JSON.stringify(parseCliJson(byTask)).includes(task.id));
  const byQuery = await runContext(['context', '--project', ID_A, '--query', '上下文']);
  assert.equal(byQuery.exitCode, 0, byQuery.stderr);
  const currentUser = await runContext(['context', '--project', ID_A, '--current-user', '--json']);
  assert.equal(currentUser.exitCode, 0, currentUser.stderr);
  const missing = await runContext(['context', '--project', 'legacy:0000000000000000', '--json']);
  assert.equal(missing.exitCode, 1);

  await inProject(async () => {
    const current = await runContext(['context', '--json']);
    assert.equal(current.exitCode, 0, current.stderr);
  });
});

test('search：人类/类型/项目/用户/限额/去重/空结果', async () => {
  await initDb();
  const specPath = join(getGlobalSpecDir(), 'search-deep.md');
  upsertFtsEntry({
    file_path: specPath,
    title: '深水检索标题',
    content: '深水检索内容正文 deepsearch',
    tags: '',
    source_type: 'spec',
    username: U,
    project_id: `|${ID_A}|`,
  });
  upsertSpecSearchMeta({
    filePath: specPath,
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
  const task = await seedTask('深水检索任务', [ID_A]);
  await initDb();

  const human = await runSearch(['search', '深水检索']);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /深水检索/);
  const json = await runSearch(['search', '深水检索', '--json']);
  assert.ok(JSON.stringify(parseCliJson(json)).includes('深水检索标题'));
  for (const type of ['spec', 'task', 'project', 'checkpoint', 'relation']) {
    const typed = await runSearch(['search', '深水检索', '--type', type, '--json']);
    assert.equal(typed.exitCode, 0, `${type}: ${typed.stderr}`);
  }
  const byProject = await runSearch(['search', '深水检索', '--project', ID_A, '--json']);
  assert.equal(byProject.exitCode, 0, byProject.stderr);
  const byUsers = await runSearch(['search', '深水检索', '--users', U, '--json']);
  assert.equal(byUsers.exitCode, 0, byUsers.stderr);
  const currentUser = await runSearch(['search', '深水检索', '--current-user', '--json']);
  assert.equal(currentUser.exitCode, 0, currentUser.stderr);
  const limited = await runSearch([
    'search',
    '深水检索',
    '--limit',
    '1',
    '--spec-limit',
    '1',
    '--task-limit',
    '1',
    '--project-limit',
    '1',
    '--no-rerank',
    '--show-duplicates',
    '--json',
  ]);
  assert.equal(limited.exitCode, 0, limited.stderr);
  const empty = await runSearch(['search', '绝不存在词zzq']);
  assert.equal(empty.exitCode, 0, empty.stderr);
  assert.equal(
    (await runSearch(['search', '深水检索任务', '--type', 'task', '--json'])).exitCode,
    0,
  );
});

test('rag：status 人类输出/update/rebuild 离线链路', async () => {
  await putFile(
    join(getGlobalSpecDir(), 'rag-deep.md'),
    '---\nid: spec-ragd001\ntitle: RAG 深水规范\n---\n\n# RAG\n\n正文',
  );
  const task = await seedTask('RAG 任务', [ID_A]);
  await initDb();
  await updateTask(U, task.id, { status: 'in_progress' });

  const statusHuman = await runRag(['rag', 'status']);
  assert.equal(statusHuman.exitCode, 0, statusHuman.stderr);
  assert.match(statusHuman.stdout, /RAG|索引|模型/i);

  const update = await runRag(['rag', 'update']);
  assert.equal(update.exitCode, 0, update.stderr);
  const update2 = await runRag(['rag', 'update']);
  assert.equal(update2.exitCode, 0, update2.stderr);
  const rebuild = await runRag(['rag', 'rebuild']);
  assert.equal(rebuild.exitCode, 0, rebuild.stderr);
  assert.match(rebuild.stdout, /索引重建完成/);

  await inProject(async () => {
    const updateCurrent = await runRag(['rag', 'update']);
    assert.equal(updateCurrent.exitCode, 0, updateCurrent.stderr);
  });
});
