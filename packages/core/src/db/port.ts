/**
 * 数据库端口：core 内部只依赖这组接口，具体 SQLite 驱动由宿主绑定/探测。
 *
 * 多端背景：
 * - CLI / web 宿主：better-sqlite3（预编译原生模块，FTS5 有保证）——行为不变。
 * - VSCode 扩展宿主：原生模块 ABI 不匹配（Electron），改用运行时内置的 node:sqlite（Electron ≥35）。
 * 上层业务代码（db/index.ts 及以上）完全共享，差异收口在这里。
 */
export interface PreparedStatementPort {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface DatabasePort {
  prepare(sql: string): PreparedStatementPort;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  /**
   * 返回一个"在事务中执行 fn"的包装函数（better-sqlite3 语义：调用返回的函数才真正执行）。
   * node:sqlite 用 BEGIN/COMMIT/ROLLBACK 模拟。
   */
  transaction<T>(fn: () => T): () => T;
  /** 加载 SQLite 扩展（如 sqlite-vec）；驱动不支持时应抛错，调用方自行降级。 */
  loadExtension(path: string): void;
  close(): void;
}

export interface DatabaseDriverPort {
  readonly name: string;
  open(file: string): DatabasePort;
}

let _driver: DatabaseDriverPort | null = null;

/**
 * node:sqlite 说明符写成运行时常量：打包器（esbuild/vite）对字面量 `import('node:sqlite')`
 * 会做 node: 前缀重写（target 较老时不识别该内置模块），导致运行时解析失败；变量形式可绕开。
 */
const NODE_SQLITE_SPECIFIER = 'node:sqlite';

/** 宿主显式绑定数据库驱动（扩展激活时绑定 node:sqlite）；传 null 恢复自动探测。 */
export function bindDatabaseDriver(driver: DatabaseDriverPort | null): void {
  _driver = driver;
}

export function getBoundDatabaseDriver(): DatabaseDriverPort | null {
  return _driver;
}

/**
 * 解析数据库驱动：已绑定优先；否则自动探测 better-sqlite3（CLI/web/测试）→ node:sqlite（扩展宿主）。
 * 两者都不可用时抛错（调用方决定是否降级）。
 */
export async function resolveDatabaseDriver(): Promise<DatabaseDriverPort> {
  if (_driver) return _driver;
  const { createBetterSqlite3Driver, createNodeSqliteDriver } = await import('./drivers');
  try {
    const mod = (await import('better-sqlite3')) as { default?: unknown };
    const Database = mod.default ?? mod;
    _driver = createBetterSqlite3Driver(Database);
    return _driver;
  } catch {
    // better-sqlite3 不可用（如 VSCode 扩展宿主），继续探测
  }
  const mod = await import(NODE_SQLITE_SPECIFIER);
  _driver = createNodeSqliteDriver(mod);
  return _driver;
}

/**
 * 显式使用 node:sqlite 驱动（VSCode 扩展宿主调用；避免扩展里尝试加载 better-sqlite3）。
 * 返回是否成功（老运行时可能没有 node:sqlite）。
 */
export async function useNodeSqliteDriver(): Promise<boolean> {
  if (_driver) return true;
  try {
    const mod = await import(NODE_SQLITE_SPECIFIER);
    const { createNodeSqliteDriver } = await import('./drivers');
    _driver = createNodeSqliteDriver(mod);
    return true;
  } catch {
    return false;
  }
}
