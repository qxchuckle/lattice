import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useSnapshot } from 'valtio';
import { ErrorBoundary, getAntdThemeConfig, themeStore } from '@lattice-web-ui';
import { initHostBridge } from './host';
import { ConfigRoot } from './config-root';
import type { ConfigProgressEvent } from '@qcqx/lattice-protocol';

declare global {
  interface Window {
    __LATTICE_LANG__?: string;
    __LATTICE_THEME__?: string;
    __LATTICE_VIEW__?: string;
  }
}

function guessInitialTheme(): 'light' | 'dark' {
  if (window.__LATTICE_THEME__ === 'dark' || window.__LATTICE_THEME__ === 'light') {
    return window.__LATTICE_THEME__;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

themeStore.mode = guessInitialTheme();

function Root() {
  const { mode } = useSnapshot(themeStore);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  useEffect(() => {
    initHostBridge({
      onThemeChanged: (nextMode) => {
        themeStore.mode = nextMode;
      },
      onRouteTo: (path) => {
        window.dispatchEvent(new CustomEvent('lattice:config-route', { detail: path }));
      },
      onConfigProgress: (event: ConfigProgressEvent) => {
        window.dispatchEvent(new CustomEvent('lattice:config-progress', { detail: event }));
      },
      onConfigStateChanged: () => {
        window.dispatchEvent(new CustomEvent('lattice:config-state-changed'));
      },
    });
  }, []);

  return (
    <ConfigProvider theme={getAntdThemeConfig(mode)} locale={zhCN}>
      <AntdApp>
        <ErrorBoundary>
          <ConfigRoot />
        </ErrorBoundary>
      </AntdApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
