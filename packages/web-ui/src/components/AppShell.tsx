import { useEffect, useCallback, memo, lazy, Suspense, type ComponentType } from 'react';
import { Button, Drawer } from 'antd';
import { CloseOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import { useLocation, useNavigate, Routes, Route } from 'react-router';
import {
  canvasStore,
  detailStore,
  closeDetail,
  toggleDetailCollapse,
  setDetailWidth,
  authStore,
  loadStoredToken,
  sidebarStore,
  closeMobileSidebar,
} from '../store';
import { getAdapter } from '../adapters';
import { useIsMobile } from '../hooks';
import { CytoscapeGraph } from './CytoscapeGraph';
import { DetailPanel } from './DetailPanel';
import { TreeBrowserSidebar } from './sidebar/TreeBrowserSidebar';
import { FloatingStatusBar } from './FloatingStatusBar';
import { GlobalSearchPanel } from './GlobalSearchPanel';
import { AdminDrawer } from './admin/AdminDrawer';
/** 终端面板按需加载：xterm 仅在 terminal 特性启用且真正打开时进入产物。 */
const TerminalPanel = lazy(() =>
  import('./terminal/TerminalPanel').then((module) => ({ default: module.TerminalPanel })),
);
import { LoginPage } from './LoginPage';
import './DetailPanel.less';

/**
 * 应用壳：浏览器（默认全量）与 VSCode Webview（关闭 login/admin/terminal）共用。
 * features 只控制「宿主相关的面板挂载」；数据一律走 adapter 接缝（getAdapter）。
 */
export interface AppShellFeatures {
  /** 密码登录页（Webview 场景 false：无网络暴露） */
  login?: boolean;
  /** 管理台 Drawer（RAG/Doctor/Trash/Config/扫描/用户） */
  admin?: boolean;
  /** 内置终端面板 */
  terminal?: boolean;
}

// ── 路由同步 ──
function RouteSync() {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname;
    const taskMatch = path.match(/^\/task\/(.+)$/);
    const projectMatch = path.match(/^\/project\/(.+)$/);
    const specMatch = path.match(/^\/spec\/(.+)$/);
    if (path === '/') {
      canvasStore.viewMode = 'global';
      canvasStore.anchorId = null;
    } else if (taskMatch) {
      canvasStore.viewMode = 'task';
      canvasStore.anchorId = decodeURIComponent(taskMatch[1]);
    } else if (path === '/task') {
      canvasStore.viewMode = 'task';
      canvasStore.anchorId = null;
    } else if (projectMatch) {
      canvasStore.viewMode = 'project';
      canvasStore.anchorId = decodeURIComponent(projectMatch[1]);
    } else if (path === '/project') {
      canvasStore.viewMode = 'project';
      canvasStore.anchorId = null;
    } else if (specMatch) {
      canvasStore.viewMode = 'spec';
      canvasStore.anchorId = decodeURIComponent(specMatch[1]);
    } else if (path === '/spec') {
      canvasStore.viewMode = 'spec';
      canvasStore.anchorId = null;
    }
  }, [location.pathname]);
  return null;
}

// ── 主内容区 ──
const MainContent = memo(function MainContent({ Graph }: { Graph: ComponentType }) {
  return (
    <>
      <RouteSync />
      <Graph />
    </>
  );
});

