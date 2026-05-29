import type { SearchDocumentMeta, SearchDocumentType, SearchResult } from '../types';
import { getSpecSearchMeta, searchFts, searchSpecsFallback } from '../db';
import { semanticSearch } from '../rag';

const RRF_K = 60;
// 标题 boost：拉大到足以压倒 RRF 同类候选人的量级（RRF top1 约 0.05）
const TITLE_EXACT_BOOST = 0.5;
const TITLE_PARTIAL_BOOST = 0.15;
const TITLE_KEYWORD_BOOST = 0.04;
const RERANK_SCOPE_BOOST = 0.02;
const RERANK_DOMAIN_BOOST = 0.016;
const RERANK_TITLE_TERM_BOOST = 0.014;
const RERANK_PATH_TERM_BOOST = 0.01;
const RERANK_KEYWORD_BOOST = 0.006;
const RERANK_HEADING_BOOST = 0.012;
const RERANK_TAG_BOOST = 0.015;
const RERANK_MULTI_FACET_BOOST = 0.008;

// semantic 候选距离阈值（all-MiniLM-L6-v2 cosine distance 越小越近）
// > 1.5 认为几乎不相关，避免噪音 query 也被划拉到 10 条。
const SEMANTIC_DISTANCE_THRESHOLD = 1.5;

// 最终分下限：低于该分认为信号太弱，丢弃（防误举）。
// 0.04 → 0.06：过滤更激进，避免低分纯噪音随机命中（如纯数字/英文乱码）。
const MIN_FINAL_SCORE = 0.06;

// 弱命中阈值：当结果绝对分低于此值时，归一化后再高也标记为 weakMatch=true，
// CLI 显示侧据此降低视觉权重，避免「低绝对分被归一化拉到 100%」的误导。
const WEAK_SCORE_THRESHOLD = 0.12;

// FTS 查询的有效列限定：仅匹配标题/正文/标签/ngram，
// 显式排除 file_path/source_type/username/project_id 这些路径与元数据列，
// 避免 query="ragtest" / query="lattice"（出现在 username 或 git URL 中）误命中所有文档。
const FTS_QUERY_COLUMNS = '{title content tags ngram}';

// 不同 source_type 的权重：relation 天然同时包含两个项目名，
// 容易误命中“某个项目”查询，需要在均衡 boost 后轻度降权。
const TYPE_WEIGHT: Partial<Record<SearchDocumentType, number>> = {
  relation: 0.7,
};

// scope 硬加权：spec 分层 project > user > global
const SCOPE_WEIGHT_PROJECT = 1.1;
const SCOPE_WEIGHT_USER = 1.0;
const SCOPE_WEIGHT_GLOBAL = 0.95;

type LexicalResult = {
  file_path: string;
  title: string;
  snippet: string;
  rank: number;
  source_type: SearchDocumentType;
  username: string;
  project_id: string;
};

type SearchAccumulator = {
  type: SearchDocumentType;
  title: string;
  snippet: string;
  filePath: string;
  username: string;
  projectIds: string[];
  ftsRank?: number;
  fallbackRank?: number;
  semanticRank?: number;
  semanticDistance?: number;
  fusionScore: number;
  titleBoost: number;
  sources: Set<'fts' | 'fallback' | 'semantic'>;
};

type QueryProfile = {
  signalTerms: string[];
};

type ScopePrototype = {
  size: number;
  terms: string[];
  termCoverage: Map<string, number>;
};

