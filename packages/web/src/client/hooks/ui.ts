import { useEffect, useDeferredValue } from 'react';
import { useSnapshot } from 'valtio';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '../adapters';
import { queryKeys } from '../lib';
import {
  canvasStore,
  canvasSearchStore,
  sidebarStore,
  globalSearchStore,
  toggleTheme,
  themeStore,
  closeDetail,
  openCanvasSearch,
  closeCanvasSearch,
  openGlobalSearch,
  closeGlobalSearch,
  type ViewMode,
} from '../store';

export function useTheme() {
  const { mode } = useSnapshot(themeStore);
  return { mode, toggle: toggleTheme };
}

export function useKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Cmd/Ctrl + F → 切换画布搜索（已开则关，未开则开）
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        if (canvasSearchStore.open) {
          closeCanvasSearch();
        } else {
          openCanvasSearch();
        }
        return;
      }

      // Cmd/Ctrl + K → 聚焦搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('#sidebar-search-input');
        input?.focus();
        return;
      }

      // Cmd/Ctrl + P → 全局搜索面板
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        if (globalSearchStore.open) {
          closeGlobalSearch();
        } else {
          openGlobalSearch();
        }
        return;
      }

      // 输入框聚焦时不触发以下非修饰键快捷键
      if (isInputFocused) return;

      // 数字键 1-4 → 切换视角
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[1-4]$/.test(e.key)) {
        const modes: ViewMode[] = ['global', 'task', 'project', 'spec'];
        const idx = parseInt(e.key, 10) - 1;
        if (idx < modes.length) {
          canvasStore.viewMode = modes[idx];
        }
      }
      // Esc → 关闭全局搜索/画布搜索或详情面板
      if (e.key === 'Escape') {
        if (globalSearchStore.open) {
          closeGlobalSearch();
        } else if (canvasSearchStore.open) {
          closeCanvasSearch();
        } else {
          closeDetail();
        }
      }
      // F → 重置画布视口
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        canvasStore.selectedNodeId = null;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

export function useSearch() {
  const { searchKeyword, searchFilters } = useSnapshot(sidebarStore);
  const debouncedKeyword = useDeferredValue(searchKeyword);
  const adapter = getAdapter();
  const hasStatusOrScopeFilter =
    searchFilters.taskStatus.length > 0 || searchFilters.specScope.length > 0;
  const searchType = searchFilters.type === 'all' ? undefined : searchFilters.type;
  return useQuery({
    queryKey: queryKeys.search(debouncedKeyword, searchFilters.type, [
      ...searchFilters.taskStatus,
      ...searchFilters.specScope,
    ]),
    queryFn: () =>
      adapter.search(debouncedKeyword, {
        type: searchType,
        limit: hasStatusOrScopeFilter ? 50 : 20,
      }),
    enabled: debouncedKeyword.length > 0,
    staleTime: 30_000,
  });
}

export function useGlobalSearch(query: string) {
  const debouncedQuery = useDeferredValue(query);
  const adapter = getAdapter();
  const { searchType } = useSnapshot(globalSearchStore);
  const searchTypeParam = searchType === 'all' ? undefined : searchType;
  return useQuery({
    queryKey: ['global-search', debouncedQuery, searchType],
    queryFn: () => adapter.search(debouncedQuery, { type: searchTypeParam, limit: 30 }),
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000,
  });
}
