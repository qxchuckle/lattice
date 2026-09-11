import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  initDb,
  closeDb,
  contentHash,
  computeMetaHash,
  indexFtsAndMeta,
  getStoredMetaHash,
  getSpecSearchMeta,
  upsertSpecSearchMeta,
  upsertEmbedding,
  getEmbeddingByPath,
  getEmbeddingRowsByIds,
  incrementalIndex,
  ensureVecStoreDimension,
  getRAGStatus,
} from '../dist/index.mjs';
import { createTempLatticeHome, putFile } from './helpers.mjs';

// 方案 X 回归：incrementalIndex 分离「FTS/meta 刷新」与「embedding 重算」。
// spec 正文未变但 frontmatter 派生字段（title/tags/specId/...）变时，只刷新
// FTS + spec_search_meta（含 meta_hash），绝不重算向量。全部用
// upsertEmbedding(vector_indexed=1) 构造「已索引 fresh」状态，不触 embedding 模型
// （meta-refresh 路径与 freshness 分类都不调 generateEmbeddings）。

let env;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: 't' }),
  );
  await initDb();
  // 建立向量维度基线：fresh DB 的 vec_dimension meta 未设（默认 384）≠ 实际维度（如 512），
  // 否则 incrementalIndex 内部的 ensureVecStoreDimension 会 UPDATE embeddings SET vector_indexed=0，
  // 抹掉下面 seed 的 fresh 状态，导致文档误走 batch 重算路径。先跑一次让 vec_dimension 落库，
  // 之后 incrementalIndex 的 ensureVecStoreDimension 即 no-op（生产库本就如此）。
  const { vectorDimension } = await getRAGStatus();
  ensureVecStoreDimension(vectorDimension);
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

/** 构造「已索引且 fresh」文档：embeddings(vector_indexed=1) + FTS/spec_search_meta(meta_hash)。返回固定 embId 供断言未被重建。 */
function seedFreshDoc({
  filePath,
  content,
  title,
  tags,
  specId,
  username = 't',
  sourceType = 'spec',
}) {
  const bodyHash = contentHash(content);
  const embId = `emb-${contentHash(filePath)}`;
  upsertEmbedding({
    id: embId,
    file_path: filePath,
    content_hash: bodyHash,
    source_type: sourceType,
    title,
    username,
    project_id: '',
    vector_indexed: 1,
    chunk_index: 0,
    content,
  });
  indexFtsAndMeta(filePath, content, { title, tags, username, sourceType, specId });
  return { bodyHash, embId };
}

test('computeMetaHash 只对 frontmatter 派生输入敏感（与正文无关）', () => {
  const base = { title: 'T', tags: ['a'], username: 'u', sourceType: 'spec', specId: 'spec-1' };
  const h = computeMetaHash(base);
  assert.equal(computeMetaHash({ ...base }), h, '同输入 → 同 hash（稳定）');
  assert.notEqual(computeMetaHash({ ...base, title: 'T2' }), h, 'title 敏感');
  assert.notEqual(computeMetaHash({ ...base, tags: ['b'] }), h, 'tags 敏感');
  assert.notEqual(computeMetaHash({ ...base, specId: 'spec-2' }), h, 'specId 敏感');
  assert.notEqual(computeMetaHash({ ...base, username: 'u2' }), h, 'username 敏感');
  assert.notEqual(computeMetaHash({ ...base, sourceType: 'task' }), h, 'sourceType 敏感');
  assert.notEqual(computeMetaHash({ ...base, projectIds: ['p1'] }), h, 'projectIds 敏感');
  // projectId 与 projectIds 归一为同一集合 → 同 hash
  assert.equal(
    computeMetaHash({ ...base, projectId: 'p1' }),
    computeMetaHash({ ...base, projectIds: ['p1'] }),
    'projectId/projectIds 归一',
  );
});

