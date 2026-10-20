import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  closeDb,
  countEmbeddings,
  countVectorEmbeddings,
  deleteEmbedding,
  deleteEmbeddingsByFilePath,
  deleteFingerprintsByProject,
  deleteFtsEntry,
  deleteProject,
  deleteProjectDir,
  deleteSearchDocumentsByPrefixes,
  deleteSpecSearchMeta,
  deleteTaskLinks,
  ensureVecStoreDimension,
  findProjectsByFingerprint,
  findProjectsByFingerprintKeyPrefix,
  getChunkStats,
  getDb,
  getDocCountByType,
  getDocumentSourceByPath,
  getEmbeddingByPath,
  getEmbeddingRowsByIds,
  getEmbeddingsByFilePath,
  getFtsIndexVersion,
  getLatticeMeta,
  getLatestEmbeddingUpdate,
  getProjectById,
  getProjectByPath,
  getSpecSearchMeta,
  getStoredMetaHash,
  getTasksForProject,
  initDb,
  isVecStoreReady,
  linkTaskProject,
  listAllProjects,
  listFingerprintsByProject,
  listIndexedDocumentPaths,
  listProjectDirs,
  listProjectRowsById,
  listTaskProjectLinks,
  rebuildProjectsCache,
  searchFts,
  searchVec,
  setFtsIndexVersion,
  setLatticeMeta,
  unlinkTaskProject,
  updateEmbeddingMetadataByFilePath,
  upsertEmbedding,
  upsertFingerprint,
  upsertFtsEntry,
  upsertProject,
  upsertProjectDir,
  upsertSpecSearchMeta,
  upsertVecEmbedding,
} from '../src/db';
import { registerProjectWithIds } from '../src/index';
import type { ProjectRow, SearchDocumentMeta } from '../src/types';
import { createTempLatticeHome } from './helpers';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

function projectRow(id: string, username: string, path = '/work/x'): ProjectRow {
  return {
    id,
    name: id,
    local_path: JSON.stringify([path]),
    description: null,
    git_remote: null,
    git_first_commit: null,
    git_default_branch: null,
    package_names: null,
    monorepo_packages: null,
    groups: null,
    tags: null,
    username,
    created: '2026-01-01T00:00:00.000Z',
    updated: null,
  };
}

function meta(filePath: string): SearchDocumentMeta {
  return {
    filePath,
    docKind: 'guide',
    specId: 'spec-1',
    tags: ['a'],
    headings: ['H'],
    keywords: ['k'],
    titleTerms: ['t'],
    pathTerms: ['p'],
    scopeKey: 'project',
    scopeTerms: ['s'],
    domainTerms: [],
    metaHash: 'hash-1',
  };
}

