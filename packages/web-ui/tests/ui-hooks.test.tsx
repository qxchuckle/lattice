import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useBreakpoint,
  useDebouncedValue,
  useGlobalSearch,
  useIsMobile,
  useIsMobileOrTablet,
  useIsTablet,
  useKeyboard,
  useSearch,
  useTheme,
} from '../src/hooks/ui';
import { setAdapter } from '../src/adapters';
import {
  canvasSearchStore,
  canvasStore,
  clearToken,
  detailStore,
  globalSearchStore,
  sidebarStore,
  themeStore,
} from '../src/store';

// ── jsdom 环境桩 ──

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function resetStores(): void {
  clearToken();
  canvasStore.viewMode = 'global';
  canvasStore.selectedNodeId = null;
  canvasSearchStore.open = false;
  globalSearchStore.open = false;
  globalSearchStore.searchType = 'all';
  sidebarStore.searchKeyword = '';
  sidebarStore.searchFilters = { type: 'all', taskStatus: [], specScope: [] };
  themeStore.mode = 'light';
  detailStore.open = false;
  detailStore.entityId = null;
}

beforeEach(() => {
  resetStores();
  stubMatchMedia();
  setWidth(1200);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ── 断点 ──

describe('useBreakpoint 与快捷布尔', () => {
  it('按窗口宽度返回 mobile/tablet/desktop，并响应 resize', () => {
    setWidth(500);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('mobile');

    act(() => {
      setWidth(800);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe('tablet');

    act(() => {
      setWidth(1400);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe('desktop');
  });

  it('useIsMobile / useIsTablet / useIsMobileOrTablet 组合语义', () => {
    setWidth(500);
    const mobile = renderHook(() => ({
      m: useIsMobile(),
      t: useIsTablet(),
      mt: useIsMobileOrTablet(),
    }));
    expect(mobile.result.current).toEqual({ m: true, t: false, mt: true });

    setWidth(800);
    const tablet = renderHook(() => ({
      m: useIsMobile(),
      t: useIsTablet(),
      mt: useIsMobileOrTablet(),
    }));
    expect(tablet.result.current).toEqual({ m: false, t: true, mt: true });

    setWidth(1400);
    const desktop = renderHook(() => useIsMobileOrTablet());
    expect(desktop.result.current).toBe(false);
  });
});

// ── 主题 ──

describe('useTheme', () => {
  it('读取当前主题并可切换', async () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('light');
    act(() => result.current.toggle());
    expect(themeStore.mode).toBe('dark');
    await waitFor(() => expect(result.current.mode).toBe('dark'));
    act(() => result.current.toggle());
    expect(themeStore.mode).toBe('light');
    await waitFor(() => expect(result.current.mode).toBe('light'));
  });
});

// ── 快捷键 ──

describe('useKeyboard', () => {
  function key(keyName: string, init: KeyboardEventInit = {}, target: EventTarget = window): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...init }));
    });
  }

  it('Cmd/Ctrl+F 切换画布搜索；Ctrl+P 切换全局搜索', () => {
    renderHook(() => useKeyboard());

    key('f', { ctrlKey: true });
    expect(canvasSearchStore.open).toBe(true);
    key('f', { ctrlKey: true });
    expect(canvasSearchStore.open).toBe(false);

    key('p', { metaKey: true });
    expect(globalSearchStore.open).toBe(true);
    key('p', { metaKey: true });
    expect(globalSearchStore.open).toBe(false);
  });

  it('Cmd/Ctrl+K 聚焦侧栏搜索框', () => {
    renderHook(() => useKeyboard());
    const input = document.createElement('input');
    input.id = 'sidebar-search-input';
    document.body.appendChild(input);
    key('k', { ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('数字键 1-4 切换视角；输入框聚焦时不触发', () => {
    renderHook(() => useKeyboard());

    key('3');
    expect(canvasStore.viewMode).toBe('project');
    key('4');
    expect(canvasStore.viewMode).toBe('spec');

    const input = document.createElement('input');
    document.body.appendChild(input);
    key('2', {}, input);
    expect(canvasStore.viewMode).toBe('spec');
  });

  it('Esc 按优先级关闭：全局搜索 → 画布搜索 → 详情面板', () => {
    renderHook(() => useKeyboard());

    globalSearchStore.open = true;
    canvasSearchStore.open = true;
    detailStore.open = true;
    key('Escape');
    expect(globalSearchStore.open).toBe(false);
    expect(canvasSearchStore.open).toBe(true);

    key('Escape');
    expect(canvasSearchStore.open).toBe(false);
    expect(detailStore.open).toBe(true);

    detailStore.entityId = 'legacy:p1';
    key('Escape');
    expect(detailStore.open).toBe(false);
    expect(detailStore.entityId).toBeNull();
  });

  it('f 键清空选中节点；卸载后监听移除', () => {
    const { unmount } = renderHook(() => useKeyboard());
    canvasStore.selectedNodeId = 'node-1';
    key('f');
    expect(canvasStore.selectedNodeId).toBeNull();

    unmount();
    canvasSearchStore.open = false;
    key('f', { ctrlKey: true });
    expect(canvasSearchStore.open).toBe(false);
  });
});

// ── debounce ──

describe('useDebouncedValue', () => {
  it('延迟窗口内保持旧值，到期后更新', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    expect(result.current).toBe('a');

    rerender({ value: 'b' });
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('b');
  });
});

// ── 搜索 hooks（Query + adapter） ──

describe('useSearch / useGlobalSearch', () => {
  function makeWrapper() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);
  }

  it('useSearch：空关键词不请求；输入后按类型/上限发起查询', async () => {
    const searchMock = vi.fn(async () => []);
    setAdapter({ search: searchMock } as never);
    const wrapper = makeWrapper();

    const { rerender } = renderHook(() => useSearch(), { wrapper });
    expect(searchMock).not.toHaveBeenCalled();

    sidebarStore.searchKeyword = '登录';
    rerender();
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(searchMock.mock.calls[0][0]).toBe('登录');
    expect(searchMock.mock.calls[0][1]).toMatchObject({ type: undefined, limit: 20 });

    // 带状态/范围筛选时 limit 提升到 50
    sidebarStore.searchKeyword = '登录2';
    sidebarStore.searchFilters = { type: 'task', taskStatus: ['completed'], specScope: [] };
    rerender();
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(searchMock.mock.calls[1][1]).toMatchObject({ type: 'task', limit: 50 });
  });

  it('useGlobalSearch：按全局面板 searchType 查询，limit 30', async () => {
    const searchMock = vi.fn(async () => []);
    setAdapter({ search: searchMock } as never);
    const wrapper = makeWrapper();

    globalSearchStore.searchType = 'spec';
    const { rerender } = renderHook(({ q }) => useGlobalSearch(q), {
      wrapper,
      initialProps: { q: '' },
    });
    expect(searchMock).not.toHaveBeenCalled();

    rerender({ q: '规范' });
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(searchMock.mock.calls[0][0]).toBe('规范');
    expect(searchMock.mock.calls[0][1]).toMatchObject({ type: 'spec', limit: 30 });
  });
});
