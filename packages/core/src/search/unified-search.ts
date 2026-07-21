import type { SearchDocumentType, SearchResult } from '../types';
import { hybridSearch } from './search';
import { searchProjects, projectSearchResultsToSearchResults } from './project-search';
import { listAllUsernames } from '../project/cross-user';
import { enrichSpecResultsWithTaskRefs } from './spec-task-enrichment';
import { computeDynamicLimits } from './dynamic-limits';

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
    /** 每类别独立 limit（优先于全局 limit） */
    specLimit?: number;
    taskLimit?: number;
    projectLimit?: number;
    useLightweightRerank?: boolean;
    minFinalScore?: number;
  },
): Promise<SearchResult[]> {
  // 显式传 limit → 使用传入值；未传 → 动态计算
  const dynamic = opts?.limit == null ? computeDynamicLimits() : null;
  const limit = opts?.limit ?? dynamic?.spec ?? 10;

  // type=project：走 searchProjects（关键词匹配 + 反查）
  if (opts?.type === 'project') {
    const usernames = opts.usernames ?? (await listAllUsernames());
    const projectLimit = opts?.projectLimit ?? dynamic?.project ?? limit;
    const spResult = await searchProjects(usernames, query, {
      keywordOnly: false,
      limit: projectLimit,
    });
    return projectSearchResultsToSearchResults(spResult).slice(0, projectLimit);
  }

  // 具体类型（spec/task/checkpoint/design/relation）：走 hybridSearch
  if (opts?.type) {
    const typeLimit =
      opts?.limit ?? (dynamic ? (dynamic[opts.type as keyof typeof dynamic] ?? limit) : limit);
    const results = await hybridSearch(query, { ...opts, limit: typeLimit });
    // spec 搜索时反查任务关联 spec
    if (opts.type === 'spec') {
      return enrichSpecResultsWithTaskRefs(results, query, {
        projectId: opts.projectId,
        usernames: opts.usernames,
      });
    }
    return results;
  }

  // type=undefined（全部）：分类搜索，每类各自应用 limit
  const usernames = opts?.usernames ?? (await listAllUsernames());
  const specLimit = opts?.specLimit ?? dynamic?.spec ?? limit;
  const taskLimit = opts?.taskLimit ?? dynamic?.task ?? limit;
  const projectLimit = opts?.projectLimit ?? dynamic?.project ?? limit;
  const relationLimit = dynamic?.relation ?? Math.min(limit, 5);

  // 并行搜索各类别
  const [specResults, taskResults, projectResultsRaw, relationResults] = await Promise.all([
    hybridSearch(query, { ...opts, type: 'spec', limit: specLimit }),
    hybridSearch(query, { ...opts, type: 'task', limit: taskLimit }),
    searchProjects(usernames, query, { keywordOnly: false, limit: projectLimit }),
    hybridSearch(query, { ...opts, type: 'relation', limit: relationLimit }),
  ]);

  const projectResults = projectSearchResultsToSearchResults(projectResultsRaw);

  // spec 结果做任务关联 enrichment，总数仍受 specLimit 约束
  const enrichedSpecs = (
    await enrichSpecResultsWithTaskRefs(specResults, query, {
      projectId: opts?.projectId,
      usernames: opts?.usernames,
    })
  ).slice(0, specLimit);

  // 合并所有类别（各类已各自 limit，不再全局 slice）
  return [...projectResults, ...enrichedSpecs, ...taskResults, ...relationResults];
}
