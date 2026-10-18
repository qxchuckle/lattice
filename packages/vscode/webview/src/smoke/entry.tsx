/**
 * Webview 冒烟入口（仅开发期；不进 VSIX）：在 Node + jsdom 里渲染真实 webview 应用壳，
 * 数据链路与扩展运行时完全一致 = WebviewAdapter(transport 注入) → bridge-requests → LatticeDataService（进程内 core）。
 *
 * 与 main.tsx 的差异：
 * - 不建立 postMessage 宿主握手（initHostBridge），transport 直接进程内调用
 * - queryClient retry=0（冒烟要快速暴露错误而不是重试掩盖）
 * - 画布用 SmokeGraph（真实 useGlobalGraph 管线 + DOM 占位）
 * - 暴露 window.__smoke 驱动 API 供 tests/smoke/run.mjs 操作与断言
 */
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter } from 'react-router';
import {
  AppShell,
  ErrorBoundary,
  canvasStore,
  detailStore,
  getAntdThemeConfig,
  globalSearchStore,
  setAdapter,
  sidebarStore,
  themeStore,
} from '@lattice-web-ui';
import { LatticeDataService } from '../../../src/data/service';
import { SnapshotStore } from '../../../src/state/snapshot';
import { handleBridgeRequest } from '../../../src/webview/bridge-requests';
import { WebviewAdapter } from '../adapter';
import { DetailRoot } from '../detail-root';
import { SmokeGraph } from './graph-stub';

const data = new LatticeDataService();
const snapshot = new SnapshotStore({ data });

const transport = {
  request: <T,>(method: Parameters<typeof handleBridgeRequest>[1], params?: unknown): Promise<T> =>
    handleBridgeRequest({ snapshot }, method, params) as Promise<T>,
  action: (): void => {},
};

const adapter = new WebviewAdapter(transport);
setAdapter(adapter);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 30_000, retry: 0 },
  },
});

themeStore.mode = 'light';

function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider theme={getAntdThemeConfig(themeStore.mode)} locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}

function Root() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeStore.mode);
  }, []);

  return (
    <Providers>
      <MemoryRouter initialEntries={['/']}>
        <ErrorBoundary>
          <AppShell features={{ login: false, admin: false, terminal: false }} Graph={SmokeGraph} />
        </ErrorBoundary>
      </MemoryRouter>
    </Providers>
  );
}

/** 复刻图节点点击路径（CytoscapeGraph: selectNode(node.id(), data.entityType, data)）。 */
function driveSelect(nodeId: string, entityType: string, data: unknown): void {
  canvasStore.selectedNodeId = nodeId;
  detailStore.open = true;
  detailStore.collapsed = false;
  detailStore.entityId = nodeId;
  detailStore.entityType = entityType as never;
  detailStore.entityData = (data ?? null) as never;
}

export interface SmokeApi {
  queryClient: QueryClient;
  adapter: WebviewAdapter;
  driveSelect: (nodeId: string, entityType: string, data: unknown) => void;
  closeDetail: () => void;
  getProjects: () => ReturnType<WebviewAdapter['getProjects']>;
  getTasks: () => ReturnType<WebviewAdapter['getTasks']>;
  getSpecs: () => ReturnType<WebviewAdapter['getSpecs']>;
  /** 挂载侧栏「详情」根组件（path 形如 /task/<id> · /spec/<id> · /project/<id>；缺省=空态）。 */
  renderDetail: (path?: string) => Promise<void>;
  /** 退出前显式关闭数据面（避免 better-sqlite3 终结器与 process.exit 竞争）。 */
  shutdown: () => void;
  stores: {
    canvasStore: typeof canvasStore;
    detailStore: typeof detailStore;
    globalSearchStore: typeof globalSearchStore;
    sidebarStore: typeof sidebarStore;
  };
}

declare global {
  interface Window {
    __smoke?: SmokeApi;
  }
}

window.__smoke = {
  queryClient,
  adapter,
  driveSelect,
  closeDetail: () => {
    detailStore.open = false;
    detailStore.entityId = null;
    detailStore.entityType = null;
    detailStore.entityData = null;
    canvasStore.selectedNodeId = null;
  },
  getProjects: () => adapter.getProjects(),
  getTasks: () => adapter.getTasks(),
  getSpecs: () => adapter.getSpecs(),
  renderDetail: async (path?: string) => {
    // 复用同一 root 切换渲染树（避免 unmount + 二次 createRoot 在 jsdom/SSR 环境下的清理竞争）
    activeRoot.render(
      <StrictMode>
        <Providers>
          <DetailRoot initialPath={path ?? '/detail'} />
        </Providers>
      </StrictMode>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  },
  shutdown: () => {
    data.dispose();
  },
  stores: { canvasStore, detailStore, globalSearchStore, sidebarStore },
};

const activeRoot = createRoot(document.getElementById('root')!);
activeRoot.render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
