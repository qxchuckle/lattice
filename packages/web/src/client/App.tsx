import { useEffect, useCallback, memo } from 'react';
import { Button } from 'antd';
import { CloseOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import { useLocation, Routes, Route } from 'react-router';
import {
  canvasStore,
  detailStore,
  closeDetail,
  toggleDetailCollapse,
  setDetailWidth,
} from './store';
import { CytoscapeGraph } from './components/CytoscapeGraph';
import { DetailPanel } from './components/DetailPanel';
import { TreeBrowserSidebar } from './components/sidebar/TreeBrowserSidebar';
import { FloatingStatusBar } from './components/FloatingStatusBar';
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

// ── 主布局 ──
export default function App() {
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

      <TreeBrowserSidebar />
      <FloatingStatusBar />
      <DetailPanelContainer />
    </div>
  );
}
