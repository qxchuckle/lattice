import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'node:fs';
import type {
  ProjectRow,
  ProjectMeta,
  ProjectFingerprintRow,
  ProjectDirRow,
  TaskProjectRow,
  SearchDocumentMeta,
  SearchDocumentType,
} from '../types';
import {
  getDbPath,
  ensureDir,
  getCacheDir,
  getUserProjectsDir,
  listDir,
  listUserDirs,
  readJSON,
} from '../paths';
import { selectPrimaryId, resolveProjectIds, normalizeProjectMeta } from '../project/identity';

let _db: Database.Database | null = null;

/**
 * DB schema 版本号。当 schema 发生不兼容变更（如主键变化）时递增。
 * v1: projects 表以 id 为单列主键（同一 project ID 仅一行）
 * v2: projects 表改为 (id, username) 复合主键（同一 project 允许多用户）
 * v3: 多 ID 策略 — project_fingerprints 表复用存储 key='project_id' 的行；
 *     旧版评分指纹不再使用，项目识别改为精确 ID 匹配
 * v4: 新增 project_dirs 表 — 记录每个 primaryId 下的物理目录实例，
 *     解决多个物理目录 primaryId 相同导致 DB 只有一行、虚拟合并无法发现关联目录的问题
 */
export const DB_SCHEMA_VERSION = 4;
const DB_SCHEMA_VERSION_KEY = 'db_schema_version';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  description TEXT,
  git_remote TEXT,
  git_first_commit TEXT,
  git_default_branch TEXT,
  package_names TEXT,
  monorepo_packages TEXT,
  groups TEXT,
  tags TEXT,
  username TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT,
  PRIMARY KEY (id, username)
);

CREATE TABLE IF NOT EXISTS project_fingerprints (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  weight INTEGER NOT NULL,
  PRIMARY KEY (project_id, key, value)
);

CREATE INDEX IF NOT EXISTS idx_fingerprints_project ON project_fingerprints(project_id);
CREATE INDEX IF NOT EXISTS idx_fingerprints_kv ON project_fingerprints(key, value);

CREATE TABLE IF NOT EXISTS task_projects (
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (task_id, project_id)
);

-- 物理目录实例表：记录每个 primaryId 下有哪些物理目录
-- 解决多个物理目录 primaryId 相同导致 projects 表只有一行的问题
CREATE TABLE IF NOT EXISTS project_dirs (
  project_id TEXT NOT NULL,
  username TEXT NOT NULL,
  dir_name TEXT NOT NULL,
  PRIMARY KEY (project_id, username, dir_name)
);

-- Embedding 存储表（支持标题分片，一个文件可对应多个 chunk）
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  heading_path TEXT NOT NULL DEFAULT '',
  heading_level INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'spec',
  title TEXT,
  username TEXT,
  project_id TEXT,
  vector_indexed INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated TEXT
);

