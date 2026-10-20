import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addLogEntry,
  clearAllLogs,
  getLogEntry,
  getLogStats,
  getWritableFileCreatedAt,
  listLogEntries,
  searchLogEntries,
} from '../src/fast-start-log';
import { getFastStartLogDir, getFastStartLogFilePath } from '../src/paths';
import { createTempLatticeHome, putFile } from './helpers';

const U = 't';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  await env.cleanup();
});

async function add(title: string, message: string, extra: Record<string, unknown> = {}) {
  return addLogEntry(U, {
    title,
    message,
    cwd: '/work/project',
    ...extra,
  });
}

test('fast-start-log：空目录的读/搜/统计/清空', async () => {
  assert.deepEqual(await listLogEntries(U), []);
  assert.deepEqual(await searchLogEntries(U, { query: 'x' }), []);
  assert.equal(await getLogEntry(U, 'fs_missing'), null);
  assert.equal(await clearAllLogs(U), 0);
  assert.deepEqual(await getLogStats(U), {
    totalEntries: 0,
    fileCount: 0,
    latestFileName: null,
    latestFileCreatedAt: null,
    latestFileEntries: 0,
  });
});

test('addLogEntry：trim、可选字段与列表过滤', async () => {
  const first = await add('  初始化  ', '  第一条  ', {
    projectId: 'p1',
    projectName: '项目一',
    files: ['a.ts'],
  });
  assert.equal(first.title, '初始化');
  assert.equal(first.message, '第一条');
  assert.deepEqual(first.files, ['a.ts']);
  assert.match(first.id, /^fs_[0-9a-f]{8}$/);

  const second = await add('第二条', '内容', { files: [] });
  assert.equal(second.files, undefined, '空 files 不写字段');

  const third = await add('第三条', '内容二', { projectId: 'p2' });

  const all = await listLogEntries(U);
  assert.deepEqual(
    all.map((e) => e.title),
    ['初始化', '第二条', '第三条'],
  );
  assert.deepEqual(
    (await listLogEntries(U, { projectId: 'p1' })).map((e) => e.title),
    ['初始化'],
  );
  assert.deepEqual(
    (await listLogEntries(U, { last: 2 })).map((e) => e.title),
    ['第二条', '第三条'],
  );
  assert.equal((await listLogEntries(U, { last: 0 })).length, 3);
  assert.equal((await listLogEntries(U, { last: -1 })).length, 3);
  assert.equal(third.projectId, 'p2');
});

test('searchLogEntries：title/message/cwd/files 命中、大小写与过滤', async () => {
  await add('Alpha', 'first message', { files: ['src/Foo.ts'], projectId: 'p1' });
  await add('beta', 'SECOND', { cwd: '/work/Gamma', projectId: 'p2' });
  await add('other', 'nothing', { projectId: 'p2' });

  assert.deepEqual(
    (await searchLogEntries(U, { query: 'alpha' })).map((e) => e.title),
    ['Alpha'],
  );
  assert.deepEqual(
    (await searchLogEntries(U, { query: 'second' })).map((e) => e.title),
    ['beta'],
  );
  assert.deepEqual(
    (await searchLogEntries(U, { query: 'gamma' })).map((e) => e.title),
    ['beta'],
  );
  assert.deepEqual(
    (await searchLogEntries(U, { query: 'foo.ts' })).map((e) => e.title),
    ['Alpha'],
  );
  assert.equal((await searchLogEntries(U, { query: '   ' })).length, 0);

  const p2 = await searchLogEntries(U, { query: 'o', projectId: 'p2' });
  assert.deepEqual(
    p2.map((e) => e.title),
    ['other', 'beta'],
    '默认按时间倒序',
  );
  assert.deepEqual(
    (await searchLogEntries(U, { query: 'o', projectId: 'p2', last: 1 })).map((e) => e.title),
    ['other'],
  );
});

test('getLogEntry / clearAllLogs / getLogStats', async () => {
  const a = await add('a', '1');
  const b = await add('b', '2');

  assert.equal((await getLogEntry(U, a.id))?.title, 'a');
  assert.equal((await getLogEntry(U, b.id))?.title, 'b');

  const stats = await getLogStats(U);
  assert.equal(stats.totalEntries, 2);
  assert.equal(stats.fileCount, 1);
  assert.equal(stats.latestFileEntries, 2);
  assert.match(stats.latestFileName ?? '', /^log-.*\.yaml$/);
  assert.ok(stats.latestFileCreatedAt);

  assert.equal(await clearAllLogs(U), 1);
  assert.deepEqual(await listLogEntries(U), []);
});

test('getWritableFileCreatedAt：空/未满/已满/坏文件', async () => {
  const createdAt = '2026-01-01T00:00:00.000Z';
  const filePath = getFastStartLogFilePath(U, createdAt);
  await putFile(filePath, JSON.stringify({ createdAt, entries: [{ id: 'fs_00000001' }] }));
  assert.equal(await getWritableFileCreatedAt(U), createdAt);

  const full = Array.from({ length: 1000 }, (_, i) => ({
    id: `fs_${String(i).padStart(8, '0')}`,
    time: createdAt,
    title: 't',
    message: 'm',
    cwd: '/',
  }));
  await writeFile(filePath, JSON.stringify({ createdAt, entries: full }), 'utf-8');
  const next = await getWritableFileCreatedAt(U);
  assert.notEqual(next, createdAt, '满文件应分配新 createdAt');
  assert.ok(next > createdAt);

  // 坏 YAML：读不到文件 → 返回新的时间戳
  await writeFile(join(getFastStartLogDir(U), 'log-9999.yaml'), ':::not-yaml', 'utf-8');
  const malformed = await getWritableFileCreatedAt(U);
  assert.ok(malformed);
});
