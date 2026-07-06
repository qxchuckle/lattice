import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntdApp } from 'antd';
import { useSnapshot } from 'valtio';
import App from './App';
import { themeStore } from './store';
import { getAntdThemeConfig } from './theme';
import { useKeyboard } from './hooks';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/global.less';

// 主题初始化由 index.html 内联脚本完成（在 CSS 加载前同步设置 data-theme + localStorage）
// store.ts 从 localStorage 读取 themeStore.mode，此时值已正确

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function Root() {
  const { mode } = useSnapshot(themeStore);
  useKeyboard();

  // 同步 data-theme 到 html 元素（CSS 变量切换）
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  return (
    <ConfigProvider theme={getAntdThemeConfig(mode)}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </BrowserRouter>
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