function decodeProjectIds(value?: string): string[] {
  return (value ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function extractKeywords(query: string): string[] {
  return Array.from(query.matchAll(/[\p{Script=Han}A-Za-z0-9]+/gu), (match) => match[0]).filter(
    (token) => token.length >= 2,
  );
}

function buildChineseNgrams(query: string): string[] {
  const grams: string[] = [];
  const compact = query.replace(/\s+/g, '');
  const segments = compact.match(/\p{Script=Han}+/gu) ?? [];

  for (const segment of segments) {
    if (segment.length < 2) continue;
    const maxGram = Math.min(3, segment.length);
    for (let size = 2; size <= maxGram; size++) {
      for (let i = 0; i <= segment.length - size; i++) {
        grams.push(segment.slice(i, i + size));
      }
    }
  }

  return grams;
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function toNormalizedTerms(values: string[]): string[] {
  return uniqueNonEmpty(values.map(normalizeText).filter(Boolean));
}

function extractFacetTerms(values: string[]): string[] {
  return uniqueNonEmpty(
    values.flatMap((value) => {
      const text = value.trim();
      if (!text) return [];

      return [
        normalizeText(text),
        ...toNormalizedTerms(extractKeywords(text)),
        ...toNormalizedTerms(buildChineseNgrams(text)),
      ];
    }),
  ).filter((term) => term.length >= 2 && term.length <= 32);
}

function buildSignalTerms(query: string): string[] {
  return extractFacetTerms([query]).filter((term) => term.length <= 8);
}

/**
 * 为 lexical 检索（FTS / fallback LIKE）构建查询变体。
 * 与原来的 buildQueryVariants 区别：
 * - 不会把长度 = 2 的中文 ngram 全部交给 lexical（会让 LIKE 误命中拉边）
 * - 仅保留：原 query / extractKeywords 整词 / 长度 ≥ 3 的中文 ngram
 * - 2-字 ngram 仍在 signalTerms 中参与 rerankBoost，不影响微词语义信号。
 */
function buildLexicalQueries(query: string): string[] {
  const longGrams = buildChineseNgrams(query).filter((gram) => gram.length >= 3);
  return uniqueNonEmpty([query, ...extractKeywords(query), ...longGrams]);
}

/**
 * 把一个 query 变体转换成 FTS5 列限定表达式：
 *   {title content tags ngram}: "escaped phrase"
 *
 * 这样 FTS5 仅会在指定列查找，不会被 file_path / username / project_id /
 * source_type 等路径或元数据列上的字面命中污染（解决 G3「ragtest」、
 * C5「lattice」等 query 误命中所有文档的问题）。
 *
 * fallback (LIKE) 走另一条路径，无需此处理。
 */
function wrapFtsColumnQuery(variant: string): string {
  const trimmed = variant.trim();
  if (!trimmed) return trimmed;
  // FTS5 短语内部必须用 "" 转义双引号；其他特殊字符（连字符/冒号等）
  // 在双引号内被当作 phrase 字面，由 tokenizer 自然切分。
  const escaped = trimmed.replace(/"/g, '""');
  return `${FTS_QUERY_COLUMNS}: "${escaped}"`;
}

function mergeLexicalResults(
  queries: string[],
  searcher: (query: string) => LexicalResult[],
  maxItems: number,
): LexicalResult[] {
  const merged = new Map<string, LexicalResult>();

  for (const query of queries) {
    const rows = searcher(query);
    for (const row of rows) {
      if (merged.has(row.file_path)) continue;
      merged.set(row.file_path, row);
      if (merged.size >= maxItems) break;
    }
    if (merged.size >= maxItems) break;
  }

  return Array.from(merged.values());
}

/**
 * 根据 filePath 结构推断 spec scope 分层（project / user / global）。
 *
 * Lattice 存储约定：
 * - 项目级 spec：absolute path 中含 `/projects/<id>/spec/`
 * - 用户级 spec：含 `/users/<u>/spec/` 但不在 projects 下
 * - 全局级 spec：不含 `/users/`（在 ~/.lattice/spec 下）
 */
function inferScopeWeight(filePath: string, type: SearchDocumentType): number {
  if (type !== 'spec') return 1;
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/projects/') && normalized.includes('/spec/')) {
    return SCOPE_WEIGHT_PROJECT;
  }
  if (normalized.includes('/users/') && normalized.includes('/spec/')) {
    return SCOPE_WEIGHT_USER;
  }
  return SCOPE_WEIGHT_GLOBAL;
}

function getTypeWeight(type: SearchDocumentType): number {
  return TYPE_WEIGHT[type] ?? 1;
}

/**
 * 同名聚合使用的标题归一化：
 * - 转小写
 * - 去除所有空白
 * - 去除所有标点与符号字符
 * 不会丢掉中文、字母、数字。
 */
function normalizeTitleForGrouping(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}]+/gu, '');
}

interface DuplicateRecord {
  filePath: string;
  score: number;
  username: string | null;
  projectIds: string[];
  source: string | null;
  scopeKey: string | null;
}

/**
 * 同名聚合：在最终排序上按 (type, normalizedTitle) 合并重复项，
 * 首条作为主条目保留在输出中，其余合并进 meta.duplicates 与 meta.duplicateCount。
 * 重复项多見于：
 * - 同名不同 ID 项目（如多个 demo-app）
 * - 不同项目下同名 spec 文件（如不同项目下的 component-guidelines.md）
 */
