import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createBetterSqlite3Driver, createNodeSqliteDriver } from '../src/db/drivers';

test('better-sqlite3 驱动：参数归一化/事务/extension/close', () => {
  const calls: unknown[][] = [];
  class FakeStmt {
    constructor(private readonly sql: string) {}
    all(...params: unknown[]) {
      calls.push(['all', this.sql, params]);
      return ['row'];
    }
    get(...params: unknown[]) {
      calls.push(['get', this.sql, params]);
      return { value: 1 };
    }
    run(...params: unknown[]) {
      calls.push(['run', this.sql, params]);
      return this.sql === 'empty' ? {} : { changes: 2, lastInsertRowid: 9 };
    }
  }
  class FakeDb {
    constructor(readonly file: string) {}
    prepare(sql: string) {
      return new FakeStmt(sql);
    }
    exec(sql: string) {
      calls.push(['exec', sql]);
    }
    pragma(sql: string) {
      calls.push(['pragma', sql]);
      return 'ok';
    }
    transaction(fn: () => unknown) {
      return () => {
        calls.push(['tx']);
        return fn();
      };
    }
    loadExtension(p: string) {
      calls.push(['load', p]);
    }
    close() {
      calls.push(['close']);
    }
  }

  const driver = createBetterSqlite3Driver(FakeDb);
  assert.equal(driver.name, 'better-sqlite3');
  const db = driver.open('/tmp/x.db');
  assert.deepEqual(db.prepare('q').all(undefined, true, false), ['row']);
  assert.deepEqual(calls[0][2], [null, 1, 0]);
  assert.deepEqual(db.prepare('q').get(undefined), { value: 1 });
  assert.deepEqual(calls[1][2], [null]);
  assert.deepEqual(db.prepare('q').run(), { changes: 2, lastInsertRowid: 9 });
  assert.deepEqual(db.prepare('empty').run(), { changes: 0, lastInsertRowid: 0 });

  db.exec('CREATE');
  assert.deepEqual(calls.at(-1), ['exec', 'CREATE']);
  assert.equal(db.pragma('journal_mode'), 'ok');
  assert.equal(db.transaction(() => 42)(), 42);
  db.loadExtension('/ext');
  assert.deepEqual(calls.at(-1), ['load', '/ext']);
  db.close();
  assert.deepEqual(calls.at(-1), ['close']);
});

test('node:sqlite 驱动：命名参数过滤/bare 开关/定位参数归一化', () => {
  class FakeStmt {
    params: unknown[] = [];
    allowBare: boolean | undefined;
    constructor(readonly sql: string) {}
    setAllowBareNamedParameters(v: boolean) {
      this.allowBare = v;
    }
    all(...params: unknown[]) {
      this.params = params;
      return ['n'];
    }
    get(...params: unknown[]) {
      this.params = params;
      return { x: 1 };
    }
    run(...params: unknown[]) {
      this.params = params;
      return this.sql === 'empty' ? {} : { changes: 3, lastInsertRowid: 4 };
    }
  }

  const prepared: FakeStmt[] = [];
  class FakeNodeDatabase {
    execCalls: string[] = [];
    constructor(readonly file: string) {}
    exec(sql: string) {
      this.execCalls.push(sql);
    }
    prepare(sql: string) {
      const stmt = new FakeStmt(sql);
      prepared.push(stmt);
      return stmt;
    }
    close() {
      // noop
    }
  }

  const driver = createNodeSqliteDriver({ DatabaseSync: FakeNodeDatabase });
  assert.equal(driver.name, 'node:sqlite');
  const db = driver.open('/tmp/n.db');
  const stmt = db.prepare('SELECT @a, :b, $c') as unknown as {
    all(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  assert.equal(prepared[0].allowBare, true);
  stmt.all({ a: 1, '@a': 2, b: 3, c: 4, d: 5 });
  assert.deepEqual(prepared[0].params, [{ a: 1, '@a': 2, b: 3, c: 4 }]);

  stmt.all(undefined, true, false);
  assert.deepEqual(prepared[0].params, [null, 1, 0]);

  assert.deepEqual(stmt.get(), { x: 1 });
  assert.deepEqual(stmt.run(), { changes: 3, lastInsertRowid: 4 });
  assert.deepEqual(db.prepare('empty').run(), { changes: 0, lastInsertRowid: 0 });
});

test('node:sqlite 驱动：pragma 回退/事务提交与回滚/extension/close', () => {
  const events: string[] = [];
  class FakeStmt {
    constructor(private readonly _sql: string) {}
    setAllowBareNamedParameters() {
      // old version: optional hook exists
    }
    get() {
      return { pragma: true };
    }
    close() {
      events.push('close');
    }
  }
  class FakeDatabase {
    static last: FakeDatabase;
    enableCalls: boolean[] = [];
    loadExtensionCalls: string[] = [];
    constructor(readonly file: string) {
      FakeDatabase.last = this;
    }
    exec(sql: string) {
      events.push(sql);
    }
    prepare(sql: string) {
      if (sql.includes('rolling_journal')) throw new Error('pragma unsupported');
      return new FakeStmt(sql);
    }
    enableLoadExtension(v: boolean) {
      this.enableCalls.push(v);
    }
    loadExtension(p: string) {
      this.loadExtensionCalls.push(p);
    }
    close() {
      events.push('close');
    }
  }

  const driver = createNodeSqliteDriver({ DatabaseSync: FakeDatabase });
  const db = driver.open('/tmp/p.db');
  assert.deepEqual(db.pragma('journal_mode'), { pragma: true });
  assert.equal(db.pragma('rolling_journal'), undefined);
  assert.ok(events.includes('PRAGMA rolling_journal'));

  events.length = 0;
  assert.equal(db.transaction(() => 7)(), 7);
  assert.deepEqual(events, ['BEGIN', 'COMMIT']);

  events.length = 0;
  assert.throws(
    () =>
      db.transaction(() => {
        throw new Error('tx fail');
      })(),
    /tx fail/,
  );
  assert.deepEqual(events, ['BEGIN', 'ROLLBACK']);

  db.loadExtension('/ext');
  assert.deepEqual(FakeDatabase.last.enableCalls, [true]);
  assert.deepEqual(FakeDatabase.last.loadExtensionCalls, ['/ext']);
  db.close();
  assert.ok(events.includes('close'));

  // 不支持 loadExtension 的实现 → 明确报错
  class NoExtDatabase {
    constructor(readonly file: string) {}
    exec() {}
    prepare() {
      return new FakeStmt('x');
    }
    close() {}
  }
  const noExt = createNodeSqliteDriver({ DatabaseSync: NoExtDatabase }).open('/tmp/no.db');
  assert.throws(() => noExt.loadExtension('/x'), /does not support/);
});

test('node:sqlite 驱动：busy_timeout 不支持时静默忽略；旧 stmt 无 bare 开关', () => {
  class OldStmt {
    all() {
      return [];
    }
    get() {
      return {};
    }
    run() {
      return { changes: 1, lastInsertRowid: 2 };
    }
  }
  class BusyFailDatabase {
    constructor(readonly file: string) {}
    exec(sql: string) {
      if (sql.includes('busy_timeout')) throw new Error('unsupported');
    }
    prepare() {
      return new OldStmt();
    }
    close() {}
  }

  const db = createNodeSqliteDriver({ DatabaseSync: BusyFailDatabase }).open('/tmp/b.db');
  assert.deepEqual(db.prepare('x').all(), []);
  assert.deepEqual(db.prepare('x').get(), {});
  assert.deepEqual(db.prepare('x').run(), { changes: 1, lastInsertRowid: 2 });
});
