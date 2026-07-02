import type cytoscape from 'cytoscape';
import { Button, Tooltip } from 'antd';
import { AimOutlined, CompressOutlined, ExpandOutlined } from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import { canvasStore } from '../../store';

/** 画布工具栏：缩放至全部/选中邻居 + 聚焦选中节点 */
export function CanvasToolbar({
  isDark,
  cyRef,
}: {
  isDark: boolean;
  cyRef: React.RefObject<cytoscape.Core | null>;
}) {
  const { selectedNodeId } = useSnapshot(canvasStore);

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

  return (
    <div
      style={{ position: 'absolute', bottom: 12, left: 180, zIndex: 10, display: 'flex', gap: 4 }}>
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
    </div>
  );
}
