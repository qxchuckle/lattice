import type cytoscape from 'cytoscape';
import type { LayoutMode } from '../../store';

/** 布局配置：支持力导向 / 顺序 / 径向三种布局 */
export function buildLayoutConfig(
  nodeCount: number,
  layoutMode: LayoutMode = 'force',
): cytoscape.LayoutOptions {
  if (layoutMode === 'sequential') {
    return {
      name: 'breadthfirst',
      animate: 'end',
      animationDuration: 500,
      directed: true,
      padding: 60,
      spacingFactor: Math.max(0.8, Math.min(1.5, 200 / nodeCount)),
      circle: false,
      maximalAdjustments: true,
      fit: true,
    } as unknown as cytoscape.LayoutOptions;
  }
  if (layoutMode === 'radial') {
    return {
      name: 'concentric',
      animate: 'end',
      animationDuration: 500,
      padding: 60,
      concentric: (ele: cytoscape.SingularElementReturnValue) => ele.degree(),
      levelWidth: () => 2,
      minNodeSpacing: Math.max(60, Math.min(120, 6000 / nodeCount)),
      fit: true,
    } as unknown as cytoscape.LayoutOptions;
  }
  // 默认：fCoSE 力导向布局
  const nodeRepulsion = Math.max(5000, Math.min(150000, nodeCount * 600));
  const idealEdgeLength = Math.max(120, Math.min(350, nodeCount * 2.5));
  const numIter = Math.max(2500, Math.min(6000, Math.ceil(nodeCount * 25)));
  return {
    name: 'fcose',
    animate: 'end',
    animationDuration: 500,
    nodeRepulsion,
    idealEdgeLength,
    edgeElasticity: 0.35,
    gravity: 0.2,
    gravityRange: 3.8,
    numIter,
    tile: false,
    tilingPaddingVertical: 80,
    tilingPaddingHorizontal: 80,
    fit: true,
    padding: 60,
    randomize: true,
    nodeSeparation: 120,
    packingQuality: 'default',
  } as unknown as cytoscape.LayoutOptions;
}

/** Focus+Context：高亮选中节点的 N 跳邻域，其余变灰 */
export function applyFocus(cy: cytoscape.Core, nodeId: string, depth: number = 0): void {
  const node = cy.getElementById(nodeId);
  if (node.length === 0) return;

  let neighborhood: cytoscape.Collection;
  if (depth === 0) {
    // 全部 = 无限深度：从选中节点出发不断扩展邻域直到不再增长
    neighborhood = node.closedNeighborhood();
    let prevSize = 0;
    let currSize = neighborhood.size();
    while (currSize > prevSize) {
      prevSize = currSize;
      neighborhood = neighborhood.union(neighborhood.closedNeighborhood());
      currSize = neighborhood.size();
    }
  } else {
    neighborhood = node.closedNeighborhood();
    for (let i = 1; i < depth; i++) {
      neighborhood = neighborhood.union(neighborhood.closedNeighborhood());
    }
  }

  cy.elements().removeClass('dimmed highlighted focused');
  cy.elements().not(neighborhood).addClass('dimmed');
  neighborhood.addClass('highlighted');
  node.addClass('focused');

  cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.0), duration: 400 });
}

/** 清除 Focus 状态 */
export function clearFocus(cy: cytoscape.Core): void {
  cy.elements().removeClass('dimmed highlighted focused');
}

/** 根据 anchorId 查找图中的节点（处理 spec 前缀问题） */
export function findNodeById(cy: cytoscape.Core, id: string): cytoscape.NodeSingular {
  let node = cy.getElementById(id);
  if (node.length === 0) node = cy.getElementById(`spec-${id}`);
  return node;
}
