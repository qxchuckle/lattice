import * as vscode from 'vscode';
import {
  EMPTY_VIEW_SEARCH,
  isViewSearchActive,
  type ViewSearchState,
} from '../views/view-search-logic';

/** 支持搜索的视图。 */
export type ViewSearchTarget = 'tasks' | 'specs' | 'projects';

const TARGETS: ViewSearchTarget[] = ['tasks', 'specs', 'projects'];
const STORAGE_KEY = 'lattice.viewSearch';

/**
 * 三视图搜索状态（workspaceState 持久化；按视图独立）。
 * 过滤只影响对应视图树，不影响命令面板 / 全局搜索 / 数据面。
 */
export class ViewSearchService implements vscode.Disposable {
  private state: Record<ViewSearchTarget, ViewSearchState> = {
    tasks: { ...EMPTY_VIEW_SEARCH },
    specs: { ...EMPTY_VIEW_SEARCH },
    projects: { ...EMPTY_VIEW_SEARCH },
  };
  private readonly emitter = new vscode.EventEmitter<ViewSearchTarget>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved =
      context.workspaceState.get<Partial<Record<ViewSearchTarget, ViewSearchState>>>(STORAGE_KEY);
    if (saved && typeof saved === 'object') {
      for (const target of TARGETS) {
        const entry = saved[target];
        if (entry && typeof entry.query === 'string') {
          this.state[target] = {
            query: entry.query,
            contentIds: Array.isArray(entry.contentIds)
              ? entry.contentIds.filter((id): id is string => typeof id === 'string')
              : [],
          };
        }
      }
    }
  }

  get(target: ViewSearchTarget): ViewSearchState {
    return this.state[target];
  }

  isActive(target: ViewSearchTarget): boolean {
    return isViewSearchActive(this.state[target]);
  }

  async set(target: ViewSearchTarget, next: ViewSearchState): Promise<ViewSearchState> {
    this.state[target] = {
      query: next.query,
      contentIds: [...new Set(next.contentIds)],
    };
    await this.persist();
    this.emitter.fire(target);
    return this.state[target];
  }

  async clear(target: ViewSearchTarget): Promise<ViewSearchState> {
    return this.set(target, { ...EMPTY_VIEW_SEARCH });
  }

  private async persist(): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY, this.state);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
