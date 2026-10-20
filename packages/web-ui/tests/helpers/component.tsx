import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';

/** jsdom 环境桩：antd/cytoscape 依赖的浏览器 API */
export function installDomStubs(): void {
  if (!window.matchMedia) {
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
  if (!globalThis.ResizeObserver) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as never;
  }
  if (!globalThis.IntersectionObserver) {
    class IntersectionObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = IntersectionObserverStub as never;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

export function renderUi(
  ui: React.ReactNode,
  options: { client?: QueryClient; route?: string } = {},
): RenderResult {
  const client = options.client ?? makeQueryClient();
  return render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );
}
