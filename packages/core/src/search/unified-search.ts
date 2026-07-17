import type { SearchDocumentType, SearchResult } from '../types';
import { hybridSearch } from './search';
import { searchProjects, projectSearchResultsToSearchResults } from './project-search';
import { listAllUsernames } from '../project/cross-user';

/**
 * 统一搜索入口：合并 hybridSearch（文档搜索）和 searchProjects（项目搜索）。
 *
 * - type=project → searchProjects（关键词匹配 + hybridSearch 全类型反查 projectIds）
 * - type=具体类型 → hybridSearch
 * - type=undefined(全部) → hybridSearch + searchProjects 合并去重
 *
 * 调用方（CLI / web 路由）只需调用此函数，不再自行分支。
 */
export async function unifiedSearch(
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

  // type=project：走 searchProjects（关键词匹配 + 反查）
  if (opts?.type === 'project') {
    const usernames = opts.usernames ?? (await listAllUsernames());
    const spResult = await searchProjects(usernames, query, {
      keywordOnly: false,
      limit,
    });
    return projectSearchResultsToSearchResults(spResult).slice(0, limit);
  }

  // 具体类型（spec/task/checkpoint/design/relation）：走 hybridSearch
  if (opts?.type) {
    return hybridSearch(query, opts);
  }

  // type=undefined（全部）：hybridSearch + searchProjects 合并
  const hybridResults = await hybridSearch(query, opts);

  const usernames = opts?.usernames ?? (await listAllUsernames());
  const spResult = await searchProjects(usernames, query, {
    keywordOnly: false,
    limit,
  });
  const projectResults = projectSearchResultsToSearchResults(spResult);

  // 按 projectIds 去重：hybridSearch 已返回的项目不再追加
  const existingProjectIds = new Set<string>();
  for (const r of hybridResults) {
    if (r.type === 'project') {
      const pids = (r.meta.projectIds as string[] | undefined) ?? [];
      for (const pid of pids) existingProjectIds.add(pid);
    }
  }

  const merged = [...hybridResults];
  for (const r of projectResults) {
    const pids = (r.meta.projectIds as string[] | undefined) ?? [];
    const isDuplicate = pids.length > 0 && pids.some((pid) => existingProjectIds.has(pid));
    if (!isDuplicate) {
      merged.push(r);
    }
  }

  // 按 score 降序，slice 到 limit
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}
