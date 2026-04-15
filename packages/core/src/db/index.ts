import Database from 'better-sqlite3';
import type {
  ProjectRow,
  ProjectRelationRow,
  TaskProjectRow,
  SearchDocumentMeta,
  SearchDocumentType,
} from '../types';
import { getDbPath, ensureDir, getCacheDir } from '../paths';

let _db: Database.Database | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  description TEXT,
  git_remote TEXT,
  groups TEXT,
  tags TEXT,
  username TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT
);

CREATE TABLE IF NOT EXISTS project_relations (
  project_a TEXT NOT NULL,
  project_b TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (project_a, project_b)
);

CREATE TABLE IF NOT EXISTS task_projects (
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (task_id, project_id)
);

-- Embedding 存储表
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_projects_username ON projects(username);
CREATE INDEX IF NOT EXISTS idx_projects_local_path ON projects(local_path);
CREATE INDEX IF NOT EXISTS idx_task_projects_task ON task_projects(task_id);
CREATE INDEX IF NOT EXISTS idx_task_projects_project ON task_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_file_path ON embeddings(file_path);
CREATE INDEX IF NOT EXISTS idx_spec_search_meta_doc_kind ON spec_search_meta(doc_kind);
`;

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
  tokenize='unicode61'
);
`;

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

export async function initDb(): Promise<Database.Database> {
  if (_db) return _db;
  await ensureDir(getCacheDir());
  _db = new Database(getDbPath());
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA_SQL);
  ensureEmbeddingsSchema(_db);
  ensureSpecSearchMetaSchema(_db);

  // FTS5 全文索引
  try {
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
  } catch {
    // vec0 不可用时跳过
  }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ─── 项目 CRUD ───

export function upsertProject(row: ProjectRow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO projects (id, name, local_path, description, git_remote, groups, tags, username, created, updated)
     VALUES (@id, @name, @local_path, @description, @git_remote, @groups, @tags, @username, @created, @updated)
     ON CONFLICT(id) DO UPDATE SET
       name = @name, local_path = @local_path, description = @description,
       git_remote = @git_remote, groups = @groups, tags = @tags,
       updated = @updated`,
  ).run(row);
}

export function deleteProject(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  db.prepare('DELETE FROM project_relations WHERE project_a = ? OR project_b = ?').run(id, id);
  db.prepare('DELETE FROM task_projects WHERE project_id = ?').run(id);
}

export function getProjectById(id: string): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
}

export function getProjectByPath(localPath: string): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE local_path = ?').get(localPath) as
    | ProjectRow
    | undefined;
}

export function listAllProjects(username?: string): ProjectRow[] {
  if (username) {
    return getDb()
      .prepare('SELECT * FROM projects WHERE username = ? ORDER BY name')
      .all(username) as ProjectRow[];
  }
  return getDb().prepare('SELECT * FROM projects ORDER BY name').all() as ProjectRow[];
}

// ─── 项目关系 CRUD ───

export function upsertRelation(row: ProjectRelationRow): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO project_relations (project_a, project_b, relation_type, description)
       VALUES (@project_a, @project_b, @relation_type, @description)`,
    )
    .run(row);
}

export function getRelationsForProject(projectId: string): ProjectRelationRow[] {
  return getDb()
    .prepare('SELECT * FROM project_relations WHERE project_a = ? OR project_b = ?')
    .all(projectId, projectId) as ProjectRelationRow[];
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

export function getProjectsForTask(taskId: string): string[] {
  const rows = getDb()
    .prepare('SELECT project_id FROM task_projects WHERE task_id = ?')
    .all(taskId) as TaskProjectRow[];
  return rows.map((r) => r.project_id);
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
  return getDb()
    .prepare('SELECT task_id, project_id FROM task_projects')
    .all() as TaskProjectRow[];
}

// ─── FTS5 全文索引 CRUD ───

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
      `INSERT INTO specs_fts (file_path, title, content, tags, source_type, username, project_id)
       VALUES (@file_path, @title, @content, @tags, @source_type, @username, @project_id)`,
    ).run(entry);
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
}): void {
  getDb()
    .prepare(
      `INSERT INTO embeddings (
         id, file_path, content_hash, source_type, title, username, project_id, vector_indexed, created, updated
       )
       VALUES (
         @id, @file_path, @content_hash, @source_type, @title, @username, @project_id, @vector_indexed, datetime('now'), datetime('now')
       )
       ON CONFLICT(id) DO UPDATE SET
         file_path = @file_path,
         content_hash = @content_hash,
         source_type = @source_type,
         title = @title,
         username = @username,
         project_id = @project_id,
         vector_indexed = @vector_indexed,
         updated = datetime('now')`,
    )
    .run(entry);
}

export function getEmbeddingByPath(
  filePath: string,
): { id: string; content_hash: string; vector_indexed: number } | undefined {
  return getDb()
    .prepare('SELECT id, content_hash, vector_indexed FROM embeddings WHERE file_path = ?')
    .get(filePath) as { id: string; content_hash: string; vector_indexed: number } | undefined;
}

export function getEmbeddingRowsByIds(ids: string[]): {
  id: string;
  file_path: string;
  source_type: SearchDocumentType;
  title: string;
  username: string;
  project_id: string;
}[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return getDb()
    .prepare(
      `SELECT id, file_path, source_type, title, username, project_id
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

  const embeddingRows = getDb()
    .prepare('SELECT DISTINCT file_path FROM embeddings')
    .all() as { file_path: string }[];
  for (const row of embeddingRows) {
    if (row.file_path) paths.add(row.file_path);
  }

  const metaRows = getDb()
    .prepare('SELECT DISTINCT file_path FROM spec_search_meta')
    .all() as { file_path: string }[];
  for (const row of metaRows) {
    if (row.file_path) paths.add(row.file_path);
  }

  try {
    const ftsRows = getDb()
      .prepare('SELECT DISTINCT file_path FROM specs_fts')
      .all() as { file_path: string }[];
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

export function countEmbeddings(): number {
  try {
    const row = getDb().prepare('SELECT COUNT(*) as count FROM embeddings').get() as {
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
