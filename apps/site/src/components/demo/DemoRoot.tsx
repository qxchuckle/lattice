import { StrictMode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntdApp } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter } from 'react-router';
import { useSnapshot } from 'valtio';
import {
  AppShell,
  ErrorBoundary,
  getAntdThemeConfig,
  setAdapter,
  themeStore,
  useKeyboard,
} from '@qcqx/lattice-web-ui';
import { MockAdapter } from '../../demo/mock/adapter';
import '../../demo/demo.css';

const adapter = new MockAdapter();
setAdapter(adapter);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      retry: 0,
    },
  },
});

const isZh = window.__LATTICE_LANG__ === 'zh-cn';

function DemoBadge() {
  return (
    <button
      type='button'
      className='demo-badge'
      title={isZh ? '全部数据均为模拟数据；刷新即可重置' : 'All data is mocked. Refresh to reset.'}
      onClick={() => window.location.reload()}>
      <span aria-hidden='true' />
      {isZh ? '模拟数据 · 重置' : 'Demo data · Reset'}
    </button>
  );
}

export default function DemoRoot() {
  const { mode } = useSnapshot(themeStore);
  useKeyboard();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    document.getElementById('demo-loading')?.classList.add('is-hidden');
    document.documentElement.dataset.demoReady = 'true';
  }, [mode]);

  return (
    <StrictMode>
      <ConfigProvider theme={getAntdThemeConfig(mode)} locale={isZh ? zhCN : enUS}>
        <AntdApp>
          <QueryClientProvider client={queryClient}>
            <HashRouter>
              <ErrorBoundary>
                <AppShell features={{ login: false, admin: false, terminal: false }} />
              </ErrorBoundary>
              <DemoBadge />
            </HashRouter>
          </QueryClientProvider>
        </AntdApp>
      </ConfigProvider>
    </StrictMode>
  );
}

if (import.meta.env.DEV) {
  (window as Window & { __demo?: unknown }).__demo = { adapter, queryClient };
}
