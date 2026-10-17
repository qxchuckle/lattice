import * as vscode from 'vscode';
import { SearchRow } from '../cli/types';

export interface SearchState {
  query: string;
  results: SearchRow[];
  loading: boolean;
  error?: string;
  at?: number;
}

/** 搜索视图状态：QuickPick 流程写入、搜索 TreeView 消费。 */
export class SearchStateService implements vscode.Disposable {
  private state: SearchState = { query: '', results: [], loading: false };
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  get current(): SearchState {
    return this.state;
  }

  get hasResults(): boolean {
    return this.state.results.length > 0 || this.state.query !== '';
  }

  set(patch: Partial<SearchState>): void {
    this.state = { ...this.state, ...patch };
    this.emitter.fire();
  }

  clear(): void {
    this.set({ query: '', results: [], loading: false, error: undefined, at: undefined });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
