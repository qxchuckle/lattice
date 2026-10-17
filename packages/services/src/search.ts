/** 搜索域：统一搜索入口（FTS + 语义融合；多类型 fan-out）。 */
import { unifiedSearch } from '@qcqx/lattice-core';
import type { SearchDocumentType, SearchResult } from '@qcqx/lattice-core';

export interface SearchOptions {
  /** 文档类型过滤（多个类型在当前 core 单类型 API 上做 fan-out 合并）。 */
  types?: string[];
  limit?: number;
  projectId?: string;
  /**
   * 限定用户；**不传 = core 默认全用户检索**（与 CLI/web 既有行为一致）。
   * 单用户宿主可显式传 [username] 收窄。
   */
  usernames?: string[];
}

export async function search(
  username: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined;
  const types = (opts.types ?? []).filter(Boolean) as SearchDocumentType[];
  const usernames = opts.usernames;

  if (types.length > 1) {
    const batches = await Promise.all(
      types.map((type) => unifiedSearch(query, { type, usernames, limit })),
    );
    return batches.flat();
  }

  return unifiedSearch(query, {
    type: types[0],
    projectId: opts.projectId,
    usernames,
    limit,
  });
}