test('db projects/fingerprints/dirs/task links/meta', () => {
  upsertProject(projectRow('p1', 'u1', '/work/a'));
  upsertProject(projectRow('p1', 'u2', '/work/b'));
  upsertProject(projectRow('p2', 'u1', '/work/c'));

  assert.equal(getProjectById('p1')?.username, 'u1');
  assert.equal(listProjectRowsById('p1').length, 2);
  assert.equal(listAllProjects('u1').length, 2);
  assert.equal(getProjectByPath('/work/c')?.id, 'p2');
  assert.equal(getProjectByPath('/work/missing'), undefined);

  upsertFingerprint({ project_id: 'p1', key: 'project_id', value: 'git:abc', weight: 0 });
  upsertFingerprint({ project_id: 'p1', key: 'local_path', value: '/work/a', weight: 1 });
  assert.equal(findProjectsByFingerprint('project_id', 'git:abc').length, 1);
  assert.equal(findProjectsByFingerprintKeyPrefix('local_path', '/work').length, 1);
  assert.equal(listFingerprintsByProject('p1').length, 2);
  deleteFingerprintsByProject('p1');
  assert.equal(listFingerprintsByProject('p1').length, 0);

  upsertProjectDir('p1', 'u1', 'dir-a');
  upsertProjectDir('p1', 'u1', 'dir-a');
  assert.equal(listProjectDirs('p1', 'u1').length, 1);
  deleteProjectDir('p1', 'u1', 'dir-a');
  assert.equal(listProjectDirs('p1', 'u1').length, 0);

  linkTaskProject('t1', 'p1');
  linkTaskProject('t1', 'p1');
  linkTaskProject('t2', 'p1');
  assert.deepEqual(getTasksForProject('p1').sort(), ['t1', 't2']);
  assert.equal(listTaskProjectLinks().length, 2);
  unlinkTaskProject('t1', 'p1');
  assert.deepEqual(getTasksForProject('p1'), ['t2']);
  deleteTaskLinks('t2');
  assert.deepEqual(getTasksForProject('p1'), []);

  assert.equal(getLatticeMeta('missing'), null);
  setLatticeMeta('k', 'v');
  assert.equal(getLatticeMeta('k'), 'v');
  setLatticeMeta('k', 'v2');
  assert.equal(getLatticeMeta('k'), 'v2');

  setFtsIndexVersion(7);
  assert.equal(getFtsIndexVersion(), 7);

  // 指定 username 删除：保留其他用户行，仅清该用户 dirs
  upsertProjectDir('p1', 'u1', 'd1');
  upsertProjectDir('p1', 'u2', 'd2');
  deleteProject('p1', 'u1');
  assert.equal(listProjectRowsById('p1').length, 1);
  assert.equal(listProjectDirs('p1', 'u2').length, 1);
  assert.equal(listProjectDirs('p1', 'u1').length, 0);

  // 全量删除：清理关联数据
  linkTaskProject('t9', 'p1');
  upsertFingerprint({ project_id: 'p1', key: 'project_id', value: 'x', weight: 0 });
  deleteProject('p1');
  assert.equal(listProjectRowsById('p1').length, 0);
  assert.equal(listTaskProjectLinks().length, 0);
  assert.equal(listFingerprintsByProject('p1').length, 0);
  assert.equal(getProjectById('p1'), undefined);
});

test('db FTS / spec meta / 文档计数与索引路径', () => {
  upsertFtsEntry({
    file_path: '/docs/a.md',
    title: 'Alpha Doc',
    content: 'alpha beta gamma',
    tags: '["tag"]',
    source_type: 'spec',
    username: 'u1',
    project_id: '|p1|',
  });
  upsertFtsEntry({
    file_path: '/docs/b.md',
    title: 'Beta Doc',
    content: 'beta only',
    tags: '',
    source_type: 'task',
    username: 'u2',
    project_id: '|p2|',
  });

  assert.equal(searchFts('alpha').length, 1);
  assert.equal(searchFts('alpha', 10, { type: 'task' }).length, 0);
  assert.equal(searchFts('beta', 10, { type: 'spec', projectId: 'p1' }).length, 1);
  assert.equal(searchFts('beta', 10, { projectId: 'p2' }).length, 1);
  assert.equal(searchFts('beta', 10, { usernames: ['u2'] }).length, 1);
  assert.equal(searchFts('beta', 10, { usernames: ['  ', ''] }).length, 2);
  assert.deepEqual(searchFts('"unclosed'), []);
  assert.deepEqual(getDocCountByType(), { spec: 1, task: 1 });

  upsertSpecSearchMeta(meta('/docs/a.md'));
  const stored = getSpecSearchMeta('/docs/a.md');
  assert.equal(stored?.metaHash, 'hash-1');
  assert.deepEqual(stored?.tags, ['a']);
  assert.equal(getStoredMetaHash('/docs/a.md'), 'hash-1');
  assert.equal(getSpecSearchMeta('/docs/none.md'), null);
  deleteSpecSearchMeta('/docs/a.md');
  assert.equal(getSpecSearchMeta('/docs/a.md'), null);

  assert.ok(listIndexedDocumentPaths().includes('/docs/a.md'));
  deleteFtsEntry('/docs/a.md');
  assert.ok(!listIndexedDocumentPaths().includes('/docs/a.md'));
});