test('indexFtsAndMeta 存 meta_hash；同正文改 frontmatter → meta_hash 变、meta 刷新', () => {
  const p = '/local/spec/a.md';
  const content = '# A\n正文内容始终不变\n';
  indexFtsAndMeta(p, content, {
    title: 'A标题',
    username: 't',
    sourceType: 'spec',
    specId: 'spec-aaa',
    tags: ['x'],
  });
  const h1 = getStoredMetaHash(p);
  assert.equal(typeof h1, 'string');
  assert.equal(h1.length, 16, 'meta_hash 为 16 位 hex');
  assert.equal(getSpecSearchMeta(p).specId, 'spec-aaa');
  assert.equal(getSpecSearchMeta(p).metaHash, h1, 'getSpecSearchMeta 透出 metaHash');

  // 同正文，改 title + tags + specId
  indexFtsAndMeta(p, content, {
    title: 'A新标题',
    username: 't',
    sourceType: 'spec',
    specId: 'spec-bbb',
    tags: ['y'],
  });
  const h2 = getStoredMetaHash(p);
  assert.notEqual(h2, h1, 'frontmatter 派生字段变 → meta_hash 变（正文未变）');
  assert.equal(getSpecSearchMeta(p).specId, 'spec-bbb', 'spec_id 刷新');

  // 同正文 + 同 frontmatter → meta_hash 稳定
  indexFtsAndMeta(p, content, {
    title: 'A新标题',
    username: 't',
    sourceType: 'spec',
    specId: 'spec-bbb',
    tags: ['y'],
  });
  assert.equal(getStoredMetaHash(p), h2, '无变化 → meta_hash 稳定');
});

test('incrementalIndex：正文未变改 frontmatter → 刷 FTS/meta+embeddings 元数据、不重算向量', async () => {
  const p = '/local/spec/fresh.md';
  const content = '# 正文\n内容保持不变\n';
  const { bodyHash, embId } = seedFreshDoc({
    filePath: p,
    content,
    title: '旧标题',
    tags: ['old'],
    specId: 'spec-old',
  });
  const embBefore = getEmbeddingByPath(p);
  assert.equal(embBefore.vector_indexed, 1, 'seed 后 vector_indexed=1（fresh）');
  assert.equal(embBefore.content_hash, bodyHash);

  // 增量：同正文、同 filePath，但 title/tags/specId 变了
  const result = await incrementalIndex([
    {
      filePath: p,
      content,
      title: '新标题',
      tags: ['new'],
      specId: 'spec-new',
      username: 't',
      sourceType: 'spec',
    },
  ]);

  assert.equal(result.updated, 1, 'frontmatter 变 → 计入 updated（meta-refresh）');
  assert.equal(result.skipped, 0);
  assert.equal(result.added, 0);

  // FTS/spec_search_meta 刷新
  assert.equal(getSpecSearchMeta(p).specId, 'spec-new', 'spec_id 刷新');
  const newMetaHash = computeMetaHash({
    title: '新标题',
    tags: ['new'],
    username: 't',
    sourceType: 'spec',
    specId: 'spec-new',
  });
  assert.equal(getStoredMetaHash(p), newMetaHash, 'meta_hash 更新为新 frontmatter 指纹');

  // embeddings 向量未被重算（id/content_hash/vector_indexed 全不动）→ 证明没走 batch 重算
  const embAfter = getEmbeddingByPath(p);
  assert.equal(embAfter.id, embId, '未 delete+重建 embedding 行');
  assert.equal(embAfter.content_hash, bodyHash, 'content_hash 不变');
  assert.equal(embAfter.vector_indexed, 1, 'vector_indexed 不变');
  // 但 embeddings 冗余元数据（title）必须刷新——语义搜索结果标题源，否则透旧标题
  const rows = getEmbeddingRowsByIds([embId]);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].title,
    '新标题',
    'embeddings.title 刷新（对齐 indexSearchDocument 内容未变分支）',
  );
});

