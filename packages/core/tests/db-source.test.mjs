import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  initDb,
  closeDb,
  storeEmbedding,
  indexFtsAndMeta,
  updateEmbeddingMetadataByFilePath,
  getDocumentSourceByPath,
  getEmbeddingByPath,
} from '../dist/index.mjs';
import { createTempLatticeHome, putFile } from './helpers.mjs';

// DB source 列回归：better-sqlite3 把 undefined 绑定为 NULL——
// source 未提供时必须归一为 'local'，否则撞 NOT NULL 约束
// （用户实测 rag rebuild 在收集文档阶段报 NOT NULL constraint failed: embeddings.source）。

let env;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: 't' }),
  );
  await initDb();
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

test('storeEmbedding：meta.source 为 undefined（本地文档）→ 落库为 local，不违约', () => {
  storeEmbedding('/local/spec/a.md', 'hash1', null, {
    title: 'a',
    username: 't',
    sourceType: 'spec',
    encodedProjectIds: '',
    // source 刻意不传（undefined）
  });
  assert.equal(getDocumentSourceByPath('/local/spec/a.md'), 'local');
  assert.ok(getEmbeddingByPath('/local/spec/a.md'), '行已写入');
});

test('storeEmbedding：显式 source（域 hash）→ 原样落库', () => {
  storeEmbedding('/mirror/spec/b.md', 'hash2', null, {
    title: 'b',
    username: 'alice',
    sourceType: 'spec',
    encodedProjectIds: '',
    source: 'abc123def4567890',
  });
  assert.equal(getDocumentSourceByPath('/mirror/spec/b.md'), 'abc123def4567890');
});

test('updateEmbeddingMetadataByFilePath：source undefined → local 不违约', () => {
  storeEmbedding('/local/spec/c.md', 'hash3', null, {
    title: 'c',
    username: 't',
    sourceType: 'spec',
    encodedProjectIds: '',
  });
  updateEmbeddingMetadataByFilePath('/local/spec/c.md', 'c2', 't', '');
  assert.equal(getDocumentSourceByPath('/local/spec/c.md'), 'local');

  updateEmbeddingMetadataByFilePath('/local/spec/c.md', 'c3', 't', '', 'dddd1111aaaa2222');
  assert.equal(getDocumentSourceByPath('/local/spec/c.md'), 'dddd1111aaaa2222');
  updateEmbeddingMetadataByFilePath('/local/spec/c.md', 'c4', 't', '');
  assert.equal(getDocumentSourceByPath('/local/spec/c.md'), 'local');
});

test('indexFtsAndMeta + content 未变路径（rebuild 场景的最小链路）', () => {
  const r = indexFtsAndMeta('/local/spec/d.md', '# d\n内容', {
    title: 'd',
    username: 't',
    sourceType: 'spec',
  });
  assert.ok(r.hash);
  assert.equal(getDocumentSourceByPath('/local/spec/d.md'), 'local');
});
