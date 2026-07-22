import { memo } from 'react';
import { Button, Badge, Segmented, Tooltip } from 'antd';
import {
  ReloadOutlined,
  BulbOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  AimOutlined,
  CompressOutlined,
  ExpandOutlined,
  LoadingOutlined,
  SearchOutlined,
  FileSearchOutlined,
  SettingOutlined,
  CodeOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import {
  canvasStore,
  cyRef,
  themeStore,
  toggleTheme,
  getVisibleCanvasCenter,
  openCanvasSearch,
  closeCanvasSearch,
  canvasSearchStore,
  openGlobalSearch,
  closeGlobalSearch,
  globalSearchStore,
  openAdmin,
  toggleTerminalPanel,
  terminalStore,
  authStore,
  toggleMobileSidebar,
} from '../store';
import { fitToElements } from './graph/layout';
import { useIsMobile } from '../hooks';
import { CanvasSearchBar } from './CanvasSearchBar';

const layoutOptions: { label: string; value: string; icon: React.ReactNode }[] = [
  { label: '力导向', value: 'force', icon: <AimOutlined /> },
  { label: '顺序', value: 'sequential', icon: <MenuFoldOutlined /> },
  { label: '径向', value: 'radial', icon: <ReloadOutlined /> },
];

/** 顶部浮动状态岛：布局切换 + 缩放/聚焦 + 统计 + 刷新 + 主题 */
export const FloatingStatusBar = memo(function FloatingStatusBar() {
  const { mode } = useSnapshot(themeStore);
  const { layoutMode, selectedNodeId, layoutRunning } = useSnapshot(canvasStore);
  const {
    open: terminalOpen,
    collapsed: terminalCollapsed,
    sessions: terminalSessions,
  } = useSnapshot(terminalStore);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const isFetching = useIsFetching() > 0;
  const isDark = mode === 'dark';
  const { authEnabled, initialized } = useSnapshot(authStore);

  const handleFitAll = () => {
    const cy = cyRef.current;
    if (!cy) return;
    fitToElements(cy, cy.elements(), 40, 500);
  };

  const handleFitSelected = () => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) return;
    const node = cy.getElementById(selectedNodeId);
    if (node.length === 0) return;
    const neighborhood = node.closedNeighborhood();
    fitToElements(cy, neighborhood, 60, 500);
  };

  const handleFocusSelected = () => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) return;
    const node = cy.getElementById(selectedNodeId);
    if (node.length === 0) return;
    const container = cy.container();
    if (!container) return;
    // 手动计算 pan：以可视区域中心为目标，避免 center+zoom 跳变和面板遮蔽
    const center = getVisibleCanvasCenter(container.clientWidth, container.clientHeight);
    const targetZoom = Math.max(cy.zoom(), 1.2);
    const nodePos = node.position();
    const targetPan = {
      x: center.x - nodePos.x * targetZoom,
      y: center.y - nodePos.y * targetZoom,
    };
    cy.animate({ pan: targetPan, zoom: targetZoom, duration: 400 });
  };

  return (
    <>
      <div
        className='floating-status-bar'
        style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 15, // 低于侧栏(20)和详情面板(20)，灵动岛在面板之下
          display: 'flex',
          alignItems: 'center',
          flexWrap: isMobile ? 'wrap' : 'nowrap',
          justifyContent: isMobile ? 'center' : 'flex-start',
          maxWidth: isMobile ? 'calc(100vw - 16px)' : undefined,
          gap: isMobile ? 2 : 6,
          rowGap: isMobile ? 2 : undefined,
          padding: isMobile ? '2px 6px' : '5px 12px',
          background: isDark ? '#1D1D26' : '#FFFFFF',
          border: `1px solid ${isDark ? '#3D3D48' : '#E0E0E0'}`,
          borderRadius: isMobile ? 16 : 24,
          boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          fontSize: 12,
        }}>
        {isMobile && (
          <Button
            size='small'
            type='text'
            icon={<MenuOutlined />}
            onClick={toggleMobileSidebar}
            style={{ borderRadius: '50%' }}
          />
        )}
        <Segmented
          size='small'
          options={layoutOptions.map((opt) => ({
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}>
                {opt.icon}
                {opt.label}
              </span>
            ),
            value: opt.value,
          }))}
          value={layoutMode}
          onChange={(v) => {
            canvasStore.layoutMode = v as 'force' | 'sequential' | 'radial';
          }}
        />
        <Tooltip title={selectedNodeId ? '缩放至选中节点及其关联节点' : '缩放至全部节点'}>
          <Button
            size='small'
            type='text'
            icon={selectedNodeId ? <CompressOutlined /> : <ExpandOutlined />}
            onClick={selectedNodeId ? handleFitSelected : handleFitAll}
            style={{ borderRadius: '50%' }}
          />
        </Tooltip>
        {selectedNodeId && (
          <Tooltip title='聚焦到选中节点'>
            <Button
              size='small'
              type='text'
              icon={<AimOutlined />}
              onClick={handleFocusSelected}
              style={{ borderRadius: '50%' }}
            />
          </Tooltip>
        )}
        {layoutRunning && (
          <Tooltip title='布局优化中…'>
            <LoadingOutlined style={{ fontSize: 12, color: '#52C41A' }} />
          </Tooltip>
        )}
        <Tooltip title='全局搜索 (⌘P)'>
          <Button
            size='small'
            type='text'
            icon={<FileSearchOutlined />}
            onClick={() => {
              if (globalSearchStore.open) {
                closeGlobalSearch();
              } else {
                openGlobalSearch();
              }
            }}
            style={{ borderRadius: '50%' }}
          />
        </Tooltip>
        <Tooltip title='画布搜索 (⌘F)'>
          <Button
            size='small'
            type='text'
            icon={<SearchOutlined />}
            onClick={() => {
              if (canvasSearchStore.open) {
                closeCanvasSearch();
              } else {
                openCanvasSearch();
              }
            }}
            style={{ borderRadius: '50%' }}
          />
        </Tooltip>
        <Button
          size='small'
          type='text'
          icon={<ReloadOutlined spin={isFetching} />}
          onClick={() => queryClient.invalidateQueries()}
          style={{ borderRadius: '50%' }}
        />
        <Button
          size='small'
          type='text'
          icon={<BulbOutlined />}
          onClick={toggleTheme}
          style={{ borderRadius: '50%' }}
        />
        <Tooltip title={terminalOpen && !terminalCollapsed ? '收起终端' : '打开终端'}>
          <Badge count={terminalSessions.length} size='small' offset={[-2, 2]}>
            <Button
              size='small'
              type='text'
              icon={<CodeOutlined />}
              onClick={toggleTerminalPanel}
              style={{
                borderRadius: '50%',
                color: terminalOpen && !terminalCollapsed ? '#1677FF' : undefined,
              }}
            />
          </Badge>
        </Tooltip>
        {initialized && !authEnabled && (
          <Tooltip title='未设置访问密码，存在安全风险。点击去设置'>
            <Button
              size='small'
              type='text'
              icon={<WarningOutlined style={{ color: '#FAAD14' }} />}
              onClick={() => openAdmin()}
              style={{ borderRadius: '50%' }}
            />
          </Tooltip>
        )}
        <Tooltip title='管理'>
          <Button
            size='small'
            type='text'
            icon={<SettingOutlined />}
            onClick={() => openAdmin()}
            style={{ borderRadius: '50%' }}
          />
        </Tooltip>
      </div>
      <CanvasSearchBar />
    </>
  );
});