function collapseDuplicateTitles(results: SearchResult[]): SearchResult[] {
  const groups = new Map<string, SearchResult>();
  const order: string[] = [];
  for (const r of results) {
    const key = `${r.type}::${normalizeTitleForGrouping(r.title)}`;
    const head = groups.get(key);
    if (!head) {
      groups.set(key, r);
      order.push(key);
      continue;
    }
    const headMeta = head.meta as Record<string, unknown>;
    const existing = (headMeta.duplicates as DuplicateRecord[] | undefined) ?? [];
    const meta = r.meta as Record<string, unknown>;
    existing.push({
      filePath: (meta.filePath as string) ?? '',
      score: r.score,
      username: (meta.username as string) || null,
      projectIds: ((meta.projectIds as string[] | undefined) ?? []).slice(),
      source: (meta.source as string) || null,
      scopeKey: (meta.scopeKey as string) || null,
    });
    headMeta.duplicates = existing;
    headMeta.duplicateCount = existing.length;
  }
  return order.map((key) => {
    const head = groups.get(key)!;
    const headMeta = head.meta as Record<string, unknown>;
    if (!headMeta.duplicates) {
      headMeta.duplicates = [] as DuplicateRecord[];
      headMeta.duplicateCount = 0;
    }
    return head;
  });
}

function getTitleBoost(query: string, title: string): number {
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(title);
  if (!normalizedQuery || !normalizedTitle) return 0;

  if (normalizedTitle === normalizedQuery) return TITLE_EXACT_BOOST;
  if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
    return TITLE_PARTIAL_BOOST;
  }

  const keywords = extractKeywords(query).map(normalizeText).filter(Boolean);
  const overlap = keywords.filter((keyword) => normalizedTitle.includes(keyword)).length;
  return overlap > 0 ? TITLE_KEYWORD_BOOST * overlap : 0;
}

function resolveSource(
  sources: Set<'fts' | 'fallback' | 'semantic'>,
): 'fts' | 'semantic' | 'hybrid' {
  if (sources.size > 1) return 'hybrid';
  return sources.has('semantic') ? 'semantic' : 'fts';
}

function parseQueryProfile(query: string): QueryProfile {
  return {
    signalTerms: buildSignalTerms(query),
  };
}

function hasFacetMatch(term: string, facetTerms: string[]): boolean {
  return facetTerms.some((facet) => facet === term || facet.includes(term) || term.includes(facet));
}

function collectFacetMatches(
  queryTerms: string[],
  facetTerms: string[],
  termDocumentFrequency: Map<string, number>,
  baseWeight: number,
  termCoverage?: Map<string, number>,
): {
  score: number;
  matchedTerms: string[];
} {
  if (queryTerms.length === 0 || facetTerms.length === 0) {
    return { score: 0, matchedTerms: [] };
  }

  const normalizedFacetTerms = uniqueNonEmpty(facetTerms.map(normalizeText).filter(Boolean));
  let score = 0;
  const matchedTerms: string[] = [];

  for (const term of queryTerms) {
    if (!hasFacetMatch(term, normalizedFacetTerms)) continue;

    const docFrequency = termDocumentFrequency.get(term) ?? 1;
    const rarityMultiplier = 1 + 1 / docFrequency;
    const coverageMultiplier = 1 + (termCoverage?.get(term) ?? 0) / 2;
    score += baseWeight * rarityMultiplier * coverageMultiplier;
    matchedTerms.push(term);
  }

  return {
    score,
    matchedTerms: uniqueNonEmpty(matchedTerms),
  };
}

function buildScopePrototypes(metas: SearchDocumentMeta[]): Map<string, ScopePrototype> {
  const groupedTermCoverage = new Map<string, Map<string, number>>();
  const groupedSize = new Map<string, number>();

  for (const meta of metas) {
    const scopeKey = meta.scopeKey || '__root__';
    groupedSize.set(scopeKey, (groupedSize.get(scopeKey) ?? 0) + 1);

    const coverage = groupedTermCoverage.get(scopeKey) ?? new Map<string, number>();
    const docTerms = new Set(
      extractFacetTerms([...meta.scopeTerms, ...meta.titleTerms, ...meta.headings]),
    );

    for (const term of docTerms) {
      coverage.set(term, (coverage.get(term) ?? 0) + 1);
    }

    groupedTermCoverage.set(scopeKey, coverage);
  }

  return new Map(
    Array.from(groupedTermCoverage.entries()).map(([scopeKey, coverage]) => {
      const size = groupedSize.get(scopeKey) ?? 1;
      const terms = Array.from(coverage.entries())
        .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
        .slice(0, 64)
        .map(([term]) => term);

      return [scopeKey, { size, terms, termCoverage: coverage }];
    }),
  );
}

