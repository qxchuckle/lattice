import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  RAGEmbeddingConfig,
  RAGStatus,
  SearchDocKind,
  SearchDocumentMeta,
  SearchDocumentType,
  SemanticSearchResult,
  SemanticMatchedSection,
} from '../types';
import { getDbPath } from '../paths';
import {
  upsertEmbedding,
  getEmbeddingByPath,
  deleteEmbeddingsByFilePath,
  updateEmbeddingMetadataByFilePath,
  getEmbeddingRowsByIds,
  deleteVecEmbedding,
  upsertVecEmbedding,
  searchVec,
  upsertFtsEntry,
  upsertSpecSearchMeta,
  deleteFtsEntry,
  deleteSpecSearchMeta,
  countEmbeddings,
  countVectorEmbeddings,
  getLatestEmbeddingUpdate,
  isVecStoreReady,
  ensureVecStoreDimension,
  getLatticeMeta,
  setLatticeMeta,
  getChunkStats,
  FTS_INDEX_VERSION,
  getFtsIndexVersion,
  setFtsIndexVersion,
} from '../db';
import { normalizeProjectId } from '../project';
import { CONCURRENCY } from '../utils/constants';
import {
  generateEmbedding,
  generateEmbeddings,
  contentHash,
  getEmbeddingConfig,
  isModelInstalled,
  isModelLoaded,
  isModelLoadNetworkError,
  formatModelNetworkHint,
  getModelLoadError,
  removeInstalledModel,
  resolveEmbeddingProxy,
} from './embeddings';
import { chunkMarkdown } from './chunker';
import type { MarkdownChunk } from './chunker';

export {
  generateEmbedding,
  generateEmbeddings,
  contentHash,
  getEmbeddingConfig,
  isModelInstalled,
  isModelLoaded,
  isModelLoadNetworkError,
  formatModelNetworkHint,
  getModelLoadError,
  removeInstalledModel,
  resolveEmbeddingProxy,
} from './embeddings';

import { collectAllSearchDocuments } from './collector';
export { collectAllSearchDocuments };
export type { SearchDocumentInput } from './collector';
export { chunkMarkdown } from './chunker';
export type { MarkdownChunk } from './chunker';

function extractHeadings(content: string, limit = 6): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, ''))
    .filter(Boolean)
    .slice(0, limit);
}

function encodeProjectIds(projectIds?: string[]): string {
  const unique = Array.from(new Set((projectIds ?? []).filter(Boolean)));
  return unique.length > 0 ? `|${unique.join('|')}|` : '';
}

