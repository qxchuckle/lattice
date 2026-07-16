import type { ProjectRow } from '../types';
import { listProjects, findProjectById } from '../project';
import { semanticSearch } from '../rag';
import { isModelLoaded } from '../rag/embeddings';

/**
 * 项目搜索结果：合并关键词匹配与语义搜索结果。
 *
 * - keywordMatches：listProjects 子串匹配（快路径，无需模型）
 * - semanticMatches：semanticSearch 向量检索（需要 embedding 模型）
 *
 * 合并策略：keywordMatches 优先，semantic-only 结果去重后追加。
 * RAG 不可用时静默回退为纯关键词匹配。
 */
export async function searchProjects(
  username: string,
  query: string,
  opts?: {
    group?: string;
    tag?: string;
    keywordOnly?: boolean;
    limit?: number;
  },
): Promise<{ projects: ProjectRow[]; semanticFallback: boolean }> {
  // 1. 关键词匹配（快路径）
  const keywordMatches = listProjects(username, {
    group: opts?.group,
    tag: opts?.tag,
    search: query,
  });

  // 2. 若显式要求 keyword-only，直接返回
  if (opts?.keywordOnly) {
    return { projects: keywordMatches, semanticFallback: false };
  }

  // 3. 语义搜索（补充路径）
  let semanticFallback = false;
  const semanticProjects: ProjectRow[] = [];

  try {
    // RAG 模型未加载时跳过语义搜索（避免首次加载延迟）
    // 但关键词匹配为 0 时仍尝试——语义搜索可能是唯一结果来源
    if (keywordMatches.length > 0 && !isModelLoaded()) {
      // 模型未加载且关键词已有结果，跳过语义搜索
    } else {
      const limit = opts?.limit ?? 20;
      const semanticResults = await semanticSearch(query, limit, {
        type: 'project',
        usernames: [username],
      });

      // 映射 semanticResults → ProjectRow
      const seenIds = new Set(keywordMatches.map((p) => p.id));
      for (const result of semanticResults) {
        const projectIds = result.projectIds ?? (result.projectId ? [result.projectId] : []);
        for (const pid of projectIds) {
          if (seenIds.has(pid)) continue;
          const row = findProjectById(pid);
          if (!row) continue;
          // 应用 group/tag 过滤（semanticSearch 不支持这些过滤）
          if (opts?.group) {
            const groups: string[] = row.groups ? JSON.parse(row.groups) : [];
            if (!groups.includes(opts.group)) continue;
          }
          if (opts?.tag) {
            const tags: string[] = row.tags ? JSON.parse(row.tags) : [];
            if (!tags.includes(opts.tag)) continue;
          }
          seenIds.add(pid);
          semanticProjects.push(row);
        }
      }

      if (semanticProjects.length > 0) {
        semanticFallback = keywordMatches.length === 0;
      }
    }
  } catch {
    // 语义搜索不可用，静默回退
  }

  return {
    projects: [...keywordMatches, ...semanticProjects],
    semanticFallback,
  };
}