CREATE TABLE IF NOT EXISTS spec_search_meta (
  file_path TEXT PRIMARY KEY,
  doc_kind TEXT NOT NULL,
  tags TEXT NOT NULL,
  headings TEXT NOT NULL,
  keywords TEXT NOT NULL,
  title_terms TEXT NOT NULL DEFAULT '[]',
  path_terms TEXT NOT NULL DEFAULT '[]',
  scope_key TEXT NOT NULL DEFAULT '',
  scope_terms TEXT NOT NULL DEFAULT '[]',
  domain_terms TEXT NOT NULL DEFAULT '[]',
  updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lattice_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_username ON projects(username);
CREATE INDEX IF NOT EXISTS idx_projects_local_path ON projects(local_path);
CREATE INDEX IF NOT EXISTS idx_task_projects_task ON task_projects(task_id);
CREATE INDEX IF NOT EXISTS idx_task_projects_project ON task_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_project_dirs_lookup ON project_dirs(project_id, username);
CREATE INDEX IF NOT EXISTS idx_embeddings_file_path ON embeddings(file_path);
CREATE INDEX IF NOT EXISTS idx_spec_search_meta_doc_kind ON spec_search_meta(doc_kind);
`;

/**
 * FTS 写入时使用的索引版本。
 * 升版动机：v1 用 unicode61 直接写入 content，对中文几乎不分词；
 * v2 在写入前对 title/content/tags 追加中文 bigram/trigram，让 unicode61
 *    也能命中中文 query（query 端已生成同样的 ngram）——但这也让 snippet 输出容易被污染。
 * v3 拆出独立 `ngram` 列：title/content/tags 列保持原文，ngram 单独存放，
 *    snippet/highlight 只面向 content 原文，输出不再夹带“状态 态管 管理”类噪声。
 * 升版后必须 rag rebuild 一次旧库才能用上新 schema，doctor / rag update
 * 会通过 lattice_meta 检测并提示用户。
 */
export const FTS_INDEX_VERSION = 3;
const FTS_INDEX_VERSION_KEY = 'fts_index_version';

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('数据库未初始化，请先调用 initDb()');
  }
  return _db;
}

const FTS_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS specs_fts USING fts5(
  file_path,
  title,
  content,
  tags,
  source_type,
  username,
  project_id,
  ngram,
  tokenize='unicode61'
);
`;

/**
 * 检测实际存在的 specs_fts 是否含有 v3 新增的 `ngram` 列，
 * 若不含（老索引）则 DROP 后重建。FTS5 虚拟表不支持 ALTER ADD COLUMN，
 * 只能 DROP+CREATE；DROP 后会丢弃原有 FTS 索引数据，
 * 需要调用方（doctor / rag update）提示用户运行 rag rebuild 重新填充。
 */
function ensureSpecsFtsSchema(db: Database.Database): void {
  try {
    const cols = db.prepare("PRAGMA table_info('specs_fts')").all() as { name: string }[];
    if (cols.length === 0) return; // 表尚不存在，后续 FTS_SCHEMA_SQL 会创建
    const hasNgram = cols.some((c) => c.name === 'ngram');
    if (!hasNgram) {
      db.exec('DROP TABLE IF EXISTS specs_fts');
    }
  } catch {
    // FTS 不可用，静默
  }
}

function normalizeSearchType(type?: SearchDocumentType): string {
  return type ?? '';
}

function buildProjectFilterPattern(projectId?: string): string {
  return projectId ? `%|${projectId}|%` : '';
}

function normalizeSearchUsers(usernames?: string[]): string[] {
  return Array.from(new Set((usernames ?? []).map((username) => username.trim()).filter(Boolean)));
}

function ensureEmbeddingsSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('embeddings')").all() as { name: string }[];
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('vector_indexed')) {
    db.exec('ALTER TABLE embeddings ADD COLUMN vector_indexed INTEGER NOT NULL DEFAULT 0');
  }

  if (!columnNames.has('updated')) {
    db.exec('ALTER TABLE embeddings ADD COLUMN updated TEXT');
  }

  // 标题分片相关列
  if (!columnNames.has('chunk_index')) {
    db.exec('ALTER TABLE embeddings ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnNames.has('heading_path')) {
    db.exec("ALTER TABLE embeddings ADD COLUMN heading_path TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has('heading_level')) {
    db.exec('ALTER TABLE embeddings ADD COLUMN heading_level INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnNames.has('parent_id')) {
    db.exec('ALTER TABLE embeddings ADD COLUMN parent_id TEXT');
  }
  if (!columnNames.has('content')) {
    db.exec("ALTER TABLE embeddings ADD COLUMN content TEXT NOT NULL DEFAULT ''");
  }
}

function ensureProjectsSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('git_first_commit')) {
    db.exec('ALTER TABLE projects ADD COLUMN git_first_commit TEXT');
  }
  if (!columnNames.has('git_default_branch')) {
    db.exec('ALTER TABLE projects ADD COLUMN git_default_branch TEXT');
  }
  if (!columnNames.has('package_names')) {
    db.exec('ALTER TABLE projects ADD COLUMN package_names TEXT');
  }
  if (!columnNames.has('monorepo_packages')) {
    db.exec('ALTER TABLE projects ADD COLUMN monorepo_packages TEXT');
  }
}

/**
 * 清理历史遗留的 project_relations 缓存表。
 * 该表自 v?.? 起被废弃：项目关系完全以 relations.json 为真源，db 中不再缓存。
 * 旧版本数据库可能仍保留该表与索引，这里做一次性 DROP，无需保留数据（真源在 relations.json）。
 */
function dropLegacyProjectRelations(db: Database.Database): void {
  try {
    db.exec('DROP INDEX IF EXISTS uq_relations_triple');
    db.exec('DROP INDEX IF EXISTS idx_relations_a');
    db.exec('DROP INDEX IF EXISTS idx_relations_b');
    db.exec('DROP TABLE IF EXISTS project_relations');
  } catch {
    // 旧表不存在或不可清理，静默
  }
}

function ensureSpecSearchMetaSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('spec_search_meta')").all() as { name: string }[];
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('title_terms')) {
    db.exec("ALTER TABLE spec_search_meta ADD COLUMN title_terms TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columnNames.has('path_terms')) {
    db.exec("ALTER TABLE spec_search_meta ADD COLUMN path_terms TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columnNames.has('scope_key')) {
    db.exec("ALTER TABLE spec_search_meta ADD COLUMN scope_key TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has('scope_terms')) {
    db.exec("ALTER TABLE spec_search_meta ADD COLUMN scope_terms TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columnNames.has('domain_terms')) {
    db.exec("ALTER TABLE spec_search_meta ADD COLUMN domain_terms TEXT NOT NULL DEFAULT '[]'");
  }
}

/**
 * 检测数据库 schema 版本，如果是旧版本则删除数据库文件以触发重建。
 * 返回 true 表示需要回填数据（全新 DB 或 schema 升级）。
 */
function checkAndMigrateDbSchema(): boolean {
  const dbPath = getDbPath();
  // 全新 DB：需要回填数据
  if (!existsSync(dbPath)) return true;

  let tempDb: Database.Database | null = null;
  try {
    tempDb = new Database(dbPath);

    // 检查 lattice_meta 表是否存在
    const hasMetaTable = tempDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lattice_meta'")
      .get() as { name: string } | undefined;

    if (hasMetaTable) {
      const row = tempDb
        .prepare(`SELECT value FROM lattice_meta WHERE key = ?`)
        .get(DB_SCHEMA_VERSION_KEY) as { value: string } | undefined;
      const currentVersion = row ? Number.parseInt(row.value, 10) : 0;
      if (currentVersion >= DB_SCHEMA_VERSION) {
        tempDb.close();
        tempDb = null;
        return false; // 版本已是最新
      }
      // 版本号低于当前版本 → 重建
    }
    // 没有 lattice_meta 表 或 版本号过低 → 重建
    tempDb.close();
    tempDb = null;
    unlinkSync(dbPath);
    // 同时删除 WAL/SHM 文件
    try {
      unlinkSync(`${dbPath}-wal`);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(`${dbPath}-shm`);
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    // 数据库损坏或其他错误，直接删除重建
    if (tempDb) {
      try {
        tempDb.close();
      } catch {
        /* ignore */
      }
    }
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(`${dbPath}-wal`);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(`${dbPath}-shm`);
    } catch {
      /* ignore */
    }
    return true;
  }
}

/**
 * 从文件系统重建 projects 表缓存。
 * 扫描 ~/.lattice/users/{user}/projects/{dir}/project.json 并逐条写入 DB。
 * v3: 同时为每个项目计算 ids 并写入 project_fingerprints key='project_id' 行。
 */
export async function rebuildProjectsCache(): Promise<void> {
  let usernames: string[];
  try {
    usernames = await listUserDirs();
  } catch {
    return;
  }

  for (const username of usernames) {
    let projectDirs: string[];
    try {
      projectDirs = await listDir(getUserProjectsDir(username));
    } catch {
      continue;
    }

    for (const dirName of projectDirs) {
      if (dirName.startsWith('.')) continue;
      try {
        const metaPath = `${getUserProjectsDir(username)}/${dirName}/project.json`;
        const rawMeta = await readJSON<ProjectMeta>(metaPath);
        if (!rawMeta) continue;
        const meta = normalizeProjectMeta(rawMeta);
        // normalizeProjectMeta 已处理兼容性，直接用 meta.ids
        const primaryId = selectPrimaryId(meta.ids);
        if (!primaryId) continue;
        upsertProject({
          id: primaryId,
          name: meta.name,
          local_path: JSON.stringify(meta.localPaths ?? []),
          description: meta.description ?? null,
          git_remote:
            meta.gitRemotes && meta.gitRemotes.length > 0 ? JSON.stringify(meta.gitRemotes) : null,
          git_first_commit: meta.gitFirstCommit ?? null,
          git_default_branch: meta.gitDefaultBranch ?? null,
          package_names:
            meta.packageNames && meta.packageNames.length > 0
              ? JSON.stringify(meta.packageNames)
              : null,
          monorepo_packages:
            meta.monorepoPackages && meta.monorepoPackages.length > 0
              ? JSON.stringify(meta.monorepoPackages)
              : null,
          groups: meta.groups ? JSON.stringify(meta.groups) : null,
          tags: meta.tags ? JSON.stringify(meta.tags) : null,
          username,
          created: meta.created,
          updated: meta.updated ?? null,
        });

        // v3: 写入 key='project_id' 的 fingerprints 行
        for (const id of meta.ids) {
          upsertFingerprint({
            project_id: primaryId,
            key: 'project_id',
            value: id,
            weight: 0,
          });
        }

        // v4: 写入 project_dirs 物理目录记录
        upsertProjectDir(primaryId, username, dirName);
      } catch {
        continue;
      }
    }
  }
}

export async function initDb(): Promise<Database.Database> {
  if (_db) return _db;
  await ensureDir(getCacheDir());

  // 检测旧 schema，如需重建则删除旧文件
  const rebuilt = checkAndMigrateDbSchema();

  _db = new Database(getDbPath());
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA_SQL);
  ensureEmbeddingsSchema(_db);
  ensureSpecSearchMetaSchema(_db);
  ensureProjectsSchema(_db);
  dropLegacyProjectRelations(_db);

  // lattice_meta（在 FTS schema 之前确保存在）
  try {
    _db.exec(
      `CREATE TABLE IF NOT EXISTS lattice_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated TEXT
      );`,
    );
  } catch {
    // ignore
  }

  // 写入当前 schema 版本号
  setLatticeMeta(DB_SCHEMA_VERSION_KEY, String(DB_SCHEMA_VERSION));

  // FTS5 全文索引：升级场景下需要先 DROP 老表才能重建出新列
  try {
    ensureSpecsFtsSchema(_db);
    _db.exec(FTS_SCHEMA_SQL);
  } catch {
    // FTS5 不可用时静默跳过
  }

  // sqlite-vec 向量表（如果扩展可用）
  try {
    _db.loadExtension('vec0');
  } catch {
    // sqlite-vec 扩展不可用时尝试 npm 包
    try {
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(_db);
    } catch {
      // sqlite-vec 不可用，跳过向量搜索功能
    }
  }

  try {
    _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384]
      );
    `);
    // 记录初始维度（首次创建）
    if (!getLatticeMeta('vec_dimension')) {
      setLatticeMeta('vec_dimension', '384');
    }
  } catch {
    // vec0 不可用时跳过
  }

  // 如果发生了 schema 重建，触发项目数据重建
  if (rebuilt) {
    await rebuildProjectsCache();
    // 标记需要 rag rebuild（上层启动时检查并执行）
    setLatticeMeta('rag_rebuild_needed', 'true');
  }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    // WAL checkpoint：把 WAL 数据写回主 DB 文件，防止下次只读打开时看不到数据
    try {
      _db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore
    }
    _db.close();
    _db = null;
  }
}

/**
 * 确保向量表维度与配置一致。维度不匹配时 DROP + CREATE。
 * 返回 true 表示维度发生了变化（调用方需 rag rebuild）。
 */
export function ensureVecStoreDimension(dimension: number): boolean {
  const stored = getLatticeMeta('vec_dimension');
  const currentDim = stored ? parseInt(stored, 10) : 384;
  if (currentDim === dimension) return false;

  try {
    const db = getDb();
    db.exec('DROP TABLE IF EXISTS vec_embeddings');
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[${dimension}]
      );
    `);
    // 维度变更后旧向量已丢失，重置 vector_indexed 标记，确保 checkEmbeddingFreshness 触发重新生成
    db.prepare('UPDATE embeddings SET vector_indexed = 0').run();
    setLatticeMeta('vec_dimension', String(dimension));
    return true;
  } catch {
    // vec0 不可用或 DROP/CREATE 失败
    return false;
  }
}

