/**
 * 视图搜索纯逻辑（任务 / 规范 / 项目三视图共用）。
 *
 * 匹配规则：
 * - 空查询 → 全部通过；
 * - 名称类字段（标题 / 描述 / 标签 / 路径 / id）大小写不敏感子串命中；
 * - `contentIds`（全文检索 FTS 命中的实体 id）并集命中。
 */

export interface ViewSearchState {
  query: string;
  /** 全文检索命中的实体 id（spec id / task id / project id）。 */
  contentIds: string[];
}

export const EMPTY_VIEW_SEARCH: ViewSearchState = { query: '', contentIds: [] };

export function isViewSearchActive(state: ViewSearchState | undefined): boolean {
  return state !== undefined && state.query.trim().length > 0;
}

export function matchesViewSearch(opts: {
  /** 名称类字段（title / description / tags / path / id …）。 */
  fields: Array<string | null | undefined>;
  /** 实体 id（与 contentIds 求交用）。 */
  ids?: Array<string | null | undefined>;
  state: ViewSearchState | undefined;
}): boolean {
  const state = opts.state;
  if (!state || state.query.trim() === '') return true;
  const needle = state.query.trim().toLowerCase();

  for (const field of opts.fields) {
    if (field && field.toLowerCase().includes(needle)) return true;
  }

  if (state.contentIds.length > 0 && opts.ids && opts.ids.length > 0) {
    const content = new Set(state.contentIds);
    for (const id of opts.ids) {
      if (id && content.has(id)) return true;
    }
  }
  return false;
}
