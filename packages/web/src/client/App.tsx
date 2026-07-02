import { useEffect } from 'react';
import { Button } from 'antd';
import { CloseOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import { useLocation, Routes, Route } from 'react-router';
import { canvasStore, detailStore, closeDetail, toggleDetailCollapse } from './store';
import { CytoscapeGraph } from './components/CytoscapeGraph';
import { DetailPanel } from './components/DetailPanel';
import { TreeBrowserSidebar } from './components/sidebar/TreeBrowserSidebar';
import { FloatingStatusBar } from './components/FloatingStatusBar';

// ── 路由同步 ──
function RouteSync() {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname;
    const taskMatch = path.match(/^\/task\/(.+)$/);
    const projectMatch = path.match(/^\/project\/(.+)$/);
    const specMatch = path.match(/^\/spec\/(.+)$/);
    const cpMatch = path.match(/^\/checkpoint\/(.+)$/);
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
    } else if (cpMatch) {
      canvasStore.viewMode = 'checkpoint';
      canvasStore.anchorId = decodeURIComponent(cpMatch[1]);
    } else if (path === '/checkpoint') {
      canvasStore.viewMode = 'checkpoint';
      canvasStore.anchorId = null;
    }
  }, [location.pathname]);
  return null;
}

// ── 画布 ──
function CanvasArea() {
  return <CytoscapeGraph />;
}

// ── 主内容区 ──
function MainContent() {
  return (
    <>
      <RouteSync />
      <CanvasArea />
    </>
  );
}

// ── 主布局 ──
export default function App() {
  const { open: detailOpen, collapsed: detailCollapsed } = useSnapshot(detailStore);
  const detailVisible = detailOpen && !detailCollapsed;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Routes>
        <Route path='/' element={<MainContent />} />
        <Route path='/task' element={<MainContent />} />
        <Route path='/task/:taskId' element={<MainContent />} />
        <Route path='/project' element={<MainContent />} />
        <Route path='/project/:projectId' element={<MainContent />} />
        <Route path='/spec' element={<MainContent />} />
        <Route path='/spec/:specId' element={<MainContent />} />
        <Route path='/checkpoint' element={<MainContent />} />
        <Route path='/checkpoint/:taskId' element={<MainContent />} />
        <Route path='*' element={<MainContent />} />
      </Routes>

      <TreeBrowserSidebar />
      <FloatingStatusBar />

      {detailVisible && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: 12,
            transform: 'translateY(-50%)',
            width: 420,
            maxHeight: 'calc(100vh - 100px)',
            zIndex: 20,
            background: 'var(--bg-secondary)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
          className='detail-transition'>
          <div
            style={{ position: 'absolute', top: 8, right: 8, zIndex: 30, display: 'flex', gap: 4 }}>
            <Button
              size='small'
              type='text'
              icon={<MenuFoldOutlined />}
              onClick={toggleDetailCollapse}
              style={{ borderRadius: '50%' }}
            />
            <Button
              size='small'
              type='text'
              icon={<CloseOutlined />}
              onClick={closeDetail}
              style={{ borderRadius: '50%' }}
            />
          </div>
          <DetailPanel />
        </div>
      )}

      {detailOpen && detailCollapsed && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: 12,
            transform: 'translateY(-50%)',
            zIndex: 20,
            width: 32,
            height: 48,
            background: 'var(--bg-secondary)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
          onClick={toggleDetailCollapse}>
          <MenuUnfoldOutlined style={{ fontSize: 14 }} />
        </div>
      )}
    </div>
  );
}
