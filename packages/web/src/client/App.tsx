import { useEffect, useCallback, memo } from 'react';
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
} from './store';
import { getAdapter } from './adapters';
import { useIsMobile } from './hooks';
import { CytoscapeGraph } from './components/CytoscapeGraph';
import { DetailPanel } from './components/DetailPanel';
import { TreeBrowserSidebar } from './components/sidebar/TreeBrowserSidebar';
import { FloatingStatusBar } from './components/FloatingStatusBar';
import { GlobalSearchPanel } from './components/GlobalSearchPanel';
import { AdminDrawer } from './components/admin/AdminDrawer';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { LoginPage } from './components/LoginPage';
import './components/DetailPanel.less';

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
const MainContent = memo(function MainContent() {
  return (
    <>
      <RouteSync />
      <CytoscapeGraph />
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
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token, authEnabled, initialized } = useSnapshot(authStore);
  const isMobile = useIsMobile();

  // 启动时加载 token + 查询鉴权状态
  useEffect(() => {
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
  }, []);

  // 鉴权拦截：启用鉴权且无 token 且非 /login → 跳登录
  useEffect(() => {
    if (initialized && authEnabled && !token && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [initialized, authEnabled, token, location.pathname, navigate]);

  // 登录页单独渲染（不套主布局）
  if (location.pathname === '/login') {
    return <LoginPage />;
  }

  return (
    <div className='app-root'>
      <Routes>
        <Route path='/' element={<MainContent />} />
        <Route path='/task' element={<MainContent />} />
        <Route path='/task/:taskId' element={<MainContent />} />
        <Route path='/project' element={<MainContent />} />
        <Route path='/project/:projectId' element={<MainContent />} />
        <Route path='/spec' element={<MainContent />} />
        <Route path='/spec/:specId' element={<MainContent />} />
        <Route path='*' element={<MainContent />} />
      </Routes>

      {/* 桌面端组件（移动端不渲染，由 Drawer 承载）*/}
      {!isMobile && <TreeBrowserSidebar />}
      {/* 灵动岛：桌面+移动端均渲染 */}
      <FloatingStatusBar />
      <GlobalSearchPanel />
      {!isMobile && <DetailPanelContainer />}
      <AdminDrawer />
      <TerminalPanel />

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
