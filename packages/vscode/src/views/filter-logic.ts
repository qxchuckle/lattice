import { ProjectRow, SearchRow, SpecRow } from '../cli/types';
import { EMPTY_TASK_FILTER, TaskFilterState } from '../state/task-filter-logic';

/**
 * 视图过滤纯逻辑（规范 / 项目 / 搜索结果三视图；任务过滤见 state/task-filter-logic.ts）。
 * 约定：每个维度内 OR、维度间 AND；空数组 = 该维度不过滤。
 */

// ── 规范：层级 × 项目 ──

export interface SpecFilterState {
  /** 层级：project / user / global。 */
  scopes: string[];
  /** 项目 id（仅对 project 级 spec 生效；启用时 user/global 隐藏）。 */
  projectIds: string[];
}

export const EMPTY_SPEC_FILTER: SpecFilterState = { scopes: [], projectIds: [] };

export function specMatchesFilter(
  spec: Pick<SpecRow, 'scope' | 'projectId'>,
  filter: SpecFilterState,
  canonical: (id: string) => string,
): boolean {
  if (filter.scopes.length > 0 && !filter.scopes.includes(spec.scope)) return false;
  if (filter.projectIds.length > 0) {
    if (spec.scope !== 'project' || !spec.projectId) return false;
    const wanted = new Set(filter.projectIds.map((id) => canonical(id)));
    if (!wanted.has(canonical(spec.projectId))) return false;
  }
  return true;
}

// ── 项目：分组 × 标签 ──

export interface ProjectFilterState {
  groups: string[];
  tags: string[];
}

export const EMPTY_PROJECT_FILTER: ProjectFilterState = { groups: [], tags: [] };

/** 逗号串（ProjectRow.groups / tags）→ 去重列表。 */
export function parseListValue(value: string | null | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/** 分组过滤为子树语义：选「工作」覆盖 工作/** 全部后代（与 core/CLI 一致）。 */
export function groupSubtreeMatch(target: string, candidate: string): boolean {
  return candidate === target || candidate.startsWith(`${target}/`);
}

export function projectMatchesFilter(
  project: Pick<ProjectRow, 'groups' | 'tags'>,
  filter: ProjectFilterState,
): boolean {
  if (filter.groups.length > 0) {
    const groups = parseListValue(project.groups);
    if (
      !groups.some((group) => filter.groups.some((selected) => groupSubtreeMatch(selected, group)))
    ) {
      return false;
    }
  }
  if (filter.tags.length > 0) {
    const tags = parseListValue(project.tags);
    if (!tags.some((tag) => filter.tags.includes(tag))) return false;
  }
  return true;
}

// ── 搜索结果：类型 × 项目 ──

export interface SearchFilterState {
  /** 结果类型（task / prd / design / spec / project / checkpoint / relation）。 */
  types: string[];
  projectIds: string[];
}

export const EMPTY_SEARCH_FILTER: SearchFilterState = { types: [], projectIds: [] };

export function searchResultMatchesFilter(
  row: Pick<SearchRow, 'type' | 'projectIds'>,
  filter: SearchFilterState,
  canonical: (id: string) => string,
): boolean {
  if (filter.types.length > 0 && !filter.types.includes(row.type)) return false;
  if (filter.projectIds.length > 0) {
    const wanted = new Set(filter.projectIds.map((id) => canonical(id)));
    if (!row.projectIds.some((id) => wanted.has(canonical(id)))) return false;
  }
  return true;
}

// ── 统一形状（ViewFilterService 存储；任务过滤沿用既有 matcher 纯函数） ──

export type ViewFilterTarget = 'tasks' | 'specs' | 'projects' | 'search';
export type ViewFilterState =
  | TaskFilterState
  | SpecFilterState
  | ProjectFilterState
  | SearchFilterState;

export const EMPTY_VIEW_FILTERS: {
  tasks: TaskFilterState;
  specs: SpecFilterState;
  projects: ProjectFilterState;
  search: SearchFilterState;
} = {
  tasks: { ...EMPTY_TASK_FILTER },
  specs: { ...EMPTY_SPEC_FILTER },
  projects: { ...EMPTY_PROJECT_FILTER },
  search: { ...EMPTY_SEARCH_FILTER },
};