test('db embeddings / chunk 统计 / vec 降级 / 前缀删除', () => {
  const base = {
    file_path: '/docs/a.md',
    content_hash: 'h1',
    source_type: 'spec' as const,
    title: 'A',
    username: 'u1',
    project_id: '|p1|',
    vector_indexed: 1,
    content: 'alpha content',
  };
  upsertEmbedding({ ...base, id: 'e1', chunk_index: 0, heading_path: 'H1', heading_level: 1 });
  upsertEmbedding({
    ...base,
    id: 'e2',
    chunk_index: 1,
    heading_path: 'H2',
    heading_level: 2,
    vector_indexed: 0,
    source: 'domain1234',
  });
  upsertEmbedding({ ...base, file_path: '/docs/b.md', id: 'e3', content_hash: 'h2' });

  assert.equal(getEmbeddingByPath('/docs/a.md')?.id, 'e1');
  assert.equal(getDocumentSourceByPath('/docs/a.md'), 'local');
  assert.equal(getDocumentSourceByPath('/docs/none.md'), 'local');
  assert.equal(getEmbeddingsByFilePath('/docs/a.md').length, 2);
  assert.equal(getEmbeddingRowsByIds(['e1', 'e2']).length, 2);
  assert.deepEqual(getEmbeddingRowsByIds([]), []);
  assert.equal(countEmbeddings(), 2);
  assert.equal(countVectorEmbeddings(), 2);
  assert.ok(getLatestEmbeddingUpdate());
  assert.equal(getDocumentSourceByPath('/docs/b.md'), 'local');
  assert.deepEqual(getChunkStats(), { totalChunks: 3, totalDocs: 2 });

  updateEmbeddingMetadataByFilePath('/docs/a.md', 'A2', 'u2', '|p2|', 'domain9999');
  assert.equal(getDocumentSourceByPath('/docs/a.md'), 'domain9999');
  assert.equal(getEmbeddingRowsByIds(['e1'])[0].title, 'A2');

  // vec 可用时命中，不可用时安全降级
  assert.equal(typeof ensureVecStoreDimension(3), 'boolean');
  assert.equal(typeof isVecStoreReady(), 'boolean');
  upsertVecEmbedding('e1', new Float32Array([1, 2, 3]));
  const vecResults = searchVec(new Float32Array([1, 2, 3]));
  if (vecResults.length > 0) assert.equal(vecResults[0].id, 'e1');

  deleteEmbedding('e1');
  assert.equal(getEmbeddingByPath('/docs/a.md')?.id, 'e2');
  deleteEmbeddingsByFilePath('/docs/a.md');
  assert.equal(getEmbeddingByPath('/docs/a.md'), undefined);

  // 前缀删除：embeddings + FTS + spec meta
  upsertFtsEntry({
    file_path: '/docs/b.md',
    title: 'B',
    content: 'x',
    tags: '',
    source_type: 'spec',
    username: 'u1',
    project_id: '',
  });
  upsertSpecSearchMeta(meta('/docs/b.md'));
  deleteSearchDocumentsByPrefixes([]);
  assert.equal(getEmbeddingByPath('/docs/b.md')?.id, 'e3');
  deleteSearchDocumentsByPrefixes(['/docs/b']);
  assert.equal(getEmbeddingByPath('/docs/b.md'), undefined);
  assert.equal(getSpecSearchMeta('/docs/b.md'), null);
  assert.ok(!listIndexedDocumentPaths().includes('/docs/b.md'));
});

test('db rebuildProjectsCache：从磁盘 project.json 回填 DB/指纹/目录', async () => {
  const dir = join(env.tmpRoot, 'rebuild');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const id = 'legacy:aaaabbbbccccdddd';
  await registerProjectWithIds('u1', [id], dir, {
    gitRemotes: [],
    packageNames: [],
    monorepoPackages: [],
  });
  deleteProject(id);
  assert.equal(getProjectById(id), undefined);

  await rebuildProjectsCache();
  assert.equal(getProjectById(id)?.username, 'u1');
  assert.equal(listProjectDirs(id, 'u1').length, 1);
  assert.ok(findProjectsByFingerprint('project_id', id).length >= 1);

  // DB 可用性兜底
  assert.ok(getDb());
});