function getRerankBoost(
  profile: QueryProfile,
  meta: SearchDocumentMeta | null,
  termDocumentFrequency: Map<string, number>,
  scopePrototypes: Map<string, ScopePrototype>,
): {
  rerankBoost: number;
  matchedKeywords: string[];
} {
  if (profile.signalTerms.length === 0 || !meta) {
    return { rerankBoost: 0, matchedKeywords: [] };
  }

  const headingTerms = extractFacetTerms(meta.headings);
  const tagTerms = extractFacetTerms(meta.tags);
  const scopePrototype = scopePrototypes.get(meta.scopeKey || '__root__');

  const scopeMatches = collectFacetMatches(
    profile.signalTerms,
    scopePrototype?.terms ?? meta.scopeTerms,
    termDocumentFrequency,
    RERANK_SCOPE_BOOST,
    scopePrototype?.termCoverage,
  );
  const domainMatches = collectFacetMatches(
    profile.signalTerms,
    meta.domainTerms,
    termDocumentFrequency,
    RERANK_DOMAIN_BOOST,
  );
  const titleMatches = collectFacetMatches(
    profile.signalTerms,
    meta.titleTerms,
    termDocumentFrequency,
    RERANK_TITLE_TERM_BOOST,
  );
  const headingMatches = collectFacetMatches(
    profile.signalTerms,
    headingTerms,
    termDocumentFrequency,
    RERANK_HEADING_BOOST,
  );
  const pathMatches = collectFacetMatches(
    profile.signalTerms,
    meta.pathTerms,
    termDocumentFrequency,
    RERANK_PATH_TERM_BOOST,
  );
  const keywordMatches = collectFacetMatches(
    profile.signalTerms,
    meta.keywords,
    termDocumentFrequency,
    RERANK_KEYWORD_BOOST,
  );
  const tagMatches = collectFacetMatches(
    profile.signalTerms,
    tagTerms,
    termDocumentFrequency,
    RERANK_TAG_BOOST,
  );

  const facetMatchCount = [
    scopeMatches,
    domainMatches,
    titleMatches,
    headingMatches,
    pathMatches,
    keywordMatches,
    tagMatches,
  ].filter((match) => match.matchedTerms.length > 0).length;

  const rerankBoost =
    scopeMatches.score +
    domainMatches.score +
    titleMatches.score +
    headingMatches.score +
    pathMatches.score +
    keywordMatches.score +
    tagMatches.score +
    Math.max(0, facetMatchCount - 1) * RERANK_MULTI_FACET_BOOST;

  return {
    rerankBoost,
    matchedKeywords: uniqueNonEmpty([
      ...scopeMatches.matchedTerms,
      ...domainMatches.matchedTerms,
      ...titleMatches.matchedTerms,
      ...headingMatches.matchedTerms,
      ...pathMatches.matchedTerms,
      ...keywordMatches.matchedTerms,
      ...tagMatches.matchedTerms,
    ]),
  };
}

/**
 * 混合搜索：同时使用 FTS5 全文搜索和向量语义搜索，综合排序
 */
