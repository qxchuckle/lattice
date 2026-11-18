import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, DB_SCHEMA_VERSION, getDb, initDb, setLatticeMeta } from '../src/db';
import { bindDatabaseDriver, resolveDatabaseDriver } from '../src/db/port';
import type { DatabaseDriverPort, DatabasePort } from '../src/db/port';
import { createTempLatticeHome } from './helpers';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;
let driver: DatabaseDriverPort;

function readValue(db: DatabasePort, query: string): string | undefined {
  const row = db.prepare(query).get() as { value: string } | undefined;
  return row?.value;
}

beforeEach(async () => {
  env = await createTempLatticeHome();
  bindDatabaseDriver(null);
  driver = await resolveDatabaseDriver();
  await initDb();
  getDb().exec(
    "CREATE TABLE runtime_marker(value TEXT); INSERT INTO runtime_marker VALUES ('keep-index')",
  );
  closeDb();
});

afterEach(async () => {
  closeDb();
  bindDatabaseDriver(null);
  await env.cleanup();
});

test('原生 ABI/打开失败：保留健康 DB、WAL、SHM 的全部字节', async () => {
  const file = join(env.latticeHome, '.cache', 'lattice.db');
  const before = await readFile(file);
  await writeFile(file + '-wal', 'wal-must-survive');
  await writeFile(file + '-shm', 'shm-must-survive');
  const error = Object.assign(new Error('NODE_MODULE_VERSION 115 / 137'), {
    code: 'ERR_DLOPEN_FAILED',
  });
  bindDatabaseDriver({
    name: 'abi-mismatch',
    open() {
      throw error;
    },
  });
  await assert.rejects(initDb(), (caught) => caught === error);
  assert.deepEqual(await readFile(file), before);
  assert.equal(await readFile(file + '-wal', 'utf8'), 'wal-must-survive');
  assert.equal(await readFile(file + '-shm', 'utf8'), 'shm-must-survive');
});

test('schema 查询失败：关闭临时连接、保留索引，可恢复后重试', async () => {
  let closed = false;
  const error = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
  bindDatabaseDriver({
    name: 'locked',
    open(file) {
      const db = driver.open(file);
      return {
        prepare() {
          throw error;
        },
        exec: db.exec.bind(db),
        pragma: db.pragma.bind(db),
        transaction: db.transaction.bind(db),
        loadExtension: db.loadExtension.bind(db),
        close() {
          closed = true;
          db.close();
        },
      };
    },
  });
  await assert.rejects(initDb(), (caught) => caught === error);
  assert.equal(closed, true);
  bindDatabaseDriver(driver);
  await initDb();
  assert.equal(readValue(getDb(), 'SELECT value FROM runtime_marker'), 'keep-index');
});

test('未来 schema 拒绝降写，不删除现有索引', async () => {
  await initDb();
  setLatticeMeta('db_schema_version', String(DB_SCHEMA_VERSION + 1));
  closeDb();
  await assert.rejects(initDb(), /高于当前支持/);
  const db = driver.open(join(env.latticeHome, '.cache', 'lattice.db'));
  try {
    assert.equal(readValue(db, 'SELECT value FROM runtime_marker'), 'keep-index');
    assert.equal(
      readValue(db, "SELECT value FROM lattice_meta WHERE key='db_schema_version'"),
      String(DB_SCHEMA_VERSION + 1),
    );
  } finally {
    db.close();
  }
});

test('明确读取到旧 schema 才保留原有迁移行为', async () => {
  await initDb();
  setLatticeMeta('db_schema_version', String(DB_SCHEMA_VERSION - 1));
  closeDb();
  await initDb();
  assert.equal(
    getDb().prepare("SELECT name FROM sqlite_master WHERE name='runtime_marker'").get(),
    undefined,
  );
  assert.equal(
    readValue(getDb(), "SELECT value FROM lattice_meta WHERE key='db_schema_version'"),
    String(DB_SCHEMA_VERSION),
  );
});

test('无法识别的 schema 版本不能当作旧版本删除', async () => {
  await initDb();
  setLatticeMeta('db_schema_version', 'invalid-version');
  closeDb();
  const file = join(env.latticeHome, '.cache', 'lattice.db');
  const before = await readFile(file);
  await assert.rejects(initDb(), /schema 版本无效/);
  assert.deepEqual(await readFile(file), before);
});
