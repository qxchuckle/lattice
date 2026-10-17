/**
 * SQLite 驱动适配器（无静态 import：宿主能力由 resolveDatabaseDriver / useNodeSqliteDriver 注入）。
 *
 * - createBetterSqlite3Driver：CLI / web / 测试（预编译原生模块，含 FTS5）
 * - createNodeSqliteDriver：VSCode 扩展宿主（Electron 内置 node:sqlite，免 rebuild）
 *
 * 兼容性归一：
 * - undefined → null（两个驱动都不能直接绑定 undefined；better-sqlite3 会静默转 NULL，node:sqlite 会报错）
 * - boolean → 0/1（node:sqlite 不接受 boolean 绑定）
 */
import type { DatabaseDriverPort, DatabasePort, PreparedStatementPort } from './port';

function normalizeParams(params: unknown[]): unknown[] {
  return params.map((param) => {
    if (param === undefined) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    return param;
  });
}

function toRunResult(result: { changes?: unknown; lastInsertRowid?: unknown }): {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
} {
  return {
    changes: (result.changes ?? 0) as number | bigint,
    lastInsertRowid: (result.lastInsertRowid ?? 0) as number | bigint,
  };
}

// ── better-sqlite3 ──

class BetterSqlite3Statement implements PreparedStatementPort {
  constructor(
    private readonly stmt: {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes?: unknown; lastInsertRowid?: unknown };
    },
  ) {}

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...normalizeParams(params));
  }

  get(...params: unknown[]): unknown {
    return this.stmt.get(...normalizeParams(params));
  }

  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return toRunResult(this.stmt.run(...normalizeParams(params)));
  }
}

class BetterSqlite3Database implements DatabasePort {
  constructor(private readonly db: any) {}

  prepare(sql: string): PreparedStatementPort {
    return new BetterSqlite3Statement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(sql: string): unknown {
    return this.db.pragma(sql);
  }

  transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn) as () => T;
  }

  loadExtension(path: string): void {
    this.db.loadExtension(path);
  }

  close(): void {
    this.db.close();
  }
}

export function createBetterSqlite3Driver(Database: unknown): DatabaseDriverPort {
  const Ctor = Database as new (file: string) => any;
  return {
    name: 'better-sqlite3',
    open: (file) => new BetterSqlite3Database(new Ctor(file)),
  };
}

// ── node:sqlite（Node 22.5+ / Electron 35+ 内置）──

/** 从 SQL 中提取命名参数集合（@name / :name / $name）。 */
function extractNamedParams(sql: string): Set<string> {
  const params = new Set<string>();
  const pattern = /[@$:]([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null = pattern.exec(sql);
  while (match) {
    params.add(match[1]);
    match = pattern.exec(sql);
  }
  return params;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

class NodeSqliteStatement implements PreparedStatementPort {
  private readonly namedParams: Set<string>;

  constructor(
    private readonly stmt: {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes?: unknown; lastInsertRowid?: unknown };
      setAllowBareNamedParameters?(enabled: boolean): void;
    },
    sql: string,
  ) {
    this.namedParams = extractNamedParams(sql);
    try {
      // Node 22.12+：允许对象键使用裸名（与 better-sqlite3 语义对齐）
      this.stmt.setAllowBareNamedParameters?.(true);
    } catch {
      // 老版本不支持时忽略（下方仍会按裸名过滤）
    }
  }

  /** node:sqlite 对象绑定必须"零多余键"（better-sqlite3 宽容忽略）；这里按 SQL 参数集过滤。 */
  private bindParams(params: unknown[]): unknown[] {
    if (params.length === 1 && isPlainObject(params[0])) {
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params[0])) {
        const bare = /^[@$:]/.test(key) ? key.slice(1) : key;
        if (this.namedParams.has(bare)) filtered[key] = value;
      }
      return [filtered];
    }
    return normalizeParams(params);
  }

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...this.bindParams(params));
  }

  get(...params: unknown[]): unknown {
    return this.stmt.get(...this.bindParams(params));
  }

  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return toRunResult(this.stmt.run(...this.bindParams(params)));
  }
}

class NodeSqliteDatabase implements DatabasePort {
  private readonly db: any;

  constructor(DatabaseSync: any, file: string) {
    this.db = new DatabaseSync(file);
    try {
      this.db.exec('PRAGMA busy_timeout = 5000');
    } catch {
      // busy_timeout 不受支持时忽略
    }
  }

  prepare(sql: string): PreparedStatementPort {
    return new NodeSqliteStatement(this.db.prepare(sql), sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(sql: string): unknown {
    try {
      return this.db.prepare(`PRAGMA ${sql}`).get();
    } catch {
      this.db.exec(`PRAGMA ${sql}`);
      return undefined;
    }
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.exec('BEGIN');
      try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // 回滚失败时保留原始错误
        }
        throw error;
      }
    };
  }

  loadExtension(path: string): void {
    if (typeof this.db.enableLoadExtension === 'function') {
      this.db.enableLoadExtension(true);
    }
    if (typeof this.db.loadExtension === 'function') {
      this.db.loadExtension(path);
      return;
    }
    throw new Error('node:sqlite build does not support loadExtension');
  }

  close(): void {
    this.db.close();
  }
}

export function createNodeSqliteDriver(sqliteModule: unknown): DatabaseDriverPort {
  const DatabaseSync = (sqliteModule as { DatabaseSync?: unknown }).DatabaseSync;
  if (typeof DatabaseSync !== 'function') {
    throw new Error('node:sqlite module has no DatabaseSync export');
  }
  return {
    name: 'node:sqlite',
    open: (file) => new NodeSqliteDatabase(DatabaseSync, file),
  };
}
