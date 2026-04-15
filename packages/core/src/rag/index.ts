import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  RAGStatus,
  SearchDocKind,
  SearchDocumentMeta,
  SearchDocumentType,
  SemanticSearchResult,
} from '../types';
import { getDbPath } from '../paths';
import {
  upsertEmbedding,
  getEmbeddingByPath,
  getEmbeddingRowsByIds,
  deleteEmbedding,
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
} from '../db';
import {
  generateEmbedding,
  contentHash,
  getEmbeddingConfig,
  isModelInstalled,
  isModelLoaded,
  removeInstalledModel,
  resolveEmbeddingProxy,
} from './embeddings';

export {
  generateEmbedding,
  contentHash,
  getEmbeddingConfig,
  isModelInstalled,
  isModelLoaded,
  removeInstalledModel,
  resolveEmbeddingProxy,
} from './embeddings';

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
      expanded
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 2),
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
        [fileStem.replace(/[-_]/g, ' '), title, ...headings.slice(0, 6), ...(tags ?? [])].join('\n'),
      ),
    ),
  ).slice(0, 48);
  const keywords = extractKeywordCandidates(
    [sourceType, title, ...(tags ?? []), ...headings, relativePath.replace(/[\\/]/g, ' ')].join('\n'),
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

function buildEmbeddingInput(
  sourceType: SearchDocumentType,
  title: string,
  content: string,
  tags?: string[],
): string {
  const headings = extractHeadings(content);
  const excerpt = content.replace(/\s+/g, ' ').trim().slice(0, 1200);

  return [
    `kind: ${sourceType}`,
    `title: ${title}`,
    tags && tags.length > 0 ? `tags: ${tags.join(', ')}` : '',
    headings.length > 0 ? `headings: ${headings.join(' | ')}` : '',
    `body: ${excerpt}`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1800);
}

/** 索引单个搜索文档（embedding + FTS） */
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

  const existing = getEmbeddingByPath(filePath);
  const id = existing?.id ?? randomBytes(8).toString('hex');
  if (existing?.content_hash === hash && existing.vector_indexed === 1) {
    upsertEmbedding({
      id,
      file_path: filePath,
      content_hash: hash,
      source_type: meta.sourceType,
      title: meta.title,
      username: meta.username,
      project_id: encodedProjectIds,
      vector_indexed: 1,
    });
    return;
  }

  const embeddingInput = buildEmbeddingInput(meta.sourceType, meta.title, content, meta.tags);
  const embedding = await generateEmbedding(embeddingInput);
  upsertEmbedding({
    id,
    file_path: filePath,
    content_hash: hash,
    source_type: meta.sourceType,
    title: meta.title,
    username: meta.username,
    project_id: encodedProjectIds,
    vector_indexed: embedding ? 1 : 0,
  });

  if (embedding) {
    upsertVecEmbedding(id, embedding);
  } else {
    deleteVecEmbedding(id);
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
  const existing = getEmbeddingByPath(filePath);
  if (existing) {
    deleteEmbedding(existing.id);
  }
  deleteFtsEntry(filePath);
  deleteSpecSearchMeta(filePath);
}

/** 移除 spec 的索引 */
export function removeSpecIndex(filePath: string): void {
  removeSearchDocumentIndex(filePath);
}

/** 语义搜索 */
export async function semanticSearch(
  query: string,
  limit = 10,
  opts?: { type?: SearchDocumentType; projectId?: string; usernames?: string[] },
): Promise<SemanticSearchResult[]> {
  const embedding = await generateEmbedding(query);
  if (!embedding) return [];

  const candidateLimit = Math.max(limit * 8, 32);
  const results = searchVec(embedding, candidateLimit);
  const rows = getEmbeddingRowsByIds(results.map((result) => result.id));
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  const semanticResults: SemanticSearchResult[] = [];

  for (const result of results) {
    const row = rowMap.get(result.id);
    if (!row) continue;
    if (opts?.type && row.source_type !== opts.type) continue;
    if (opts?.usernames?.length && row.username && !opts.usernames.includes(row.username)) continue;

    const projectIds = decodeProjectIds(row.project_id);
    if (opts?.projectId && !projectIds.includes(opts.projectId)) continue;

    semanticResults.push({
      id: result.id,
      filePath: row.file_path,
      type: row.source_type,
      title: row.title,
      username: row.username || undefined,
      projectId: projectIds[0],
      projectIds,
      distance: result.distance,
    });
  }

  return semanticResults.slice(0, limit);
}

/** 重建全部索引 */
export async function rebuildIndex(
  docs: {
    filePath: string;
    content: string;
    title: string;
    tags?: string[];
    username: string;
    sourceType?: SearchDocumentType;
    projectId?: string;
    projectIds?: string[];
  }[],
): Promise<number> {
  let indexed = 0;
  for (const doc of docs) {
    await indexSearchDocument(doc.filePath, doc.content, {
      title: doc.title,
      tags: doc.tags,
      username: doc.username,
      sourceType: doc.sourceType ?? 'spec',
      projectId: doc.projectId,
      projectIds: doc.projectIds,
    });
    indexed++;
  }
  return indexed;
}

/** 获取 RAG 索引状态 */
export async function getRAGStatus(): Promise<RAGStatus> {
  const embeddingConfig = await getEmbeddingConfig();
  return {
    dbPath: getDbPath(),
    indexedDocuments: countEmbeddings(),
    totalEmbeddings: countVectorEmbeddings(),
    vectorStoreReady: isVecStoreReady(),
    modelInstalled: await isModelInstalled(),
    modelLoaded: isModelLoaded(),
    modelId: embeddingConfig.modelId,
    remoteHost: embeddingConfig.allowRemoteModels ? embeddingConfig.remoteHost : null,
    proxy: resolveEmbeddingProxy(embeddingConfig),
    lastUpdated: getLatestEmbeddingUpdate(),
  };
}
