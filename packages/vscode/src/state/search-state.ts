import * as vscode from 'vscode';
import { SearchRow } from '../cli/types';

export interface SearchState {
  query: string;
  results: SearchRow[];
  loading: boolean;
  error?: string;
  at?: number;
}

const STORAGE_KEY = 'lattice.searchState';
/** 持久化结果上限（重载恢复用；超出截断）。 */
const MAX_PERSISTED_RESULTS = 100;

/** 搜索视图状态：QuickPick 流程写入、搜索 TreeView 消费；query/results 持久化（重载恢复）。 */
export class SearchStateService implements vscode.Disposable {
  private state: SearchState = { query: '', results: [], loading: false };
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context?: vscode.ExtensionContext) {
    const saved = context?.workspaceState.get<Partial<SearchState>>(STORAGE_KEY);
    if (saved && typeof saved.query === 'string' && Array.isArray(saved.results)) {
      this.state = {
        query: saved.query,
        results: saved.results.slice(0, MAX_PERSISTED_RESULTS) as SearchRow[],
        loading: false,
        at: typeof saved.at === 'number' ? saved.at : undefined,
      };
    }
  }

  get current(): SearchState {
    return this.state;
  }

  get hasResults(): boolean {
    return this.state.results.length > 0 || this.state.query !== '';
  }

  set(patch: Partial<SearchState>): void {
    this.state = { ...this.state, ...patch };
    void this.persist();
    this.emitter.fire();
  }

  clear(): void {
    this.set({ query: '', results: [], loading: false, error: undefined, at: undefined });
  }

  private async persist(): Promise<void> {
    if (!this.context) return;
    const { query, results, at, error } = this.state;
    await this.context.workspaceState.update(STORAGE_KEY, {
      query,
      results: results.slice(0, MAX_PERSISTED_RESULTS),
      at,
      error,
    });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