// ── 详情面板容器：独立订阅 detailStore，避免 App 跟随重渲染 ──
const DetailPanelContainer = memo(function DetailPanelContainer() {
  const {
    open: detailOpen,
    collapsed: detailCollapsed,
    width: detailWidth,
  } = useSnapshot(detailStore);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailStore.width;

    const onMouseMove = (ev: MouseEvent) => {
      setDetailWidth(startWidth + (startX - ev.clientX));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  if (!detailOpen) return null;

  return (
    <>
      <div
        className={`detail-panel detail-transition${detailCollapsed ? ' detail-panel--hidden' : ''}`}
        style={{ width: detailWidth }}>
        <div className='detail-panel__resize-handle' onMouseDown={handleResizeStart} />
        <div className='detail-panel__actions'>
          <Button
            size='small'
            type='text'
            icon={<MenuFoldOutlined />}
            onClick={toggleDetailCollapse}
          />
          <Button size='small' type='text' icon={<CloseOutlined />} onClick={closeDetail} />
        </div>
        <DetailPanel />
      </div>
      <div
        className={`detail-panel-collapsed${detailCollapsed ? '' : ' detail-panel-collapsed--hidden'}`}
        onClick={toggleDetailCollapse}>
        <MenuUnfoldOutlined style={{ fontSize: 14 }} />
      </div>
    </>
  );
});

// ── 移动端侧栏 Drawer ──
const MobileSidebarDrawer = memo(function MobileSidebarDrawer() {
  const { mobileOpen } = useSnapshot(sidebarStore);
  return (
    <Drawer
      title='浏览器'
      placement='left'
      open={mobileOpen}
      onClose={closeMobileSidebar}
      width='85%'
      styles={{
        body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' },
      }}>
      <TreeBrowserSidebar />
    </Drawer>
  );
});

// ── 移动端详情 Drawer ──
const MobileDetailDrawer = memo(function MobileDetailDrawer() {
  const { open: detailOpen, collapsed: detailCollapsed } = useSnapshot(detailStore);
  return (
    <Drawer
      title='详情'
      placement='bottom'
      open={detailOpen && !detailCollapsed}
      onClose={toggleDetailCollapse}
      height='80%'
      styles={{
        body: {
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        },
      }}>
      <DetailPanel />
    </Drawer>
  );
});

// ── 主布局 ──
export function AppShell({
  features = {},
  Graph = CytoscapeGraph,
}: {
  features?: AppShellFeatures;
  /** 图谱画布组件（可替换渲染实现：宿主冒烟测试用占位组件跑同名数据管线） */
  Graph?: ComponentType;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { token, authEnabled, initialized } = useSnapshot(authStore);
  const isMobile = useIsMobile();
  const showLogin = features.login !== false;
  const showAdmin = features.admin !== false;
  const showTerminal = features.terminal !== false;

  // 启动时加载 token + 查询鉴权状态（Webview 场景无鉴权，直接标记初始化完成）
  useEffect(() => {
    if (!showLogin) {
      authStore.initialized = true;
      return;
    }
    loadStoredToken();
    getAdapter()
      .getAuthStatus()
      .then((status) => {
        authStore.authEnabled = status.enabled;
        authStore.initialized = true;
      })
      .catch(() => {
        authStore.initialized = true;
      });
  }, [showLogin]);

  // 鉴权拦截：启用鉴权且无 token 且非 /login → 跳登录
  useEffect(() => {
    if (showLogin && initialized && authEnabled && !token && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [showLogin, initialized, authEnabled, token, location.pathname, navigate]);

  // 登录页单独渲染（不套主布局）
  if (showLogin && location.pathname === '/login') {
    return <LoginPage />;
  }

  return (
    <div className='app-root'>
      <Routes>
        <Route path='/' element={<MainContent Graph={Graph} />} />
        <Route path='/task' element={<MainContent Graph={Graph} />} />
        <Route path='/task/:taskId' element={<MainContent Graph={Graph} />} />
        <Route path='/project' element={<MainContent Graph={Graph} />} />
        <Route path='/project/:projectId' element={<MainContent Graph={Graph} />} />
        <Route path='/spec' element={<MainContent Graph={Graph} />} />
        <Route path='/spec/:specId' element={<MainContent Graph={Graph} />} />
        <Route path='*' element={<MainContent Graph={Graph} />} />
      </Routes>

      {/* 桌面端组件（移动端不渲染，由 Drawer 承载）*/}
      {!isMobile && <TreeBrowserSidebar />}
      {/* 灵动岛：桌面+移动端均渲染 */}
      <FloatingStatusBar />
      <GlobalSearchPanel />
      {!isMobile && <DetailPanelContainer />}
      {showAdmin && <AdminDrawer />}
      {showTerminal && (
        <Suspense fallback={null}>
          <TerminalPanel />
        </Suspense>
      )}

      {/* 移动端组件（桌面端不渲染）*/}
      {isMobile && (
        <>
          <MobileSidebarDrawer />
          <MobileDetailDrawer />
        </>
      )}
    </div>
  );
}

export default AppShell;
