import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  checkEmbeddingFreshness,
  computeMetaHash,
  getRAGStatus,
  indexFtsAndMeta,
  removeSearchDocumentIndex,
  removeSpecIndex,
  storeEmbedding,
} from '../src/rag';
import {
  contentHash,
  formatModelNetworkHint,
  getModelLoadError,
  isModelLoadNetworkError,
  isModelLoaded,
  removeInstalledModel,
  resolveEmbeddingProxy,
} from '../src/rag/embeddings';
import { closeDb, getEmbeddingByPath, getSpecSearchMeta, initDb, searchFts } from '../src/db';
import { createTempLatticeHome, putFile } from './helpers';

const U = 'u1';

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

test('computeMetaHash/indexFtsAndMeta：派生指纹与 FTS/meta 落库', () => {
  const base = {
    title: 'Title',
    tags: ['a', 'b'],
    specId: 'spec-1',
    sourceType: 'spec' as const,
    username: U,
    projectId: 'p1',
  };
  const h = computeMetaHash(base);
  assert.equal(computeMetaHash({ ...base }), h);
  assert.equal(computeMetaHash({ ...base, projectIds: ['p1'] }), h);
  assert.notEqual(computeMetaHash({ ...base, title: 'Other' }), h);

  const out = indexFtsAndMeta('/docs/a.md', 'alpha beta', base);
  assert.equal(out.hash, contentHash('alpha beta'));
  assert.equal(out.metaHash, h);
  assert.equal(out.encodedProjectIds, '|p1|');
  assert.equal(searchFts('alpha').length, 1);
  const stored = getSpecSearchMeta('/docs/a.md');
  assert.equal(stored?.metaHash, h);
  assert.equal(stored?.specId, 'spec-1');
  assert.equal(stored?.docKind, 'unknown');

  const noProject = indexFtsAndMeta('/docs/b.md', 'gamma', {
    title: 'T',
    username: U,
    sourceType: 'task',
  });
  assert.equal(noProject.encodedProjectIds, '');
});

test('storeEmbedding/checkEmbeddingFreshness：无向量/有向量/哈希变化', () => {
  const first = checkEmbeddingFreshness('/docs/a.md', 'h1');
  assert.deepEqual(first, { needsReembedding: true, existingId: null });

  storeEmbedding('/docs/a.md', 'h1', null, {
    id: 'e1',
    title: 'A',
    username: U,
    sourceType: 'spec',
    encodedProjectIds: '|p1|',
    content: 'content',
  });
  const noVec = checkEmbeddingFreshness('/docs/a.md', 'h1');
  assert.deepEqual(noVec, { needsReembedding: true, existingId: 'e1' });

  storeEmbedding('/docs/a.md', 'h1', new Float32Array([1, 2, 3]), {
    id: 'e1',
    title: 'A',
    username: U,
    sourceType: 'spec',
    encodedProjectIds: '|p1|',
    content: 'content',
  });
  assert.deepEqual(checkEmbeddingFreshness('/docs/a.md', 'h1'), {
    needsReembedding: false,
    existingId: 'e1',
  });
  assert.deepEqual(checkEmbeddingFreshness('/docs/a.md', 'h2'), {
    needsReembedding: true,
    existingId: 'e1',
  });
  assert.equal(getEmbeddingByPath('/docs/a.md')?.vector_indexed, 1);
});

test('removeSearchDocumentIndex/removeSpecIndex：三处索引清理', () => {
  indexFtsAndMeta('/docs/a.md', 'alpha', {
    title: 'A',
    username: U,
    sourceType: 'spec',
  });
  storeEmbedding('/docs/a.md', 'h', new Float32Array([1, 2, 3]), {
    id: 'e1',
    title: 'A',
    username: U,
    sourceType: 'spec',
    encodedProjectIds: '',
  });
  removeSearchDocumentIndex('/docs/a.md');
  assert.equal(getEmbeddingByPath('/docs/a.md'), undefined);
  assert.equal(getSpecSearchMeta('/docs/a.md'), null);
  assert.deepEqual(searchFts('alpha'), []);

  indexFtsAndMeta('/docs/b.md', 'beta', { title: 'B', username: U, sourceType: 'spec' });
  removeSpecIndex('/docs/b.md');
  assert.equal(getSpecSearchMeta('/docs/b.md'), null);
});

test('embeddings 纯函数：hash/proxy/hint/模型状态', async () => {
  assert.equal(contentHash('x'), contentHash('x'));
  assert.notEqual(contentHash('x'), contentHash('y'));
  assert.match(formatModelNetworkHint(), /代理/);

  const prev = { ...process.env };
  try {
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
    assert.equal(resolveEmbeddingProxy(), null);
    assert.equal(resolveEmbeddingProxy({ proxy: ' http://p:1 ' }), 'http://p:1');
    process.env.HTTPS_PROXY = 'http://env:2';
    assert.equal(resolveEmbeddingProxy(), 'http://env:2');
  } finally {
    process.env = prev;
  }

  assert.equal(isModelLoaded(), false);
  assert.equal(getModelLoadError(), null);
  assert.equal(isModelLoadNetworkError(), false);
  // 隔离 home 中无模型缓存；不同环境配置下返回值可能不同，确认不抛错且为布尔
  assert.equal(typeof (await removeInstalledModel()), 'boolean');
  const status = await getRAGStatus();
  assert.equal(typeof status.modelInstalled, 'boolean');
  assert.equal(status.indexedDocuments, 0);
  assert.equal(status.expectedFtsVersion, 3);
  assert.equal(status.modelChanged, false);
  assert.ok(status.dbPath.endsWith('.db'));
});

test('getRAGStatus：配置代理与模型变更标记', async () => {
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({
      username: U,
      version: 1,
      rag: { embedding: { proxy: 'http://proxy:7890', allowRemoteModels: false } },
    }),
  );
  const { setLatticeMeta } = await import('../src/db');
  setLatticeMeta('last_model_id', 'old-model');
  const status = await getRAGStatus();
  assert.equal(status.proxy, 'http://proxy:7890');
  assert.equal(status.remoteHost, null);
  assert.equal(status.modelChanged, true);
  assert.equal(status.lastModelId, 'old-model');
});
