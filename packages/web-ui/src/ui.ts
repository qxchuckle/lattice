/**
 * Web 客户端对外 UI 面（唯一可被其它宿主 / Webview 构建引用的入口）。
 *
 * 约定（对齐主流多端实践，如 GitLens `packages/components`、Continue `gui` 包）：
 * - 这里只导出「视图组件 / 状态 / 主题 / 适配器类型」；宿主相关的桥、消息协议、构建入口
 *   一律归属宿主包（如 packages/vscode/webview），不得反向 import 本包内部实现。
 * - 数据访问一律经 adapters 接缝（getAdapter/setAdapter），宿主在渲染前注入自己的 adapter。
 * - 引入本文件会附带全局样式（global.less）。
 */

import './styles/global.less';

// ── 视图 ──
export { AppShell, type AppShellFeatures } from './components/AppShell';
export { CytoscapeGraph } from './components/CytoscapeGraph';
export { DetailPanel } from './components/DetailPanel';
export { TreeBrowserSidebar } from './components/sidebar/TreeBrowserSidebar';
export { FloatingStatusBar } from './components/FloatingStatusBar';
export { GlobalSearchPanel } from './components/GlobalSearchPanel';
export { ErrorBoundary } from './components/ErrorBoundary';

// ── 状态与主题 ──
export {
  themeStore,
  canvasStore,
  detailStore,
  sidebarStore,
  authStore,
  globalSearchStore,
  closeDetail,
  selectNode,
  toggleDetailCollapse,
  setDetailWidth,
  closeMobileSidebar,
} from './store';
export { getAntdThemeConfig } from './theme';

// ── hooks ──
export { useKeyboard, useIsMobile, useGlobalGraph } from './hooks';
export type { DomainDataPack } from './hooks/data';

// ── 数据接缝（宿主注入 adapter） ──
export { getAdapter, setAdapter } from './adapters';
export type {
  LatticeDataAdapter,
  TaskQueryOpts,
  SpecScope,
  SpecResult,
  SearchOpts,
  EditorApp,
  DashboardStats,
  GlobalStatusLite,
  TaskContextResult,
  UsersResult,
  DoctorOptions,
  ModelStatus,
  TrashItem,
} from './adapters/types';

// ── 宿主探测 ──
export { isWebviewHost } from './host-mode';
