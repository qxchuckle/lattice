import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useSnapshot } from 'valtio';
import {
  AppShell,
  ErrorBoundary,
  getAntdThemeConfig,
  setAdapter,
  themeStore,
  useKeyboard,
} from '@lattice-web-ui';
import { WebviewAdapter } from './adapter';
import { initHostBridge } from './host';
import { DetailRoot } from './detail-root';

declare global {
  interface Window {
    __LATTICE_LANG__?: string;
    __LATTICE_THEME__?: string;
    /** 渲染模式：'detail' = 侧栏详情视图（点哪看哪）；缺省 = 完整工作台（图谱面板） */
    __LATTICE_VIEW__?: string;
  }
}

/** 侧栏「任务详情」视图模式（宿主在 bootstrap 注入）。 */
const isDetailView = typeof window !== 'undefined' && window.__LATTICE_VIEW__ === 'detail';

// 首次渲染前完成：adapter 注入（数据接缝）+ 宿主握手在 Root effect 中建立。
const webviewAdapter = new WebviewAdapter();
setAdapter(webviewAdapter);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function guessInitialTheme(): 'light' | 'dark' {
  try {
    if (window.__LATTICE_THEME__ === 'dark' || window.__LATTICE_THEME__ === 'light') {
      return window.__LATTICE_THEME__;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// 主题初值：本地猜测；宿主 themeChanged 会在 ready 后立即纠正。
themeStore.mode = guessInitialTheme();

/** 宿主 routeTo 事件 → MemoryRouter 导航；同时把当前路径持久化到 vscode state。 */
function RouteBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (path) navigate(path);
    };
    window.addEventListener('lattice:route', handler);
    return () => window.removeEventListener('lattice:route', handler);
  }, [navigate]);
  return null;
}

function Root() {
  const { mode } = useSnapshot(themeStore);
  useKeyboard();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  useEffect(() => {
    initHostBridge({
      onSnapshotChanged: () => {
        webviewAdapter.invalidate();
        void queryClient.invalidateQueries();
      },
      onThemeChanged: (nextMode) => {
        themeStore.mode = nextMode;
      },
      onRouteTo: (path) => {
        window.dispatchEvent(new CustomEvent('lattice:route', { detail: path }));
      },
    });
  }, []);

  return (
    <ConfigProvider theme={getAntdThemeConfig(mode)} locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          {isDetailView ? (
            <DetailRoot />
          ) : (
            <MemoryRouter initialEntries={['/']}>
              <RouteBridge />
              <ErrorBoundary>
                <AppShell features={{ login: false, admin: false, terminal: false }} />
              </ErrorBoundary>
            </MemoryRouter>
          )}
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
