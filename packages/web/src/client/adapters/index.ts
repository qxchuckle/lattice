import type { LatticeDataAdapter } from './types';
import { HttpAdapter } from './http';

let currentAdapter: LatticeDataAdapter | null = null;

/** 获取当前数据 adapter（默认 HttpAdapter） */
export function getAdapter(): LatticeDataAdapter {
  if (!currentAdapter) {
    currentAdapter = new HttpAdapter();
  }
  return currentAdapter;
}

/** 设置数据 adapter（未来 VSCode 场景用 WebviewAdapter 替换） */
export function setAdapter(adapter: LatticeDataAdapter): void {
  currentAdapter = adapter;
}

export type { LatticeDataAdapter, TaskQueryOpts, SpecScope, SpecResult, SearchOpts, EditorApp, DashboardStats } from './types';
