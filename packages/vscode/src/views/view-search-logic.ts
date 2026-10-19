/**
 * 视图搜索纯逻辑（任务 / 规范 / 项目三视图共用）。
 *
 * 匹配规则：
 * - 空查询 → 全部通过；
 * - 名称类字段（标题 / 描述 / 标签 / 路径 / id）大小写不敏感子串命中；
 * - `contentIds`（全文检索 FTS 命中的实体 id）并集命中。
 */

import type { SearchRow } from '../cli/types';

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

/** 命中标记：区分「名称类字段命中」与「仅全文命中」（预览列表展示/排序用）。 */
export function viewSearchMatchFlags(opts: {
  fields: Array<string | null | undefined>;
  ids?: Array<string | null | undefined>;
  state: ViewSearchState;
}): { matched: boolean; nameMatched: boolean } {
  const nameMatched = matchesViewSearch({
    fields: opts.fields,
    ids: opts.ids,
    state: { query: opts.state.query, contentIds: [] },
  });
  if (nameMatched) return { matched: true, nameMatched: true };
  return {
    matched: matchesViewSearch(opts),
    nameMatched: false,
  };
}

/** 实时预览行（由各 provider 的过滤管道产出；与树内容严格同源）。 */
export type ViewSearchPreviewKind = 'task' | 'spec' | 'project';

export interface ViewSearchPreviewRow {
  kind: ViewSearchPreviewKind;
  id: string;
  label: string;
  description?: string;
  /** true = 仅经全文检索命中（名称字段不匹配）。 */
  contentOnly: boolean;
}

/** 预览服务与命令侧共用的目标配置（FTS 类型 / id 收集 / 标题）。 */
export interface ViewSearchTargetConfig {
  inputTitle: string;
  /** 全文检索（FTS）纳入的文档类型。 */
  ftsTypes: string[];
  /** 从搜索结果行收集本视图的实体 id。 */
  collectIds: (row: SearchRow) => string[];
}

export type ViewSearchPreviewTarget = 'tasks' | 'specs' | 'projects';