// ─── 项目 CRUD ───

export function upsertProject(row: ProjectRow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO projects (
       id, name, local_path, description, git_remote, git_first_commit, git_default_branch,
       package_names, monorepo_packages, groups, tags, username, created, updated
     )
     VALUES (
       @id, @name, @local_path, @description, @git_remote, @git_first_commit, @git_default_branch,
       @package_names, @monorepo_packages, @groups, @tags, @username, @created, @updated
     )
     ON CONFLICT(id, username) DO UPDATE SET
       name = @name, local_path = @local_path, description = @description,
       git_remote = @git_remote,
       git_first_commit = @git_first_commit,
       git_default_branch = @git_default_branch,
       package_names = @package_names,
       monorepo_packages = @monorepo_packages,
       groups = @groups, tags = @tags,
       updated = @updated`,
  ).run(row);
}

export function deleteProject(id: string, username?: string): void {
  const db = getDb();
  if (username) {
    db.prepare('DELETE FROM projects WHERE id = ? AND username = ?').run(id, username);
  } else {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
  // 仅在删除全部用户记录时清理关联数据（如果指定 username，需要判断是否还有其他用户引用）
  const remaining = db.prepare('SELECT COUNT(*) as cnt FROM projects WHERE id = ?').get(id) as {
    cnt: number;
  };
  if (remaining.cnt === 0) {
    db.prepare('DELETE FROM task_projects WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM project_fingerprints WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM project_dirs WHERE project_id = ?').run(id);
  } else if (username) {
    // 指定 username 删除时，只清理该用户的 project_dirs 记录
    db.prepare('DELETE FROM project_dirs WHERE project_id = ? AND username = ?').run(id, username);
  }
}

export function getProjectById(id: string): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ? LIMIT 1').get(id) as
    | ProjectRow
    | undefined;
}

/**
 * 查询同一 project ID 在所有用户下的记录（跨用户聚合）。
 */
export function listProjectRowsById(id: string): ProjectRow[] {
  return getDb()
    .prepare('SELECT * FROM projects WHERE id = ? ORDER BY username')
    .all(id) as ProjectRow[];
}

/**
 * 按本地路径查找项目。
 * local_path 列现为 JSON 数组字符串，使用 LIKE 模式包含匹配。
 */
export function getProjectByPath(localPath: string): ProjectRow | undefined {
  const needle = JSON.stringify(localPath);
  return getDb()
    .prepare(`SELECT * FROM projects WHERE local_path LIKE '%' || ? || '%' LIMIT 1`)
    .get(needle) as ProjectRow | undefined;
}

export function listAllProjects(username?: string): ProjectRow[] {
  if (username) {
    return getDb()
      .prepare('SELECT * FROM projects WHERE username = ? ORDER BY name')
      .all(username) as ProjectRow[];
  }
  return getDb().prepare('SELECT * FROM projects ORDER BY name').all() as ProjectRow[];
}

// ─── 项目关系：已移除 db 缓存 ───
// relations 完全以 relations.json 为真源，db 不再缓存任何关系数据。
// 历史遗留表会在 initDb() 中由 dropLegacyProjectRelations() 清理。

// ─── 项目指纹 CRUD ───

export function upsertFingerprint(row: ProjectFingerprintRow): void {
  getDb()
    .prepare(
      `INSERT INTO project_fingerprints (project_id, key, value, weight)
       VALUES (@project_id, @key, @value, @weight)
       ON CONFLICT(project_id, key, value) DO UPDATE SET weight = @weight`,
    )
    .run(row);
}

export function deleteFingerprintsByProject(projectId: string): void {
  getDb().prepare('DELETE FROM project_fingerprints WHERE project_id = ?').run(projectId);
}

export function listFingerprintsByProject(projectId: string): ProjectFingerprintRow[] {
  return getDb()
    .prepare('SELECT * FROM project_fingerprints WHERE project_id = ?')
    .all(projectId) as ProjectFingerprintRow[];
}

export function findProjectsByFingerprint(key: string, value: string): ProjectFingerprintRow[] {
  return getDb()
    .prepare('SELECT * FROM project_fingerprints WHERE key = ? AND value = ?')
    .all(key, value) as ProjectFingerprintRow[];
}

export function findProjectsByFingerprintKeyPrefix(
  key: string,
  valuePrefix: string,
): ProjectFingerprintRow[] {
  return getDb()
    .prepare(`SELECT * FROM project_fingerprints WHERE key = ? AND value LIKE ? || '%'`)
    .all(key, valuePrefix) as ProjectFingerprintRow[];
}

// ─── 项目物理目录实例 CRUD ───

/** 插入或忽略物理目录记录（同一 project_id + username + dir_name 只存一行） */
export function upsertProjectDir(projectId: string, username: string, dirName: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO project_dirs (project_id, username, dir_name) VALUES (?, ?, ?)')
    .run(projectId, username, dirName);
}

/** 查询某个 project_id 在某用户下的所有物理目录名 */
export function listProjectDirs(projectId: string, username: string): ProjectDirRow[] {
  return getDb()
    .prepare('SELECT * FROM project_dirs WHERE project_id = ? AND username = ?')
    .all(projectId, username) as ProjectDirRow[];
}

/** 删除某个物理目录记录（取消注册时） */
export function deleteProjectDir(projectId: string, username: string, dirName: string): void {
  getDb()
    .prepare('DELETE FROM project_dirs WHERE project_id = ? AND username = ? AND dir_name = ?')
    .run(projectId, username, dirName);
}

// ─── 任务-项目关联 CRUD ───

export function linkTaskProject(taskId: string, projectId: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO task_projects (task_id, project_id) VALUES (?, ?)')
    .run(taskId, projectId);
}

export function unlinkTaskProject(taskId: string, projectId: string): void {
  getDb()
    .prepare('DELETE FROM task_projects WHERE task_id = ? AND project_id = ?')
    .run(taskId, projectId);
}

export function getTasksForProject(projectId: string): string[] {
  const rows = getDb()
    .prepare('SELECT task_id FROM task_projects WHERE project_id = ?')
    .all(projectId) as TaskProjectRow[];
  return rows.map((r) => r.task_id);
}

export function deleteTaskLinks(taskId: string): void {
  getDb().prepare('DELETE FROM task_projects WHERE task_id = ?').run(taskId);
}

export function listTaskProjectLinks(): TaskProjectRow[] {
  return getDb().prepare('SELECT task_id, project_id FROM task_projects').all() as TaskProjectRow[];
}

// ─── lattice_meta KV ───

export function getLatticeMeta(key: string): string | null {
  try {
    const row = getDb().prepare('SELECT value FROM lattice_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setLatticeMeta(key: string, value: string): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO lattice_meta (key, value, updated)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = datetime('now')`,
      )
      .run(key, value);
  } catch {
    // ignore
  }
}

