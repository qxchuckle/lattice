import { useEffect, useState } from 'react';
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

// ── 响应式断点检测 ──

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

/** 检测当前视口断点。mobile <768 / tablet 768~1023 / desktop >=1024 */
export function useBreakpoint(): Breakpoint {
  const getBreakpoint = (): Breakpoint => {
    const w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  };
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const handler = () => setBp(getBreakpoint());
    mql.addEventListener('change', handler);
    window.addEventListener('resize', handler);
    return () => {
      mql.removeEventListener('change', handler);
      window.removeEventListener('resize', handler);
    };
  }, []);
  return bp;
}

/** 快捷布尔值：是否为移动端 */
export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}

/** 快捷布尔值：是否为平板 */
export function useIsTablet(): boolean {
  return useBreakpoint() === 'tablet';
}

/** 快捷布尔值：是否为移动端或平板（非桌面） */
export function useIsMobileOrTablet(): boolean {
  const bp = useBreakpoint();
  return bp === 'mobile' || bp === 'tablet';
}

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

/** 传统 debounce：延迟 delay ms 后更新值，期间输入不触发更新（比 useDeferredValue 更可靠地限制请求频率） */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useSearch() {
  const { searchKeyword, searchFilters } = useSnapshot(sidebarStore);
  const debouncedKeyword = useDebouncedValue(searchKeyword, 300);
  const adapter = getAdapter();
  const hasStatusOrScopeFilter =
    searchFilters.taskStatus.length > 0 || searchFilters.specScope.length > 0;
  const searchType = searchFilters.type === 'all' ? undefined : searchFilters.type;
  return useQuery({
    queryKey: queryKeys.search(debouncedKeyword, searchFilters.type, [
      ...searchFilters.taskStatus,
      ...searchFilters.specScope,
    ]),
    queryFn: ({ signal }) =>
      adapter.search(debouncedKeyword, {
        type: searchType,
        limit: hasStatusOrScopeFilter ? 50 : 20,
        signal,
      }),
    enabled: debouncedKeyword.length > 0,
  });
}

export function useGlobalSearch(query: string) {
  const debouncedQuery = useDebouncedValue(query, 300);
  const adapter = getAdapter();
  const { searchType } = useSnapshot(globalSearchStore);
  const searchTypeParam = searchType === 'all' ? undefined : searchType;
  return useQuery({
    queryKey: ['global-search', debouncedQuery, searchType],
    queryFn: ({ signal }) =>
      adapter.search(debouncedQuery, { type: searchTypeParam, limit: 30, signal }),
    enabled: debouncedQuery.length > 0,
  });
}
