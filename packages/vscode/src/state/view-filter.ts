import * as vscode from 'vscode';
import {
  EMPTY_PROJECT_FILTER,
  EMPTY_SEARCH_FILTER,
  EMPTY_SPEC_FILTER,
  ProjectFilterState,
  SearchFilterState,
  SpecFilterState,
  ViewFilterState,
  ViewFilterTarget,
} from '../views/filter-logic';
import { EMPTY_TASK_FILTER, TaskFilterState } from './task-filter-logic';

const STORAGE_KEY = 'lattice.viewFilters';
/** 旧键（任务过滤单状态）；首次加载时迁移到统一键。 */
const LEGACY_TASK_FILTER_KEY = 'lattice.taskFilter';

export type ViewFilterStates = {
  tasks: TaskFilterState;
  specs: SpecFilterState;
  projects: ProjectFilterState;
  search: SearchFilterState;
};

function sanitizeStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function uniq(value: unknown): string[] {
  return [...new Set(sanitizeStrings(value))];
}

function readTaskFilter(value: unknown): TaskFilterState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const saved = value as Partial<TaskFilterState>;
  if (!Array.isArray(saved.statuses) || !Array.isArray(saved.projectIds)) return undefined;
  return { statuses: uniq(saved.statuses), projectIds: uniq(saved.projectIds) };
}

/**
 * 四视图过滤状态（任务 / 规范 / 项目 / 搜索结果）：
 * - workspaceState 单键 `lattice.viewFilters` 持久化，按视图独立；
 * - 兼容迁移：旧键 `lattice.taskFilter`（任务过滤单状态）首次加载后并入统一键；
 * - 任务维度 matcher 见 `state/task-filter-logic.ts`，其余见 `views/filter-logic.ts`。
 */
export class ViewFilterService implements vscode.Disposable {
  private states: ViewFilterStates = {
    tasks: { ...EMPTY_TASK_FILTER },
    specs: { ...EMPTY_SPEC_FILTER },
    projects: { ...EMPTY_PROJECT_FILTER },
    search: { ...EMPTY_SEARCH_FILTER },
  };
  private readonly emitter = new vscode.EventEmitter<ViewFilterTarget>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved =
      context.workspaceState.get<Partial<Record<ViewFilterTarget, unknown>>>(STORAGE_KEY);
    let migrated = false;
    if (saved && typeof saved === 'object') {
      const tasks = readTaskFilter(saved.tasks);
      if (tasks) {
        this.states.tasks = tasks;
      } else {
        migrated = this.adoptLegacyTaskFilter();
      }
      const specs = saved.specs as Partial<SpecFilterState> | undefined;
      if (specs && typeof specs === 'object') {
        this.states.specs = {
          scopes: uniq(specs.scopes),
          projectIds: uniq(specs.projectIds),
        };
      }
      const projects = saved.projects as Partial<ProjectFilterState> | undefined;
      if (projects && typeof projects === 'object') {
        this.states.projects = {
          groups: uniq(projects.groups),
          tags: uniq(projects.tags),
        };
      }
      const search = saved.search as Partial<SearchFilterState> | undefined;
      if (search && typeof search === 'object') {
        this.states.search = {
          types: uniq(search.types),
          projectIds: uniq(search.projectIds),
        };
      }
    } else {
      migrated = this.adoptLegacyTaskFilter();
    }
    if (migrated) {
      // 迁移落盘 + 清理旧键（失败静默：下次启动重试）
      void context.workspaceState.update(STORAGE_KEY, this.states);
      void context.workspaceState.update(LEGACY_TASK_FILTER_KEY, undefined);
    }
  }

  private adoptLegacyTaskFilter(): boolean {
    const legacy = readTaskFilter(
      this.context.workspaceState.get<Partial<TaskFilterState>>(LEGACY_TASK_FILTER_KEY),
    );
    if (!legacy) return false;
    this.states.tasks = legacy;
    return true;
  }

  get(target: 'tasks'): TaskFilterState;
  get(target: 'specs'): SpecFilterState;
  get(target: 'projects'): ProjectFilterState;
  get(target: 'search'): SearchFilterState;
  get(target: ViewFilterTarget): ViewFilterState;
  get(target: ViewFilterTarget): ViewFilterState {
    return this.states[target];
  }

  isActive(target: ViewFilterTarget): boolean {
    if (target === 'tasks') {
      const state = this.states.tasks;
      return state.statuses.length > 0 || state.projectIds.length > 0;
    }
    if (target === 'specs') {
      const state = this.states.specs;
      return state.scopes.length > 0 || state.projectIds.length > 0;
    }
    if (target === 'projects') {
      const state = this.states.projects;
      return state.groups.length > 0 || state.tags.length > 0;
    }
    const state = this.states.search;
    return state.types.length > 0 || state.projectIds.length > 0;
  }

  set(target: 'tasks', next: TaskFilterState): Promise<TaskFilterState>;
  set(target: 'specs', next: SpecFilterState): Promise<SpecFilterState>;
  set(target: 'projects', next: ProjectFilterState): Promise<ProjectFilterState>;
  set(target: 'search', next: SearchFilterState): Promise<SearchFilterState>;
  set(target: ViewFilterTarget, next: ViewFilterState): Promise<ViewFilterState> {
    switch (target) {
      case 'tasks': {
        const value = next as Partial<TaskFilterState>;
        const sanitized: TaskFilterState = {
          statuses: uniq(value.statuses),
          projectIds: uniq(value.projectIds),
        };
        this.states.tasks = sanitized;
        return this.commit('tasks', sanitized);
      }
      case 'specs': {
        const value = next as Partial<SpecFilterState>;
        const sanitized: SpecFilterState = {
          scopes: uniq(value.scopes),
          projectIds: uniq(value.projectIds),
        };
        this.states.specs = sanitized;
        return this.commit('specs', sanitized);
      }
      case 'projects': {
        const value = next as Partial<ProjectFilterState>;
        const sanitized: ProjectFilterState = {
          groups: uniq(value.groups),
          tags: uniq(value.tags),
        };
        this.states.projects = sanitized;
        return this.commit('projects', sanitized);
      }
      default: {
        const value = next as Partial<SearchFilterState>;
        const sanitized: SearchFilterState = {
          types: uniq(value.types),
          projectIds: uniq(value.projectIds),
        };
        this.states.search = sanitized;
        return this.commit('search', sanitized);
      }
    }
  }

  async clear(target: ViewFilterTarget): Promise<void> {
    if (target === 'tasks') await this.set('tasks', { ...EMPTY_TASK_FILTER });
    else if (target === 'specs') await this.set('specs', { ...EMPTY_SPEC_FILTER });
    else if (target === 'projects') await this.set('projects', { ...EMPTY_PROJECT_FILTER });
    else await this.set('search', { ...EMPTY_SEARCH_FILTER });
  }

  private async commit<T>(target: ViewFilterTarget, state: T): Promise<T> {
    await this.context.workspaceState.update(STORAGE_KEY, this.states);
    this.emitter.fire(target);
    return state;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