export function getFtsIndexVersion(): number {
  const value = getLatticeMeta(FTS_INDEX_VERSION_KEY);
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function setFtsIndexVersion(version: number): void {
  setLatticeMeta(FTS_INDEX_VERSION_KEY, String(version));
}

// ─── FTS5 全文索引 CRUD ───

/**
 * 把中文连续片段拆成 bigram + trigram，用空格连接。
 * 例："前端开发规范" → "前端 端开 开发 发规 规范 前端开 端开发 开发规 发规范"
 * 这样 unicode61 tokenizer 也能把它们识别为可独立索引的 token，
 * 配合 query 端的同款 ngram，让中文查询能在 FTS rank 里出现。
 */
/**
 * 仅生成中文 bigram/trigram 拼接串（以空格分隔）。
 * unicode61 tokenizer 看到的就是带空格的 token 流，与 query 端
 * buildQueryVariants 产出的同款 ngram 双向对齐。
 */
function toChineseNgramString(text: string): string {
  if (!text) return '';
  const segments = text.match(/\p{Script=Han}+/gu);
  if (!segments) return '';
  const grams: string[] = [];
  for (const segment of segments) {
    if (segment.length < 2) continue;
    const maxGram = Math.min(3, segment.length);
    for (let size = 2; size <= maxGram; size++) {
      for (let i = 0; i <= segment.length - size; i++) {
        grams.push(segment.slice(i, i + size));
      }
    }
  }
  return grams.join(' ');
}

/**
 * 从 title + content + tags 三者合成一份中文 ngram 串，
 * 供写入 specs_fts.ngram 列专用。不会被 snippet/highlight 读到，
 * 这样 CLI 输出仍是干净原文。
 */
function buildFtsNgramField(title: string, content: string, tags: string): string {
  const parts = [
    toChineseNgramString(title),
    toChineseNgramString(content),
    toChineseNgramString(tags),
  ].filter(Boolean);
  return parts.join(' ');
}

export function upsertFtsEntry(entry: {
  file_path: string;
  title: string;
  content: string;
  tags: string;
  source_type: string;
  username: string;
  project_id: string;
}): void {
  const db = getDb();
  try {
    db.prepare('DELETE FROM specs_fts WHERE file_path = ?').run(entry.file_path);
    db.prepare(
      `INSERT INTO specs_fts (file_path, title, content, tags, source_type, username, project_id, ngram)
       VALUES (@file_path, @title, @content, @tags, @source_type, @username, @project_id, @ngram)`,
    ).run({
      ...entry,
      ngram: buildFtsNgramField(entry.title, entry.content, entry.tags),
    });
  } catch {
    // FTS 不可用
  }
}

export function deleteFtsEntry(filePath: string): void {
  try {
    getDb().prepare('DELETE FROM specs_fts WHERE file_path = ?').run(filePath);
  } catch {
    // FTS 不可用
  }
}

export function searchFts(
  query: string,
  limit = 10,
  opts?: { type?: SearchDocumentType; projectId?: string; usernames?: string[] },
): {
  file_path: string;
  title: string;
  snippet: string;
  rank: number;
  source_type: SearchDocumentType;
  username: string;
  project_id: string;
}[] {
  const sourceType = normalizeSearchType(opts?.type);
  const projectFilter = buildProjectFilterPattern(opts?.projectId);
  const usernames = normalizeSearchUsers(opts?.usernames);
  const usernamePlaceholders = usernames.map(() => '?').join(', ');
  const usernameClause =
    usernames.length > 0
      ? `AND (coalesce(username, '') = '' OR username IN (${usernamePlaceholders}))`
      : '';
  try {
    return getDb()
      .prepare(
        `SELECT file_path, title, source_type, username, project_id,
                snippet(specs_fts, 2, '**', '**', '...', 32) as snippet,
                rank
         FROM specs_fts
         WHERE specs_fts MATCH ?
           AND (? = '' OR source_type = ?)
           AND (? = '' OR project_id LIKE ?)
           ${usernameClause}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, sourceType, sourceType, projectFilter, projectFilter, ...usernames, limit) as {
      file_path: string;
      title: string;
      snippet: string;
      rank: number;
      source_type: SearchDocumentType;
      username: string;
      project_id: string;
    }[];
  } catch {
    return [];
  }
}

export function upsertSpecSearchMeta(meta: SearchDocumentMeta): void {
  getDb()
    .prepare(
      `INSERT INTO spec_search_meta (
         file_path, doc_kind, tags, headings, keywords, title_terms, path_terms, scope_key, scope_terms, domain_terms, updated
       )
       VALUES (
         @file_path, @doc_kind, @tags, @headings, @keywords, @title_terms, @path_terms, @scope_key, @scope_terms, @domain_terms, datetime('now')
       )
       ON CONFLICT(file_path) DO UPDATE SET
         doc_kind = @doc_kind,
         tags = @tags,
         headings = @headings,
         keywords = @keywords,
         title_terms = @title_terms,
         path_terms = @path_terms,
         scope_key = @scope_key,
         scope_terms = @scope_terms,
         domain_terms = @domain_terms,
         updated = datetime('now')`,
    )
    .run({
      file_path: meta.filePath,
      doc_kind: meta.docKind,
      tags: JSON.stringify(meta.tags),
      headings: JSON.stringify(meta.headings),
      keywords: JSON.stringify(meta.keywords),
      title_terms: JSON.stringify(meta.titleTerms),
      path_terms: JSON.stringify(meta.pathTerms),
      scope_key: meta.scopeKey,
      scope_terms: JSON.stringify(meta.scopeTerms),
      domain_terms: JSON.stringify(meta.domainTerms),
    });
}

export function getSpecSearchMeta(filePath: string): SearchDocumentMeta | null {
  const row = getDb()
    .prepare(
      `SELECT file_path, doc_kind, tags, headings, keywords, title_terms, path_terms, scope_key, scope_terms, domain_terms
       FROM spec_search_meta
       WHERE file_path = ?`,
    )
    .get(filePath) as
    | {
        file_path: string;
        doc_kind: SearchDocumentMeta['docKind'];
        tags: string;
        headings: string;
        keywords: string;
        title_terms: string;
        path_terms: string;
        scope_key: string;
        scope_terms: string;
        domain_terms: string;
      }
    | undefined;

  if (!row) return null;

  return {
    filePath: row.file_path,
    docKind: row.doc_kind,
    tags: JSON.parse(row.tags) as string[],
    headings: JSON.parse(row.headings) as string[],
    keywords: JSON.parse(row.keywords) as string[],
    titleTerms: JSON.parse(row.title_terms) as string[],
    pathTerms: JSON.parse(row.path_terms) as string[],
    scopeKey: row.scope_key,
    scopeTerms: JSON.parse(row.scope_terms) as string[],
    domainTerms: JSON.parse(row.domain_terms) as string[],
  };
}

export function deleteSpecSearchMeta(filePath: string): void {
  getDb().prepare('DELETE FROM spec_search_meta WHERE file_path = ?').run(filePath);
}

export function searchSpecsFallback(
  query: string,
  limit = 10,
  opts?: { type?: SearchDocumentType; projectId?: string; usernames?: string[] },
): {
  file_path: string;
  title: string;
  snippet: string;
  rank: number;
  source_type: SearchDocumentType;
  username: string;
  project_id: string;
}[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const compact = normalized.replace(/\s+/g, '');
  const like = `%${normalized}%`;
  const sourceType = normalizeSearchType(opts?.type);
  const projectFilter = buildProjectFilterPattern(opts?.projectId);
  const usernames = normalizeSearchUsers(opts?.usernames);
  const usernamePlaceholders = usernames.map(() => '?').join(', ');
  const usernameClause =
    usernames.length > 0
      ? `AND (coalesce(username, '') = '' OR username IN (${usernamePlaceholders}))`
      : '';

  try {
    return getDb()
      .prepare(
        `SELECT file_path,
                title,
                source_type,
                username,
                project_id,
                substr(content, 1, 160) as snippet,
                (
                  CASE
                    WHEN lower(title) = ? THEN 100
                    WHEN replace(lower(title), ' ', '') = ? THEN 95
                    ELSE 0
                  END +
                  CASE WHEN lower(title) LIKE ? THEN 40 ELSE 0 END +
                  CASE WHEN lower(tags) LIKE ? THEN 25 ELSE 0 END +
                  CASE WHEN lower(content) LIKE ? THEN 10 ELSE 0 END
                ) as rank
         FROM specs_fts
         WHERE (
               lower(title) = ?
            OR replace(lower(title), ' ', '') = ?
            OR lower(title) LIKE ?
            OR lower(tags) LIKE ?
            OR lower(content) LIKE ?
         )
           AND (? = '' OR source_type = ?)
           AND (? = '' OR project_id LIKE ?)
           ${usernameClause}
         ORDER BY rank DESC, length(title) ASC
         LIMIT ?`,
      )
      .all(
        normalized,
        compact,
        like,
        like,
        like,
        normalized,
        compact,
        like,
        like,
        like,
        sourceType,
        sourceType,
        projectFilter,
        projectFilter,
        ...usernames,
        limit,
      ) as {
      file_path: string;
      title: string;
      snippet: string;
      rank: number;
      source_type: SearchDocumentType;
      username: string;
      project_id: string;
    }[];
  } catch {
    return [];
  }
}

// ─── Embedding CRUD ───

export function upsertEmbedding(entry: {
  id: string;
  file_path: string;
  content_hash: string;
  source_type: string;
  title: string;
  username: string;
  project_id: string;
  vector_indexed: number;
  chunk_index?: number;
  heading_path?: string;
  heading_level?: number;
  parent_id?: string | null;
  content?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO embeddings (
         id, file_path, content_hash, source_type, title, username, project_id, vector_indexed,
         chunk_index, heading_path, heading_level, parent_id, content,
         created, updated
       )
       VALUES (
         @id, @file_path, @content_hash, @source_type, @title, @username, @project_id, @vector_indexed,
         @chunk_index, @heading_path, @heading_level, @parent_id, @content,
         datetime('now'), datetime('now')
       )
       ON CONFLICT(id) DO UPDATE SET
         file_path = @file_path,
         content_hash = @content_hash,
         source_type = @source_type,
         title = @title,
         username = @username,
         project_id = @project_id,
         vector_indexed = @vector_indexed,
         chunk_index = @chunk_index,
         heading_path = @heading_path,
         heading_level = @heading_level,
         parent_id = @parent_id,
         content = @content,
         updated = datetime('now')`,
    )
    .run({
      chunk_index: 0,
      heading_path: '',
      heading_level: 0,
      parent_id: null,
      content: '',
      ...entry,
    });
}

export function getEmbeddingByPath(
  filePath: string,
): { id: string; content_hash: string; vector_indexed: number } | undefined {
  return getDb()
    .prepare('SELECT id, content_hash, vector_indexed FROM embeddings WHERE file_path = ? LIMIT 1')
    .get(filePath) as { id: string; content_hash: string; vector_indexed: number } | undefined;
}

/** 获取文件的所有 chunk embedding 记录 */
export function getEmbeddingsByFilePath(filePath: string): {
  id: string;
  chunk_index: number;
  content_hash: string;
  vector_indexed: number;
  heading_path: string;
  heading_level: number;
  content: string;
}[] {
  return getDb()
    .prepare(
      'SELECT id, chunk_index, content_hash, vector_indexed, heading_path, heading_level, content FROM embeddings WHERE file_path = ? ORDER BY chunk_index',
    )
    .all(filePath) as {
    id: string;
    chunk_index: number;
    content_hash: string;
    vector_indexed: number;
    heading_path: string;
    heading_level: number;
    content: string;
  }[];
}

/** 删除文件的所有 chunk embedding */
export function deleteEmbeddingsByFilePath(filePath: string): void {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM embeddings WHERE file_path = ?').all(filePath) as {
    id: string;
  }[];
  for (const row of rows) {
    deleteVecEmbedding(row.id);
  }
  db.prepare('DELETE FROM embeddings WHERE file_path = ?').run(filePath);
}

/** 更新文件所有 chunk 的元数据（title/username/project_id），不重新生成向量 */
export function updateEmbeddingMetadataByFilePath(
  filePath: string,
  title: string,
  username: string,
  projectId: string,
): void {
  getDb()
    .prepare(
      `UPDATE embeddings SET title = ?, username = ?, project_id = ?, updated = datetime('now') WHERE file_path = ?`,
    )
    .run(title, username, projectId, filePath);
}

export function getEmbeddingRowsByIds(ids: string[]): {
  id: string;
  file_path: string;
  source_type: SearchDocumentType;
  title: string;
  username: string;
  project_id: string;
  chunk_index: number;
  heading_path: string;
  heading_level: number;
  content: string;
}[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return getDb()
    .prepare(
      `SELECT id, file_path, source_type, title, username, project_id,
              chunk_index, heading_path, heading_level, content
       FROM embeddings
       WHERE id IN (${placeholders})`,
    )
    .all(...ids) as {
    id: string;
    file_path: string;
    source_type: SearchDocumentType;
    title: string;
    username: string;
    project_id: string;
    chunk_index: number;
    heading_path: string;
    heading_level: number;
    content: string;
  }[];
}

export function deleteSearchDocumentsByPrefixes(prefixes: string[]): void {
  const normalized = Array.from(new Set(prefixes.map((prefix) => prefix.trim()).filter(Boolean)));
  if (normalized.length === 0) return;

  const likeParams = normalized.map((prefix) => `${prefix}%`);
  const whereClause = normalized.map(() => 'file_path LIKE ?').join(' OR ');
  const rows = getDb()
    .prepare(`SELECT id FROM embeddings WHERE ${whereClause}`)
    .all(...likeParams) as { id: string }[];

  for (const row of rows) {
    deleteEmbedding(row.id);
  }

  try {
    getDb()
      .prepare(`DELETE FROM specs_fts WHERE ${whereClause}`)
      .run(...likeParams);
  } catch {
    // FTS 不可用
  }
  getDb()
    .prepare(`DELETE FROM spec_search_meta WHERE ${whereClause}`)
    .run(...likeParams);
}

export function listIndexedDocumentPaths(): string[] {
  const paths = new Set<string>();

  const embeddingRows = getDb().prepare('SELECT DISTINCT file_path FROM embeddings').all() as {
    file_path: string;
  }[];
  for (const row of embeddingRows) {
    if (row.file_path) paths.add(row.file_path);
  }

  const metaRows = getDb().prepare('SELECT DISTINCT file_path FROM spec_search_meta').all() as {
    file_path: string;
  }[];
  for (const row of metaRows) {
    if (row.file_path) paths.add(row.file_path);
  }

  try {
    const ftsRows = getDb().prepare('SELECT DISTINCT file_path FROM specs_fts').all() as {
      file_path: string;
    }[];
    for (const row of ftsRows) {
      if (row.file_path) paths.add(row.file_path);
    }
  } catch {
    // FTS 不可用
  }

  return Array.from(paths);
}

export function deleteEmbedding(id: string): void {
  getDb().prepare('DELETE FROM embeddings WHERE id = ?').run(id);
  deleteVecEmbedding(id);
}

export function deleteVecEmbedding(id: string): void {
  try {
    getDb().prepare('DELETE FROM vec_embeddings WHERE id = ?').run(id);
  } catch {
    // vec 不可用
  }
}

export function upsertVecEmbedding(id: string, embedding: Float32Array): void {
  try {
    getDb()
      .prepare('INSERT OR REPLACE INTO vec_embeddings (id, embedding) VALUES (?, ?)')
      .run(id, Buffer.from(embedding.buffer));
  } catch {
    // vec 不可用
  }
}

export function searchVec(embedding: Float32Array, limit = 10): { id: string; distance: number }[] {
  try {
    return getDb()
      .prepare(
        `SELECT id, distance
         FROM vec_embeddings
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(Buffer.from(embedding.buffer), limit) as { id: string; distance: number }[];
  } catch {
    return [];
  }
}

/** 获取 chunk/doc 统计，用于动态调整搜索候选量 */
export function getChunkStats(): { totalChunks: number; totalDocs: number } {
  try {
    const row = getDb()
      .prepare('SELECT COUNT(*) as chunks, COUNT(DISTINCT file_path) as docs FROM embeddings')
      .get() as { chunks: number; docs: number };
    return { totalChunks: row.chunks, totalDocs: row.docs };
  } catch {
    return { totalChunks: 0, totalDocs: 0 };
  }
}

export function countEmbeddings(): number {
  try {
    const row = getDb()
      .prepare('SELECT COUNT(DISTINCT file_path) as count FROM embeddings')
      .get() as {
      count: number;
    };
    return row.count;
  } catch {
    return 0;
  }
}

export function countVectorEmbeddings(): number {
  try {
    const row = getDb()
      .prepare('SELECT COUNT(*) as count FROM embeddings WHERE vector_indexed = 1')
      .get() as {
      count: number;
    };
    return row.count;
  } catch {
    return 0;
  }
}

export function isVecStoreReady(): boolean {
  try {
    const row = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_embeddings'")
      .get() as { name?: string } | undefined;
    return row?.name === 'vec_embeddings';
  } catch {
    return false;
  }
}

export function getLatestEmbeddingUpdate(): string | null {
  try {
    const row = getDb()
      .prepare('SELECT COALESCE(MAX(updated), MAX(created)) as last_updated FROM embeddings')
      .get() as {
      last_updated: string | null;
    };
    return row.last_updated;
  } catch {
    return null;
  }
}