function decodeProjectIds(value?: string): string[] {
  return (value ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSpecRelativePath(filePath: string): string {
  const marker = `${path.sep}spec${path.sep}`;
  const index = filePath.lastIndexOf(marker);
  return index >= 0 ? filePath.slice(index + marker.length) : path.basename(filePath);
}

function splitPathParts(
  filePath: string,
  sourceType: SearchDocumentType,
): {
  relativePath: string;
  directories: string[];
  fileStem: string;
} {
  const relativePath =
    sourceType === 'spec'
      ? getSpecRelativePath(filePath)
      : filePath.replace(/[\\/]+/g, '/').replace(/^\/+/, '');
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  const fileName = segments.at(-1) ?? '';
  const fileStem = fileName.replace(/\.[^.]+$/, '');

  return {
    relativePath,
    directories: segments.slice(0, -1),
    fileStem,
  };
}

function extractKeywordCandidates(text: string): string[] {
  const normalized = text.replace(/[`*_>#-]/g, ' ');
  const tokens = Array.from(
    normalized.matchAll(/[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9/-]{1,}/gu),
    (match) => match[0].trim(),
  );

  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const compact = token.replace(/\s+/g, '');
    if (/^\p{Script=Han}+$/u.test(compact) && compact.length >= 2) {
      const maxGram = Math.min(4, compact.length);
      for (let size = 2; size <= maxGram; size++) {
        for (let i = 0; i <= compact.length - size; i++) {
          expanded.push(compact.slice(i, i + size));
        }
      }
    }
  }

  return Array.from(
    new Set(
      expanded.map((token) => token.trim().toLowerCase()).filter((token) => token.length >= 2),
    ),
  ).slice(0, 64);
}

function inferDocKind(filePath: string, sourceType: SearchDocumentType): SearchDocKind {
  if (sourceType === 'project') return 'overview';
  if (sourceType === 'task') return 'reference';
  const { fileStem } = splitPathParts(filePath, sourceType);
  return fileStem.toLowerCase() === 'index' ? 'overview' : 'unknown';
}

function buildSearchMeta(
  filePath: string,
  title: string,
  content: string,
  sourceType: SearchDocumentType,
  tags?: string[],
): SearchDocumentMeta {
  const { relativePath, directories, fileStem } = splitPathParts(filePath, sourceType);
  const headings = extractHeadings(content, 10);
  const titleTerms = extractKeywordCandidates(title);
  const pathTerms = extractKeywordCandidates(
    [relativePath, directories.join(' '), fileStem.replace(/[-_]/g, ' ')].join('\n'),
  );
  const scopeKey = directories[0] ?? sourceType;
  const scopeTerms = Array.from(
    new Set(
      extractKeywordCandidates(
        [sourceType, scopeKey.replace(/[-_]/g, ' '), ...(tags ?? []), ...directories].join('\n'),
      ),
    ),
  ).slice(0, 48);
  const domainTerms = Array.from(
    new Set(
      extractKeywordCandidates(
        [fileStem.replace(/[-_]/g, ' '), title, ...headings.slice(0, 6), ...(tags ?? [])].join(
          '\n',
        ),
      ),
    ),
  ).slice(0, 48);
  const keywords = extractKeywordCandidates(
    [sourceType, title, ...(tags ?? []), ...headings, relativePath.replace(/[\\/]/g, ' ')].join(
      '\n',
    ),
  );

  return {
    filePath,
    docKind: inferDocKind(filePath, sourceType),
    tags: tags ?? [],
    headings,
    keywords,
    titleTerms,
    pathTerms,
    scopeKey,
    scopeTerms,
    domainTerms,
  };
}

/** FTS + search meta 索引（同步，快） */
export function indexFtsAndMeta(
  filePath: string,
  content: string,
  meta: {
    title: string;
    tags?: string[];
    username: string;
    sourceType: SearchDocumentType;
    projectId?: string;
    projectIds?: string[];
  },
): { hash: string; encodedProjectIds: string } {
  const hash = contentHash(content);
  const projectIds = meta.projectIds ?? (meta.projectId ? [meta.projectId] : []);
  const encodedProjectIds = encodeProjectIds(projectIds);
  const searchMeta = buildSearchMeta(filePath, meta.title, content, meta.sourceType, meta.tags);

  upsertFtsEntry({
    file_path: filePath,
    title: meta.title,
    content,
    tags: meta.tags?.join(', ') ?? '',
    source_type: meta.sourceType,
    username: meta.username,
    project_id: encodedProjectIds,
  });
  upsertSpecSearchMeta(searchMeta);

  return { hash, encodedProjectIds };
}

/** 检查是否需要重新生成 embedding */
export function checkEmbeddingFreshness(
  filePath: string,
  hash: string,
): { needsReembedding: boolean; existingId: string | null } {
  const existing = getEmbeddingByPath(filePath);
  if (existing?.content_hash === hash && existing.vector_indexed === 1) {
    return { needsReembedding: false, existingId: existing.id };
  }
  return { needsReembedding: true, existingId: existing?.id ?? null };
}

/** 存储 embedding 记录和向量（同步，快） */
export function storeEmbedding(
  filePath: string,
  hash: string,
  embedding: Float32Array | null,
  meta: {
    id?: string;
    title: string;
    username: string;
    sourceType: SearchDocumentType;
    encodedProjectIds: string;
    chunkIndex?: number;
    headingPath?: string;
    headingLevel?: number;
    parentId?: string | null;
    content?: string;
  },
): void {
  const id = meta.id ?? randomBytes(8).toString('hex');
  upsertEmbedding({
    id,
    file_path: filePath,
    content_hash: hash,
    source_type: meta.sourceType,
    title: meta.title,
    username: meta.username,
    project_id: meta.encodedProjectIds,
    vector_indexed: embedding ? 1 : 0,
    chunk_index: meta.chunkIndex ?? 0,
    heading_path: meta.headingPath ?? '',
    heading_level: meta.headingLevel ?? 0,
    parent_id: meta.parentId ?? null,
    content: meta.content ?? '',
  });

  if (embedding) {
    upsertVecEmbedding(id, embedding);
  } else {
    deleteVecEmbedding(id);
  }
}

/** 构建 chunk 级别的 embedding 输入 */
function buildChunkEmbeddingInput(
  sourceType: SearchDocumentType,
  docTitle: string,
  headingPath: string,
  chunkContent: string,
  tags?: string[],
  documentPrefix?: string,
): string {
  const input = [
    `kind: ${sourceType}`,
    `doc: ${docTitle}`,
    `section: ${headingPath}`,
    tags && tags.length > 0 ? `tags: ${tags.join(', ')}` : '',
    `body: ${chunkContent}`,
  ]
    .filter(Boolean)
    .join('\n');
  return documentPrefix ? `${documentPrefix}\n${input}` : input;
}

/** 索引单个搜索文档（分片 embedding + FTS） */
export async function indexSearchDocument(
  filePath: string,
  content: string,
  meta: {
    title: string;
    tags?: string[];
    username: string;
    sourceType: SearchDocumentType;
    projectId?: string;
    projectIds?: string[];
  },
): Promise<void> {
  const { hash, encodedProjectIds } = indexFtsAndMeta(filePath, content, meta);
  const { needsReembedding } = checkEmbeddingFreshness(filePath, hash);

  if (!needsReembedding) {
    // 内容未变，但仍刷新 chunk 元数据（title/username/project_id 可能变了）
    updateEmbeddingMetadataByFilePath(filePath, meta.title, meta.username, encodedProjectIds);
    return;
  }

  // 删除旧 chunks
  deleteEmbeddingsByFilePath(filePath);

  // 解析分片
  const config = await getEmbeddingConfig();
  const chunks = chunkMarkdown(content, meta.title, config.minChunkSize);

  // 为每个 chunk 生成 embedding（批量）
  // 先生成所有 chunk 的 id，用于 parent_id 关联
  const chunkIds = chunks.map(() => randomBytes(8).toString('hex'));

  // 收集所有 embedding 输入，一次性批量生成
  const embeddingInputs = chunks.map((chunk) =>
    buildChunkEmbeddingInput(
      meta.sourceType,
      meta.title,
      chunk.headingPath,
      chunk.content,
      meta.tags,
      config.documentPrefix || undefined,
    ),
  );
  const embeddings = await generateEmbeddings(embeddingInputs);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const parentId =
      chunk.parentChunkIndex !== null ? (chunkIds[chunk.parentChunkIndex] ?? null) : null;

    storeEmbedding(filePath, hash, embeddings[i], {
      id: chunkIds[i],
      title: meta.title,
      username: meta.username,
      sourceType: meta.sourceType,
      encodedProjectIds,
      chunkIndex: chunk.chunkIndex,
      headingPath: chunk.headingPath,
      headingLevel: chunk.headingLevel,
      parentId,
      content: chunk.content,
    });
  }
}

/** 索引单个 spec 文件（embedding + FTS） */
export async function indexSpec(
  filePath: string,
  content: string,
  meta: {
    title: string;
    tags?: string[];
    username: string;
    projectId?: string;
    sourceType?: string;
  },
): Promise<void> {
  await indexSearchDocument(filePath, content, {
    title: meta.title,
    tags: meta.tags,
    username: meta.username,
    sourceType: (meta.sourceType as SearchDocumentType | undefined) ?? 'spec',
    projectId: meta.projectId,
  });
}

/** 移除搜索文档索引 */
export function removeSearchDocumentIndex(filePath: string): void {
  deleteEmbeddingsByFilePath(filePath);
  deleteFtsEntry(filePath);
  deleteSpecSearchMeta(filePath);
}

/** 移除 spec 的索引 */
export function removeSpecIndex(filePath: string): void {
  removeSearchDocumentIndex(filePath);
}

/** 语义搜索（chunk 级返回 → 文档级聚合） */
export async function semanticSearch(
  query: string,
  limit = 10,
  opts?: {
    type?: SearchDocumentType;
    projectId?: string;
    usernames?: string[];
    distanceThreshold?: number;
  },
): Promise<SemanticSearchResult[]> {
  const config = await getEmbeddingConfig();
  const queryText = config.queryPrefix ? `${config.queryPrefix}${query}` : query;
  const embedding = await generateEmbedding(queryText);
  if (!embedding) return [];

  // 动态计算候选量：按实际 chunk/doc 比率调整，确保聚合后有足够文档
  const stats = getChunkStats();
  const avgChunksPerDoc = stats.totalDocs > 0 ? stats.totalChunks / stats.totalDocs : 1;
  const candidateLimit = Math.max(Math.ceil(limit * avgChunksPerDoc * 2), limit * 8, 64);
  const results = searchVec(embedding, candidateLimit);
  const rows = getEmbeddingRowsByIds(results.map((result) => result.id));
  const rowMap = new Map(rows.map((row) => [row.id, row]));

  // 按 file_path 聚合 chunk 结果到文档级
  const docMap = new Map<
    string,
    {
      id: string;
      filePath: string;
      type: SearchDocumentType;
      title: string;
      username: string;
      projectIds: string[];
      bestDistance: number;
      matchedSections: SemanticMatchedSection[];
    }
  >();

  for (const result of results) {
    const row = rowMap.get(result.id);
    if (!row) continue;
    if (opts?.type && row.source_type !== opts.type) continue;
    if (opts?.usernames?.length && row.username && !opts.usernames.includes(row.username)) continue;
    if (
      typeof opts?.distanceThreshold === 'number' &&
      typeof result.distance === 'number' &&
      result.distance > opts.distanceThreshold
    ) {
      continue;
    }

    const projectIds = decodeProjectIds(row.project_id);
    if (opts?.projectId) {
      const normalizedFilterId = normalizeProjectId(opts.projectId);
      if (!projectIds.some((id) => normalizeProjectId(id) === normalizedFilterId)) continue;
    }

    const snippet = row.content.slice(0, 200);
    const section: SemanticMatchedSection = {
      headingPath: row.heading_path,
      headingLevel: row.heading_level,
      distance: result.distance,
      snippet,
    };

    const existing = docMap.get(row.file_path);
    if (existing) {
      existing.matchedSections.push(section);
      if (result.distance < existing.bestDistance) {
        existing.bestDistance = result.distance;
        existing.id = result.id;
      }
    } else {
      docMap.set(row.file_path, {
        id: result.id,
        filePath: row.file_path,
        type: row.source_type,
        title: row.title,
        username: row.username,
        projectIds,
        bestDistance: result.distance,
        matchedSections: [section],
      });
    }
  }

  // 按最佳距离排序，取 top limit
  const sorted = Array.from(docMap.values())
    .sort((a, b) => a.bestDistance - b.bestDistance)
    .slice(0, limit);

  return sorted.map((doc) => ({
    id: doc.id,
    filePath: doc.filePath,
    type: doc.type,
    title: doc.title,
    username: doc.username || undefined,
    projectId: doc.projectIds[0],
    projectIds: doc.projectIds,
    distance: doc.bestDistance,
    // 只保留距离最近的 3 个匹配段，避免输出臃肿
    matchedSections: doc.matchedSections.sort((a, b) => a.distance - b.distance).slice(0, 3),
  }));
}

/** 重建全部索引 */
export type IndexProgressCallback = (progress: {
  current: number;
  total: number;
  added: number;
  updated: number;
  skipped: number;
  chunksProcessed: number;
  currentFile?: string;
}) => void;

/** 批处理并发数 */
const EMBEDDING_CONCURRENCY = CONCURRENCY;

/** 搜索文档类型（批量索引公共入参） */
type SearchDoc = {
  filePath: string;
  content: string;
  title: string;
  tags?: string[];
  username: string;
  sourceType?: SearchDocumentType;
  projectId?: string;
  projectIds?: string[];
};

/** 跨文档批量索引（rebuild / incremental 复用） */
const PROGRESS_INTERVAL_MS = 100;
async function batchIndexDocuments(
  docs: SearchDoc[],
  config: Required<RAGEmbeddingConfig>,
  onProgress?: IndexProgressCallback,
  progressBase?: { current: number; total: number; skipped: number },
): Promise<{ added: number; updated: number; chunksProcessed: number }> {
  let added = 0;
  let updated = 0;
  let chunksProcessed = 0;
  let lastProgressTime = 0;
  let currentFile = '';

  // 按内容长度升序排序：小文档 chunk 少、处理快，优先处理让进度条前期跑得快
  const sortedDocs = [...docs].sort((a, b) => a.content.length - b.content.length);

  /** 时间节流进度报告：最多每 PROGRESS_INTERVAL_MS 毫秒触发一次，force=true 时强制触发 */
  const reportProgress = (force = false, extraChunks = 0) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressTime < PROGRESS_INTERVAL_MS) return;
    lastProgressTime = now;
    const base = progressBase ?? { current: 0, total: sortedDocs.length, skipped: 0 };
    onProgress({
      current: base.current + added + updated,
      total: base.total,
      added,
      updated,
      skipped: base.skipped,
      chunksProcessed: chunksProcessed + extraChunks,
      currentFile,
    });
  };

  for (let i = 0; i < sortedDocs.length; i += EMBEDDING_CONCURRENCY) {
    const batch = sortedDocs.slice(i, i + EMBEDDING_CONCURRENCY);

    // Phase 1：解析分片 + 收集 embedding 输入（纯内存，不写 DB）
    //    DB 写入（FTS/meta + delete 旧向量）推迟到 Phase 3，
    //    这样 embedding 生成失败时旧数据完全不动
    const batchChunks: {
      doc: SearchDoc;
      meta: {
        title: string;
        tags?: string[];
        username: string;
        sourceType: SearchDocumentType;
        projectId?: string;
        projectIds?: string[];
      };
      chunks: MarkdownChunk[];
      chunkIds: string[];
      isUpdate: boolean;
    }[] = [];
    const allEmbeddingInputs: string[] = [];

    for (const doc of batch) {
      currentFile = doc.filePath;
      reportProgress();
      const meta = {
        title: doc.title,
        tags: doc.tags,
        username: doc.username,
        sourceType: doc.sourceType ?? ('spec' as SearchDocumentType),
        projectId: doc.projectId,
        projectIds: doc.projectIds,
      };
      const existing = getEmbeddingByPath(doc.filePath);
      const chunks = chunkMarkdown(doc.content, doc.title, config.minChunkSize);
      const chunkIds = chunks.map(() => randomBytes(8).toString('hex'));

      for (const chunk of chunks) {
        allEmbeddingInputs.push(
          buildChunkEmbeddingInput(
            meta.sourceType,
            doc.title,
            chunk.headingPath,
            chunk.content,
            doc.tags,
            config.documentPrefix || undefined,
          ),
        );
      }

      batchChunks.push({ doc, meta, chunks, chunkIds, isUpdate: !!existing });
    }

    // Phase 2：一次性批量生成所有 chunk 的 embedding（时间节流进度）
    //    失败时直接抛出，Phase 1 没有写 DB，旧数据完全不受影响
    const allEmbeddings =
      allEmbeddingInputs.length > 0
        ? await generateEmbeddings(
            allEmbeddingInputs,
            (processed) => reportProgress(false, processed),
            config.batchSize,
          )
        : [];

    // Phase 3：写入 DB（embedding 已在手，DB 操作极快）
    //    逐文档：upsert FTS/meta → delete 旧向量 → store 新向量
    let embeddingOffset = 0;
    for (const item of batchChunks) {
      const { hash, encodedProjectIds } = indexFtsAndMeta(
        item.doc.filePath,
        item.doc.content,
        item.meta,
      );
      deleteEmbeddingsByFilePath(item.doc.filePath);
      for (let j = 0; j < item.chunks.length; j++) {
        const chunk = item.chunks[j];
        const parentId =
          chunk.parentChunkIndex !== null ? (item.chunkIds[chunk.parentChunkIndex] ?? null) : null;
        storeEmbedding(item.doc.filePath, hash, allEmbeddings[embeddingOffset + j], {
          id: item.chunkIds[j],
          title: item.doc.title,
          username: item.doc.username,
          sourceType: item.doc.sourceType ?? 'spec',
          encodedProjectIds,
          chunkIndex: chunk.chunkIndex,
          headingPath: chunk.headingPath,
          headingLevel: chunk.headingLevel,
          parentId,
          content: chunk.content,
        });
      }
      embeddingOffset += item.chunks.length;
      if (item.isUpdate) {
        updated++;
      } else {
        added++;
      }
      chunksProcessed += item.chunks.length;
      reportProgress();
    }

    // 每批结束强制报告一次
    reportProgress(true);
  }

  return { added, updated, chunksProcessed };
}

/** 重建全部索引 */
export async function rebuildIndex(
  docs: SearchDoc[],
  onProgress?: IndexProgressCallback,
): Promise<number> {
  const config = await getEmbeddingConfig();
  ensureVecStoreDimension(config.dimension);
  const { added, updated } = await batchIndexDocuments(docs, config, onProgress);
  setLatticeMeta('last_model_id', config.modelId);
  return added + updated;
}

/** 增量更新索引结果 */
export interface IncrementalIndexResult {
  added: number;
  updated: number;
  skipped: number;
  removed: number;
}

/** 增量更新索引：跳过未变文档，清理已删除文档 */
export async function incrementalIndex(
  docs: SearchDoc[],
  onProgress?: IndexProgressCallback,
): Promise<IncrementalIndexResult> {
  const result: IncrementalIndexResult = { added: 0, updated: 0, skipped: 0, removed: 0 };

  // 确保向量表维度与配置一致
  const config = await getEmbeddingConfig();
  ensureVecStoreDimension(config.dimension);

  // 收集当前文档路径集合
  const currentPaths = new Set(docs.map((d) => d.filePath));

  // 获取已索引的文档路径
  const { listIndexedDocumentPaths } = await import('../db');
  const indexedPaths = listIndexedDocumentPaths();

  // 先分区：跳过未变文档，需要索引的进入批量处理
  const toIndex: SearchDoc[] = [];
  for (const doc of docs) {
    const hash = contentHash(doc.content);
    const { needsReembedding } = checkEmbeddingFreshness(doc.filePath, hash);
    if (!needsReembedding) {
      result.skipped++;
    } else {
      toIndex.push(doc);
    }
  }

  // 批量进度报告（跳过的部分）
  if (onProgress && result.skipped > 0) {
    onProgress({
      current: result.skipped,
      total: docs.length,
      added: 0,
      updated: 0,
      skipped: result.skipped,
      chunksProcessed: 0,
    });
  }

  // 跨文档批量索引（与 rebuildIndex 共用同一逻辑）
  if (toIndex.length > 0) {
    const batchResult = await batchIndexDocuments(toIndex, config, onProgress, {
      current: result.skipped,
      total: docs.length,
      skipped: result.skipped,
    });
    result.added = batchResult.added;
    result.updated = batchResult.updated;
  }

  // 清理已不存在的文档索引
  for (const indexedPath of indexedPaths) {
    if (!currentPaths.has(indexedPath)) {
      removeSearchDocumentIndex(indexedPath);
      result.removed++;
    }
  }

  setLatticeMeta('last_model_id', config.modelId);
  return result;
}

/** 检查模型迁移状态 */
export async function checkModelMigration(): Promise<{
  modelChanged: boolean;
  lastModelId: string | null;
  currentModelId: string;
}> {
  const config = await getEmbeddingConfig();
  const lastModelId = getLatticeMeta('last_model_id');
  return {
    modelChanged: lastModelId !== null && lastModelId !== config.modelId,
    lastModelId,
    currentModelId: config.modelId,
  };
}

/** RAG 更新结果 */
export interface RagUpdateResult {
  mode: 'rebuild' | 'incremental';
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  total: number;
  reason?: 'fts_version_expired' | 'model_changed';
}

/** 强制全量重建（rag rebuild 命令专用） */
export async function forceRebuildIndex(onProgress?: IndexProgressCallback): Promise<number> {
  const config = await getEmbeddingConfig();
  ensureVecStoreDimension(config.dimension);
  const result = await doRebuild(onProgress, undefined);
  return result.added;
}

/** 内部全量重建公共逻辑（安全重建：先 upsert 覆盖写入，成功后清理过期条目） */
async function doRebuild(
  onProgress: IndexProgressCallback | undefined,
  reason: RagUpdateResult['reason'],
): Promise<RagUpdateResult> {
  // 1. 收集先行（在任何删除操作之前）——收集失败时旧数据完全不受影响
  const allDocs = await collectAllSearchDocuments();
  const currentPaths = new Set(allDocs.map((d) => d.filePath));

  // 2. upsert 重建——batchIndexDocuments 内部逐文档 delete+insert，
  //    重建中途失败时仅当前批次数据部分丢失，其余旧数据保留
  const indexed = await rebuildIndex(allDocs, onProgress);

  // 3. 事后清理——重建成功后，仅删除不在当前文档集合中的过期条目
  const { listIndexedDocumentPaths } = await import('../db');
  const indexedPaths = listIndexedDocumentPaths();
  let removed = 0;
  for (const indexPath of indexedPaths) {
    if (!currentPaths.has(indexPath)) {
      removeSearchDocumentIndex(indexPath);
      removed++;
    }
  }

  setFtsIndexVersion(FTS_INDEX_VERSION);
  setLatticeMeta('rag_rebuild_needed', 'false');
  return {
    mode: 'rebuild',
    added: indexed,
    updated: 0,
    skipped: 0,
    removed,
    total: indexed,
    reason,
  };
}

/** 智能更新：检测 FTS 版本 + 维度变更 + 模型迁移，自动选择全量重建或增量更新（rag update / init 复用） */
export async function updateRagIndex(onProgress?: IndexProgressCallback): Promise<RagUpdateResult> {
  const config = await getEmbeddingConfig();
  const dimChanged = ensureVecStoreDimension(config.dimension);

  // 维度变更 = 模型换了或手动改了 dimension，旧向量已丢失，必须全量重建
  if (dimChanged) {
    return doRebuild(onProgress, 'model_changed');
  }

  // 检测 FTS 索引版本
  const currentFtsVersion = getFtsIndexVersion();
  if (currentFtsVersion < FTS_INDEX_VERSION) {
    return doRebuild(onProgress, 'fts_version_expired');
  }

  // 检测模型迁移
  const migration = await checkModelMigration();
  if (migration.modelChanged) {
    return doRebuild(onProgress, 'model_changed');
  }

  // 增量更新
  const allDocs = await collectAllSearchDocuments();
  const result = await incrementalIndex(allDocs, onProgress);
  setLatticeMeta('rag_rebuild_needed', 'false');
  return {
    mode: 'incremental',
    added: result.added,
    updated: result.updated,
    skipped: result.skipped,
    removed: result.removed,
    total: allDocs.length,
  };
}

/** 获取 RAG 索引状态 */
export async function getRAGStatus(): Promise<RAGStatus> {
  const embeddingConfig = await getEmbeddingConfig();
  const lastModelId = getLatticeMeta('last_model_id');
  const currentFtsVersion = getFtsIndexVersion();
  return {
    dbPath: getDbPath(),
    indexedDocuments: countEmbeddings(),
    totalEmbeddings: countVectorEmbeddings(),
    vectorStoreReady: isVecStoreReady(),
    vectorDimension: embeddingConfig.dimension,
    modelInstalled: await isModelInstalled(),
    modelId: embeddingConfig.modelId,
    dtype: embeddingConfig.dtype,
    pooling: embeddingConfig.pooling,
    batchSize: embeddingConfig.batchSize,
    minChunkSize: embeddingConfig.minChunkSize,
    distanceThreshold: embeddingConfig.distanceThreshold,
    ftsIndexVersion: currentFtsVersion,
    expectedFtsVersion: FTS_INDEX_VERSION,
    remoteHost: embeddingConfig.allowRemoteModels ? embeddingConfig.remoteHost : null,
    proxy: resolveEmbeddingProxy(embeddingConfig),
    lastUpdated: getLatestEmbeddingUpdate(),
    modelChanged: lastModelId !== null && lastModelId !== embeddingConfig.modelId,
    lastModelId,
  };
}
