import type cytoscape from 'cytoscape';
import { Button, Tooltip } from 'antd';
import {
  AimOutlined,
  CompressOutlined,
  ExpandOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import { canvasStore } from '../../store';
import { runLayout } from './layout';

/** 画布工具栏：缩放/聚焦/重新优化布局 */
export function CanvasToolbar({
  isDark,
  cyRef,
  layoutMode,
}: {
  isDark: boolean;
  cyRef: React.RefObject<cytoscape.Core | null>;
  layoutMode: 'force' | 'sequential' | 'radial';
}) {
  const { selectedNodeId, layoutRunning } = useSnapshot(canvasStore);

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

  const handleRelayout = () => {
    const cy = cyRef.current;
    if (!cy || layoutRunning) return;
    canvasStore.layoutRunning = true;
    // 延迟一帧让 UI 先渲染"优化中"状态
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const count = cy.elements().nodes().length;
        runLayout(cy, count, layoutMode);
        canvasStore.layoutRunning = false;
      });
    });
  };

  const btnStyle: React.CSSProperties = {
    background: isDark ? 'rgba(29, 29, 38, 0.92)' : 'rgba(255, 255, 255, 0.92)',
    backdropFilter: 'blur(8px)',
    border: `1px solid ${isDark ? '#3D3D48' : '#E0E0E0'}`,
    borderRadius: 6,
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const relayoutBtnStyle: React.CSSProperties = {
    ...btnStyle,
    ...(layoutRunning
      ? {
          borderColor: '#52C41A',
          background: 'rgba(82, 196, 26, 0.15)',
          animation: 'pulse 1.5s infinite',
        }
      : {}),
  };

  return (
    <>
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 180,
          zIndex: 10,
          display: 'flex',
          gap: 4,
        }}>
        <Tooltip title={selectedNodeId ? '缩放至选中节点及其关联节点' : '缩放至全部节点'}>
          <Button
            type='text'
            size='small'
            icon={selectedNodeId ? <CompressOutlined /> : <ExpandOutlined />}
            onClick={selectedNodeId ? handleFitSelected : handleFitAll}
            style={btnStyle}
          />
        </Tooltip>
        {selectedNodeId && (
          <Tooltip title='聚焦到选中节点'>
            <Button
              type='text'
              size='small'
              icon={<AimOutlined />}
              onClick={handleFocusSelected}
              style={btnStyle}
            />
          </Tooltip>
        )}
        {/* 分隔线 */}
        <div style={{ width: 1, background: isDark ? '#3D3D48' : '#E0E0E0', margin: '0 2px' }} />
        {/* 重新优化布局 */}
        <Tooltip title={layoutRunning ? '布局优化中…' : '重新优化布局'}>
          <Button
            type='text'
            size='small'
            icon={<ThunderboltOutlined />}
            onClick={handleRelayout}
            disabled={layoutRunning}
            style={relayoutBtnStyle}
          />
        </Tooltip>
      </div>

      {/* 布局运行指示器 */}
      {layoutRunning && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            borderRadius: 999,
            background: 'rgba(82, 196, 26, 0.15)',
            border: '1px solid rgba(82, 196, 26, 0.3)',
            backdropFilter: 'blur(8px)',
            color: '#52C41A',
            fontSize: 12,
          }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#52C41A',
              animation: 'pulse 1s infinite',
            }}
          />
          <span>布局优化中…</span>
        </div>
      )}
    </>
  );
}
