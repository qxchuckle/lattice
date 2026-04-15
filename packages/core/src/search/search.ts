import type {
  SearchDocumentMeta,
  SearchDocumentType,
  SearchResult,
} from '../types';
import { getSpecSearchMeta, searchFts, searchSpecsFallback } from '../db';
import { semanticSearch } from '../rag';

const RRF_K = 60;
const TITLE_EXACT_BOOST = 0.08;
const TITLE_PARTIAL_BOOST = 0.04;
const TITLE_KEYWORD_BOOST = 0.015;
const RERANK_SCOPE_BOOST = 0.02;
const RERANK_DOMAIN_BOOST = 0.016;
const RERANK_TITLE_TERM_BOOST = 0.014;
const RERANK_PATH_TERM_BOOST = 0.01;
const RERANK_KEYWORD_BOOST = 0.006;
const RERANK_HEADING_BOOST = 0.012;
const RERANK_TAG_BOOST = 0.015;
const RERANK_MULTI_FACET_BOOST = 0.008;

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

function buildQueryVariants(query: string): string[] {
  return uniqueNonEmpty([query, ...extractKeywords(query), ...buildChineseNgrams(query)]);
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

function getTitleBoost(query: string, title: string): number {
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(title);
  if (!normalizedQuery || !normalizedTitle) return 0;

  if (normalizedTitle === normalizedQuery) return TITLE_EXACT_BOOST;
  if (
    normalizedTitle.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedTitle)
  ) {
    return TITLE_PARTIAL_BOOST;
  }

  const keywords = extractKeywords(query).map(normalizeText).filter(Boolean);
  const overlap = keywords.filter((keyword) => normalizedTitle.includes(keyword)).length;
  return overlap > 0 ? TITLE_KEYWORD_BOOST * overlap : 0;
}

function resolveSource(sources: Set<'fts' | 'fallback' | 'semantic'>): 'fts' | 'semantic' | 'hybrid' {
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
    const docTerms = new Set(extractFacetTerms([...meta.scopeTerms, ...meta.titleTerms, ...meta.headings]));

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
  },
): Promise<SearchResult[]> {
  const limit = opts?.limit ?? 10;
  const useLightweightRerank = opts?.useLightweightRerank ?? true;
  const queryProfile = parseQueryProfile(query);
  const candidates = new Map<string, SearchAccumulator>();
  const queryVariants = buildQueryVariants(query);
  const lexicalLimit = limit * 4;

  const ftsResults = mergeLexicalResults(
    queryVariants,
    (variant) =>
      searchFts(variant, lexicalLimit, {
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
    });
    for (const [rank, r] of vecResults.entries()) {
      const existing = candidates.get(r.filePath);
      const semanticScore = 1 / (RRF_K + rank + 1);
      if (existing) {
        existing.semanticRank = rank + 1;
        existing.semanticDistance = r.distance;
        if (existing.projectIds.length === 0) existing.projectIds = r.projectIds ?? (r.projectId ? [r.projectId] : []);
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

  let sorted = Array.from(candidates.values())
    .map((candidate) => {
      const titleBoost = getTitleBoost(query, candidate.title);
      const searchMeta = searchMetaByPath.get(candidate.filePath) ?? null;
      const { rerankBoost, matchedKeywords } = useLightweightRerank
        ? getRerankBoost(queryProfile, searchMeta, termDocumentFrequency, scopePrototypes)
        : { rerankBoost: 0, matchedKeywords: [] };
      const finalScore = candidate.fusionScore + titleBoost + rerankBoost;

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
      const projectIds = ((r.meta as Record<string, unknown>).projectIds as string[] | undefined) ?? [];
      return projectIds.includes(opts.projectId as string);
    });
  }

  return sorted.slice(0, limit);
}
