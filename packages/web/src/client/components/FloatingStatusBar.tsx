import { memo } from 'react';
import { Button, Segmented, Tooltip } from 'antd';
import {
  ReloadOutlined,
  BulbOutlined,
  MenuFoldOutlined,
  AimOutlined,
  CompressOutlined,
  ExpandOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import { canvasStore, cyRef, themeStore, toggleTheme } from '../store';
import { useStats } from '../hooks';

const layoutOptions: { label: string; value: string; icon: React.ReactNode }[] = [
  { label: '力导向', value: 'force', icon: <AimOutlined /> },
  { label: '顺序', value: 'sequential', icon: <MenuFoldOutlined /> },
  { label: '径向', value: 'radial', icon: <ReloadOutlined /> },
];

/** 顶部浮动状态岛：布局切换 + 缩放/聚焦 + 统计 + 刷新 + 主题 */
export const FloatingStatusBar = memo(function FloatingStatusBar() {
  const { mode } = useSnapshot(themeStore);
  const { layoutMode, selectedNodeId, layoutRunning } = useSnapshot(canvasStore);
  const queryClient = useQueryClient();
  const isFetching = useIsFetching() > 0;
  const stats = useStats();
  const isDark = mode === 'dark';

  const handleFitAll = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({ fit: { eles: cy.elements(), padding: 40 }, duration: 500 });
  };

  const handleFitSelected = () => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) return;
    const node = cy.getElementById(selectedNodeId);
    if (node.length === 0) return;
    const neighborhood = node.closedNeighborhood();
    cy.animate({ fit: { eles: neighborhood, padding: 60 }, duration: 500 });
  };

  const handleFocusSelected = () => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) return;
    const node = cy.getElementById(selectedNodeId);
    if (node.length === 0) return;
    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2), duration: 400 });
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: isDark ? 'rgba(29, 29, 38, 0.88)' : 'rgba(255, 255, 255, 0.88)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${isDark ? '#3D3D48' : '#E0E0E0'}`,
        borderRadius: 24,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        fontSize: 12,
      }}>
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
      {stats.data && (
        <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 11 }}>
          {stats.data.projectCount} 项目 · {stats.data.taskCount} 任务 ·{' '}
          {stats.data.activeTaskCount} 进行中
        </span>
      )}
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
    </div>
  );
});
