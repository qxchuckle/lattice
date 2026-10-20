import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkModelMigration,
  forceRebuildIndex,
  incrementalIndex,
  indexSearchDocument,
  indexSpec,
  rebuildIndex,
  semanticSearch,
  updateRagIndex,
} from '../src/rag';
import { indexFtsAndMeta, storeEmbedding } from '../src/rag/index';
import {
  closeDb,
  ensureVecStoreDimension,
  getDocumentSourceByPath,
  getEmbeddingByPath,
  getEmbeddingRowsByIds,
  getSpecSearchMeta,
  initDb,
  searchFts,
  setFtsIndexVersion,
  setLatticeMeta,
} from '../src/db';
import type { SearchDocumentType } from '../src/types';
import { createTempLatticeHome, putFile } from './helpers';

const U = 'u1';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
  // 与默认 embedding dimension 对齐，避免 incrementalIndex 首次调用重置 vector_indexed
  ensureVecStoreDimension(512);
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

function doc(
  filePath: string,
  content: string,
  title = 'Doc',
  sourceType: SearchDocumentType = 'spec',
) {
  return { filePath, content, title, username: U, sourceType };
}

function markIndexed(input: ReturnType<typeof doc>, tags?: string[]) {
  const meta = {
    title: input.title,
    tags,
    username: input.username,
    sourceType: input.sourceType ?? 'spec',
  };
  const { hash, encodedProjectIds } = indexFtsAndMeta(input.filePath, input.content, meta);
  storeEmbedding(input.filePath, hash, new Float32Array([1, 2, 3]), {
    id: `id-${hash}`,
    title: input.title,
    username: input.username,
    sourceType: meta.sourceType,
    encodedProjectIds,
    content: input.content,
    chunkIndex: 0,
    headingPath: input.title,
    headingLevel: 1,
    parentId: null,
  });
  return { hash, meta };
}

test('indexSearchDocument/indexSpec：首次索引、元数据刷新、正文变更重嵌', async () => {
  const file = '/docs/a.md';
  const content = '# A\n\nbody content long enough for a chunk\n\n## B\n\nmore content here';
  await indexSearchDocument(file, content, {
    title: 'A',
    tags: ['x'],
    username: U,
    sourceType: 'spec',
    specId: 'spec-a',
  });
  assert.ok(getEmbeddingByPath(file));
  assert.equal(getEmbeddingByPath(file)?.vector_indexed, 0, '语义关闭时无向量但保留 chunk');
  assert.equal(getSpecSearchMeta(file)?.specId, 'spec-a');
  assert.equal(searchFts('body').length, 1);

  // 标记首个 chunk 已生成向量，模拟语义可用；内容未变 → 只刷新元数据
  const firstRow = getEmbeddingByPath(file)!;
  storeEmbedding(file, firstRow.content_hash, new Float32Array([1, 2, 3]), {
    id: firstRow.id,
    title: firstRow.title,
    username: U,
    sourceType: 'spec',
    encodedProjectIds: '',
    content,
  });
  const oldId = firstRow.id;
  await indexSearchDocument(file, content, {
    title: 'A2',
    tags: ['x'],
    username: U,
    sourceType: 'spec',
    specId: 'spec-a',
  });
  assert.equal(getEmbeddingByPath(file)?.id, oldId);
  assert.equal(getEmbeddingRowsByIds([getEmbeddingByPath(file)!.id])[0]?.title, 'A2');

  // 正文变更 → 重建 chunk id
  await indexSearchDocument(file, '# A\n\ncompletely different content', {
    title: 'A2',
    username: U,
    sourceType: 'spec',
  });
  assert.notEqual(getEmbeddingByPath(file)?.id, oldId);

  // indexSpec 包装：默认 sourceType=spec
  await indexSpec('/docs/s.md', '# S\n\nspec body', {
    title: 'S',
    tags: ['t'],
    username: U,
    specId: 'spec-s',
  });
  assert.equal(getSpecSearchMeta('/docs/s.md')?.specId, 'spec-s');
});

