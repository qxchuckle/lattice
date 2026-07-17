import type { ProjectRow, SearchDocumentType, SearchResult } from '../types';
import { listProjects, findProjectById } from '../project';
import { isModelLoaded } from '../rag/embeddings';
import { hybridSearch } from './search';

/** 项目匹配来源（仅反查命中项目有值） */
export interface ProjectMatchProvenance {
  docType: SearchDocumentType;
  docTitle: string;
  docPath: string;
}

/** 项目搜索结果 */
export interface ProjectSearchResult {
  projects: ProjectRow[];
  semanticFallback: boolean;
  /** 反查命中项目的匹配来源，key = projectId */
  matchProvenance: Record<string, ProjectMatchProvenance>;
  /** 每个项目的原始匹配分数，key = projectId */
  scores: Record<string, number>;
}

/** 解析 ProjectRow.local_path (JSON 数组字符串) 为真实路径列表 */
function parseProjectLocalPaths(row: ProjectRow): string[] {
  if (!row.local_path) return [];
  try {
    const parsed = JSON.parse(row.local_path);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 项目搜索结果：合并关键词匹配与语义搜索结果。
 *
 * 三条路径，按置信度递减：
 * 1. keywordMatches：listProjects 子串匹配（快路径，无需模型）
 * 2. directMatches：hybridSearch 中 type==='project' 的结果（项目元数据直接语义/FTS 匹配）
 * 3. indirectMatches：hybridSearch 中 task/checkpoint/spec/design/relation 文档命中，
 *    通过文档携带的 projectIds 反查关联项目
 *
 * 合并策略：keyword > direct > indirect，去重后追加。
 * RAG 不可用时静默回退为纯关键词匹配。
 *
 * @param usernames 搜索的用户列表（空数组 = 所有用户）
 */
export async function searchProjects(
  usernames: string[],
  query: string,
  opts?: {
    group?: string;
    tag?: string;
    keywordOnly?: boolean;
    limit?: number;
  },
): Promise<ProjectSearchResult> {
  const matchProvenance: Record<string, ProjectMatchProvenance> = {};
  const scores: Record<string, number> = {};

  // 1. 关键词匹配（快路径）：遍历用户合并去重
  const keywordMatches: ProjectRow[] = [];
  const seenKeywordIds = new Set<string>();
  for (const u of usernames) {
    const rows = listProjects(u, {
      group: opts?.group,
      tag: opts?.tag,
      search: query,
    });
    for (const row of rows) {
      if (!seenKeywordIds.has(row.id)) {
        seenKeywordIds.add(row.id);
        keywordMatches.push(row);
        scores[row.id] = 1; // 关键词精确匹配，最高置信度
      }
    }
  }

  // 2. 若显式要求 keyword-only，直接返回
  if (opts?.keywordOnly) {
    return { projects: keywordMatches, semanticFallback: false, matchProvenance, scores };
  }

  // 3. 语义搜索（hybridSearch 全类型，一次调用覆盖直接匹配 + 反查）
  const directMatches: ProjectRow[] = [];
  const indirectMatches: ProjectRow[] = [];
  const seenIds = new Set(keywordMatches.map((p) => p.id));

  // RAG 模型未加载且关键词已有结果时跳过语义搜索（避免首次加载延迟）
  // 关键词为 0 时仍尝试——语义搜索可能是唯一结果来源
  if (keywordMatches.length > 0 && !isModelLoaded()) {
    return { projects: keywordMatches, semanticFallback: false, matchProvenance, scores };
  }

  let semanticFallback = false;

  try {
    const limit = opts?.limit ?? 20;
    // 不传 type，搜全部类型：project(直接匹配) + task/checkpoint/spec/design/relation(反查)
    // usernames 为空时搜所有用户，否则只搜指定用户
    const allResults = await hybridSearch(query, {
      usernames: usernames.length > 0 ? usernames : undefined,
      limit: limit * 2,
    });

    for (const result of allResults) {
      const projectIds = (result.meta.projectIds as string[] | undefined) ?? [];
      if (projectIds.length === 0) continue;

      for (const pid of projectIds) {
        if (seenIds.has(pid)) continue;
        const row = findProjectById(pid);
        if (!row) continue;

        // 应用 group/tag 过滤（hybridSearch 不支持这些过滤）
        if (opts?.group) {
          const groups: string[] = row.groups ? JSON.parse(row.groups) : [];
          if (!groups.includes(opts.group)) continue;
        }
        if (opts?.tag) {
          const tags: string[] = row.tags ? JSON.parse(row.tags) : [];
          if (!tags.includes(opts.tag)) continue;
        }

        seenIds.add(pid);
        scores[pid] = result.score; // 原始 hybridSearch 融合分

        if (result.type === 'project') {
          // 项目元数据直接匹配
          directMatches.push(row);
        } else {
          // 任务文档反查匹配（task/checkpoint/spec/design/relation）
          indirectMatches.push(row);
          matchProvenance[pid] = {
            docType: result.type,
            docTitle: result.title,
            docPath: (result.meta.filePath as string | undefined) ?? '',
          };
        }
      }
    }

    const semanticCount = directMatches.length + indirectMatches.length;
    if (keywordMatches.length === 0 && semanticCount > 0) {
      semanticFallback = true;
    }
  } catch {
    // 语义搜索不可用，静默回退
  }

  return {
    projects: [...keywordMatches, ...directMatches, ...indirectMatches],
    semanticFallback,
    matchProvenance,
    scores,
  };
}

/**
 * 将项目搜索结果转换为通用 SearchResult[] 格式。
 *
 * filePath 用项目源码真实路径（local_path[0]），非 RAG 索引虚拟路径。
 * snippet：反查命中显示「通过 <docType>: <docTitle> 反查」，直接匹配显示项目描述。
 * meta.matchedVia 携带反查来源（供 CLI JSON 输出）。
 */
export function projectSearchResultsToSearchResults(result: ProjectSearchResult): SearchResult[] {
  return result.projects.map((p) => {
    const provenance = result.matchProvenance[p.id];
    const localPaths = parseProjectLocalPaths(p);
    const score = result.scores?.[p.id] ?? 1;
    return {
      type: 'project' as SearchDocumentType,
      score,
      title: p.name,
      snippet: provenance
        ? `通过 ${provenance.docType}: ${provenance.docTitle} 反查`
        : p.description || localPaths[0] || '',
      meta: {
        filePath: localPaths[0] ?? '',
        projectIds: [p.id],
        matchedVia: provenance ?? null,
      },
    };
  });
}