test('incrementalIndex：正文与 frontmatter 全未变 → skipped（不刷不重算）', async () => {
  const p = '/local/spec/same.md';
  const content = '# 正文\n不变\n';
  const { embId } = seedFreshDoc({
    filePath: p,
    content,
    title: 'T',
    tags: ['a'],
    specId: 'spec-s',
  });
  const result = await incrementalIndex([
    {
      filePath: p,
      content,
      title: 'T',
      tags: ['a'],
      specId: 'spec-s',
      username: 't',
      sourceType: 'spec',
    },
  ]);
  assert.equal(result.skipped, 1, '全未变 → skipped');
  assert.equal(result.updated, 0);
  assert.equal(result.added, 0);
  assert.equal(getEmbeddingByPath(p).id, embId, 'embedding 行未动');
});

test('incrementalIndex：存量 meta_hash 为空串（加列后旧行）→ 一次性刷新自愈，收敛为 skipped', async () => {
  const p = '/local/spec/legacy.md';
  const content = '# 正文\n存量 spec\n';
  const bodyHash = contentHash(content);
  // embeddings fresh
  upsertEmbedding({
    id: `emb-${contentHash(p)}`,
    file_path: p,
    content_hash: bodyHash,
    source_type: 'spec',
    title: '旧标题',
    username: 't',
    project_id: '',
    vector_indexed: 1,
    content,
  });
  // 模拟加 meta_hash 列后的旧行：spec_search_meta 存在但 meta_hash='' 且 spec_id stale
  upsertSpecSearchMeta({
    filePath: p,
    docKind: 'unknown',
    specId: '',
    tags: [],
    headings: [],
    keywords: [],
    titleTerms: [],
    pathTerms: [],
    scopeKey: '',
    scopeTerms: [],
    domainTerms: [],
    metaHash: '',
  });
  assert.equal(getStoredMetaHash(p), '', '存量旧行 meta_hash 为空');

  const doc = {
    filePath: p,
    content,
    title: '旧标题',
    tags: ['legacy'],
    specId: 'spec-legacy',
    username: 't',
    sourceType: 'spec',
  };
  const r1 = await incrementalIndex([doc]);
  assert.equal(r1.updated, 1, 'meta_hash 空 → 触发一次性 meta 刷新（无需 rebuild）');
  assert.equal(getSpecSearchMeta(p).specId, 'spec-legacy', 'stale spec_id 自愈回填');
  assert.equal(getStoredMetaHash(p).length, 16, 'meta_hash 回填');

  // 第二次增量：全未变 → 收敛为 skipped
  const r2 = await incrementalIndex([doc]);
  assert.equal(r2.skipped, 1, '回填后收敛为 skipped');
  assert.equal(r2.updated, 0);
});

test('incrementalIndex：spec_search_meta 行缺失（getStoredMetaHash=null）→ 刷新补建', async () => {
  const p = '/local/spec/nometa.md';
  const content = '# 正文\n无 meta 行\n';
  const bodyHash = contentHash(content);
  // 只 seed embeddings（fresh），不建 spec_search_meta 行
  upsertEmbedding({
    id: `emb-${contentHash(p)}`,
    file_path: p,
    content_hash: bodyHash,
    source_type: 'spec',
    title: 'T',
    username: 't',
    project_id: '',
    vector_indexed: 1,
    content,
  });
  assert.equal(getStoredMetaHash(p), null, '无 meta 行 → null');

  const result = await incrementalIndex([
    { filePath: p, content, title: 'T', username: 't', sourceType: 'spec', specId: 'spec-nm' },
  ]);
  assert.equal(result.updated, 1, 'null → 触发刷新补建');
  assert.equal(getStoredMetaHash(p).length, 16, 'meta_hash 补建');
  assert.equal(getSpecSearchMeta(p).specId, 'spec-nm');
});