export async function hybridSearch(
  query: string,
  opts?: {
    type?: SearchDocumentType;
    projectId?: string;
    usernames?: string[];
    limit?: number;
    useLightweightRerank?: boolean;
    minFinalScore?: number;
  },
): Promise<SearchResult[]> {
  const limit = opts?.limit ?? 10;
  const useLightweightRerank = opts?.useLightweightRerank ?? true;
  const minFinalScore = opts?.minFinalScore ?? MIN_FINAL_SCORE;
  const queryProfile = parseQueryProfile(query);
  const candidates = new Map<string, SearchAccumulator>();
  const queryVariants = buildLexicalQueries(query);
  const lexicalLimit = limit * 4;

  const ftsResults = mergeLexicalResults(
    queryVariants,
    (variant) =>
      searchFts(wrapFtsColumnQuery(variant), lexicalLimit, {
        type: opts?.type,
        projectId: opts?.projectId,
        usernames: opts?.usernames,
      }),
    lexicalLimit,
  );
  const fallbackResults = mergeLexicalResults(
    queryVariants,
    (variant) =>
      searchSpecsFallback(variant, lexicalLimit, {
        type: opts?.type,
        projectId: opts?.projectId,
        usernames: opts?.usernames,
      }),
    lexicalLimit,
  );

  for (const [rank, row] of ftsResults.entries()) {
    candidates.set(row.file_path, {
      type: row.source_type,
      title: row.title || row.file_path,
      snippet: row.snippet,
      filePath: row.file_path,
      username: row.username,
      projectIds: decodeProjectIds(row.project_id),
      ftsRank: rank + 1,
      fusionScore: 1 / (RRF_K + rank + 1),
      titleBoost: 0,
      sources: new Set(['fts']),
    });
  }

  for (const [rank, row] of fallbackResults.entries()) {
    const existing = candidates.get(row.file_path);
    const fallbackScore = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.fallbackRank ??= rank + 1;
      if (!existing.snippet && row.snippet) existing.snippet = row.snippet;
      if (!existing.title && row.title) existing.title = row.title;
      if (!existing.username && row.username) existing.username = row.username;
      if (existing.projectIds.length === 0) existing.projectIds = decodeProjectIds(row.project_id);
      existing.fusionScore += fallbackScore;
      existing.sources.add('fallback');
    } else {
      candidates.set(row.file_path, {
        type: row.source_type,
        title: row.title || row.file_path,
        snippet: row.snippet,
        filePath: row.file_path,
        username: row.username,
        projectIds: decodeProjectIds(row.project_id),
        fallbackRank: rank + 1,
        fusionScore: fallbackScore,
        titleBoost: 0,
        sources: new Set(['fallback']),
      });
    }
  }

  try {
    const vecResults = await semanticSearch(query, lexicalLimit, {
      type: opts?.type,
      projectId: opts?.projectId,
      usernames: opts?.usernames,
      distanceThreshold: SEMANTIC_DISTANCE_THRESHOLD,
    });
    for (const [rank, r] of vecResults.entries()) {
      const existing = candidates.get(r.filePath);
      const semanticScore = 1 / (RRF_K + rank + 1);
      if (existing) {
        existing.semanticRank = rank + 1;
        existing.semanticDistance = r.distance;
        if (existing.projectIds.length === 0)
          existing.projectIds = r.projectIds ?? (r.projectId ? [r.projectId] : []);
        if (!existing.username && r.username) {
          existing.username = r.username;
        }
        existing.fusionScore += semanticScore;
        existing.sources.add('semantic');
      } else {
        candidates.set(r.filePath, {
          type: r.type,
          title: r.title || (r.filePath.split('/').pop() ?? r.filePath),
          snippet: '',
          filePath: r.filePath,
          username: r.username ?? '',
          projectIds: r.projectIds ?? (r.projectId ? [r.projectId] : []),
          semanticRank: rank + 1,
          semanticDistance: r.distance,
          fusionScore: semanticScore,
          titleBoost: 0,
          sources: new Set(['semantic']),
        });
      }
    }
  } catch {
    // 语义搜索不可用，仅使用 FTS 结果
  }

  const searchMetaByPath = new Map(
    Array.from(candidates.values()).map((candidate) => [
      candidate.filePath,
      getSpecSearchMeta(candidate.filePath),
    ]),
  );
  const candidateMetas = Array.from(searchMetaByPath.values()).filter(
    (meta): meta is SearchDocumentMeta => meta !== null,
  );
  const scopePrototypes = buildScopePrototypes(candidateMetas);
  const termDocumentFrequency = new Map<string, number>();
  for (const term of queryProfile.signalTerms) {
    let count = 0;
    for (const meta of searchMetaByPath.values()) {
      if (!meta) continue;
      const docTerms = extractFacetTerms([
        ...meta.keywords,
        ...meta.headings,
        ...meta.tags,
        ...meta.titleTerms,
        ...meta.pathTerms,
        ...meta.scopeTerms,
        ...meta.domainTerms,
      ]);
      const matched = hasFacetMatch(term, docTerms);
      if (matched) count++;
    }
    termDocumentFrequency.set(term, Math.max(1, count));
  }

  let sorted: SearchResult[] = Array.from(candidates.values())
    .map((candidate) => {
      const titleBoost = getTitleBoost(query, candidate.title);
      const searchMeta = searchMetaByPath.get(candidate.filePath) ?? null;
      const { rerankBoost, matchedKeywords } = useLightweightRerank
        ? getRerankBoost(queryProfile, searchMeta, termDocumentFrequency, scopePrototypes)
        : { rerankBoost: 0, matchedKeywords: [] };
      const baseScore = candidate.fusionScore + titleBoost + rerankBoost;
      // type 与 scope 硬加权：relation 轻度降权、项目级 spec 高于用户级高于全局
      const typeWeight = getTypeWeight(candidate.type);
      const scopeWeight = inferScopeWeight(candidate.filePath, candidate.type);
      const finalScore = baseScore * typeWeight * scopeWeight;

      return {
        type: candidate.type,
        score: finalScore,
        title: candidate.title,
        snippet: candidate.snippet,
        meta: {
          filePath: candidate.filePath,
          source: resolveSource(candidate.sources),
          sources: Array.from(candidate.sources.values()),
          ftsRank: candidate.ftsRank ?? null,
          fallbackRank: candidate.fallbackRank ?? null,
          semanticRank: candidate.semanticRank ?? null,
          semanticDistance: candidate.semanticDistance ?? null,
          fusionScore: candidate.fusionScore,
          titleBoost,
          rerankEnabled: useLightweightRerank,
          rerankBoost,
          matchedKeywords,
          typeWeight,
          scopeWeight,
          username: candidate.username,
          projectIds: candidate.projectIds,
          docKind: searchMeta?.docKind ?? null,
          scopeKey: searchMeta?.scopeKey ?? '',
          scopeTerms: searchMeta?.scopeTerms ?? [],
          domainTerms: searchMeta?.domainTerms ?? [],
          headings: searchMeta?.headings ?? [],
          keywords: searchMeta?.keywords ?? [],
          finalScore,
        },
      } satisfies SearchResult;
    })
    .sort((a, b) => b.score - a.score);

  // 类型过滤
  if (opts?.type) {
    sorted = sorted.filter((r) => r.type === opts.type);
  }

  if (opts?.projectId) {
    sorted = sorted.filter((r) => {
      const projectIds =
        ((r.meta as Record<string, unknown>).projectIds as string[] | undefined) ?? [];
      return projectIds.includes(opts.projectId as string);
    });
  }

  // 最小分阈值：过滤掉几乎不相关的噪音候选。
  if (minFinalScore > 0) {
    sorted = sorted.filter((r) => r.score >= minFinalScore);
  }

  // 同名聚合（方案 E）：对 (type, normalizedTitle) 相同的多条候选，
  // 保留首条作为主条目，其余合并到主条 meta.duplicates。
  // 这会改变 results.length 语义（以去重后计），上层 limit 亦作用于该语义。
  sorted = collapseDuplicateTitles(sorted);

  // 归一化：以 top1 为基准计算 normalizedScore，写入 meta。
  // 跳过原 score 字段以保留现有 CLI / SDK 契约。
  const topScore = sorted.length > 0 ? sorted[0].score : 0;
  if (topScore > 0) {
    for (const r of sorted) {
      const meta = r.meta as Record<string, unknown>;
      meta.normalizedScore = r.score / topScore;
      // 弱命中标记：绝对分低于阈值的结果，即便归一化是 100% 也提示用户该批可信度低。
      // 仅打标，不丢弃；上层根据 weakMatch 决定如何展示。
      meta.weakMatch = r.score < WEAK_SCORE_THRESHOLD;
    }
  }

  // 后处理增强：为 checkpoint/relation 结果添加结构化上下文
  for (const r of sorted) {
    const meta = r.meta as Record<string, unknown>;
    const fp = (meta.filePath as string) ?? '';

    if (r.type === 'checkpoint') {
      // 解析 filePath: user/{username}/task/{taskId}/checkpoint/{cpId}
      const parts = fp.split('/');
      const taskIdx = parts.indexOf('task');
      if (taskIdx >= 0 && taskIdx + 1 < parts.length) {
        meta.taskId = parts[taskIdx + 1];
      }
      const cpIdx = parts.indexOf('checkpoint');
      if (cpIdx >= 0 && cpIdx + 1 < parts.length) {
        meta.checkpointId = parts[cpIdx + 1];
      }
    } else if (r.type === 'relation') {
      // 解析 filePath: user/{username}/relation/{relId}
      const parts = fp.split('/');
      const relIdx = parts.indexOf('relation');
      if (relIdx >= 0 && relIdx + 1 < parts.length) {
        meta.relationId = parts[relIdx + 1];
      }
    }
  }

  return sorted.slice(0, limit);
}