test('rebuildIndex/forceRebuildIndex：批量分片、进度与全量重建', async () => {
  const docs = [
    doc('/docs/1.md', '# One\n\ncontent one '.repeat(10), 'One'),
    doc('/docs/2.md', '# Two\n\ncontent two '.repeat(10), 'Two'),
  ];
  const events: { current: number; total: number; chunksProcessed: number }[] = [];
  const total = await rebuildIndex(docs, (p) => events.push(p));
  assert.equal(total, 2);
  assert.ok(events.length > 0);
  assert.equal(events.at(-1)?.total, 2);
  assert.ok((events.at(-1)?.chunksProcessed ?? 0) > 0);
  assert.ok(getEmbeddingByPath('/docs/1.md'));
  assert.ok(getEmbeddingByPath('/docs/2.md'));

  // forceRebuildIndex：从磁盘收集文档（全局 spec），带进度
  await putFile(
    join(env.latticeHome, 'spec', 'global.md'),
    '---\nid: spec-g1\ntitle: Global\n---\n\n# Global\n\nbody',
  );
  const progress: number[] = [];
  const rebuilt = await forceRebuildIndex((p) => progress.push(p.total));
  assert.ok(rebuilt >= 1);
  assert.ok(progress.length > 0);
});

test('incrementalIndex：跳过/仅刷元数据/正文重索引/清理删除', async () => {
  const a = doc('/docs/a.md', '# A\n\ncontent a', 'A');
  markIndexed(a);

  const skipped = await incrementalIndex([a]);
  assert.deepEqual(skipped, { added: 0, updated: 0, skipped: 1, removed: 0 });

  const metaOnly = { ...a, title: 'A renamed' };
  const updated = await incrementalIndex([metaOnly]);
  assert.equal(updated.updated, 1);
  assert.equal(getEmbeddingRowsByIds([getEmbeddingByPath(a.filePath)!.id])[0]?.title, 'A renamed');

  const changed = { ...a, content: '# A\n\nnew body', title: 'A renamed' };
  const reindexed = await incrementalIndex([changed]);
  assert.equal(reindexed.updated, 1);
  assert.ok(getEmbeddingByPath(a.filePath));

  // meta hash 缺失（存量索引）→ 刷新而非跳过
  markIndexed(metaOnly);
  const { deleteSpecSearchMeta } = await import('../src/db');
  deleteSpecSearchMeta(a.filePath);
  const metaMissing = await incrementalIndex([metaOnly]);
  assert.equal(metaMissing.updated, 1);

  const removed = await incrementalIndex([]);
  assert.equal(removed.removed, 1);
  assert.equal(getEmbeddingByPath(a.filePath), undefined);
});

test('incrementalIndex：进度回调分区（跳过 + 更新）', async () => {
  const a = doc('/docs/a.md', '# A\n\ncontent a', 'A');
  const b = doc('/docs/b.md', '# B\n\ncontent b', 'B');
  markIndexed(a);
  markIndexed(b);
  const events: { skipped: number; updated: number; total: number }[] = [];
  const result = await incrementalIndex([a, { ...b, title: 'B renamed' }], (p) =>
    events.push({ skipped: p.skipped, updated: p.updated, total: p.total }),
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.updated, 1);
  assert.ok(events.some((e) => e.skipped === 1 && e.updated === 1));
});

test('updateRagIndex/checkModelMigration/semanticSearch：模式选择与离线降级', async () => {
  await putFile(
    join(env.latticeHome, 'spec', 'global.md'),
    '---\nid: spec-g2\ntitle: Global 2\n---\n\n# Global\n\nbody',
  );
  setLatticeMeta('last_model_id', 'old-model');
  setFtsIndexVersion(0);
  const first = await updateRagIndex();
  assert.equal(first.total >= 1, true);
  assert.equal(first.mode, 'rebuild');
  assert.ok(
    first.reason === 'model_changed' || first.reason === 'fts_version_expired',
    `unexpected reason: ${first.reason}`,
  );

  const migration = await checkModelMigration();
  assert.equal(migration.modelChanged, false);
  setLatticeMeta('last_model_id', 'old-model');
  assert.equal((await checkModelMigration()).modelChanged, true);
  setLatticeMeta('last_model_id', (await checkModelMigration()).currentModelId);

  const second = await updateRagIndex();
  assert.equal(second.mode, 'incremental');
  assert.ok(second.total >= 1);

  assert.deepEqual(await semanticSearch('anything'), []);
});

test('indexSearchDocument：语义关闭时 embedding 为 null 仍写入 chunk', async () => {
  await mkdir(join(env.tmpRoot, 'x'), { recursive: true });
  await indexSearchDocument('/docs/n.md', '# N\n\nbody', {
    title: 'N',
    username: U,
    sourceType: 'spec',
  });
  const row = getEmbeddingByPath('/docs/n.md');
  assert.ok(row);
  assert.equal(row?.vector_indexed, 0);
  assert.equal(getDocumentSourceByPath('/docs/n.md'), 'local');
});
