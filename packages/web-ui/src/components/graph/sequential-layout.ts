import type cytoscape from 'cytoscape';
import { TYPE_RING, estimateNodeSize } from './radial-layout';

// ── 布局参数 ──

const LAYER_GAP = 300; // 不同 entityType 层之间的 y 间距
const NODE_SPACING = 30; // 同行节点之间的 x 间距
const ROW_GAP = 80; // 同层换行时的 y 间距
// 每行最大宽度根据该层节点数动态计算（见排布循环）

// ── 核心算法 ──

/**
 * 顺序布局：按类型分层 + 水平排列。
 *
 * 复用径向布局的 TYPE_RING 和 estimateNodeSize：
 * - 每个 entityType 占一个水平条带：project → spec → task
 * - 同层节点从左到右排列，整体居中
 * - 同层节点过多时自动换行（类似径向布局一圈放不下加子环）
 * - 最终用 Cytoscape preset 布局应用坐标
 */
export function runSequentialLayout(
  cy: cytoscape.Core,
  _nodeCount: number,
  onReady?: () => void,
): void {
  const cyNodes = cy.nodes();
  if (cyNodes.length === 0) return;

  const positions: Record<string, { x: number; y: number }> = {};

  // 1. 按类型分组
  const nodesByLayer = new Map<number, { id: string; label: string }[]>();
  cyNodes.forEach((node) => {
    const type = (node.data('entityType') as string) || 'task';
    const layer = TYPE_RING[type] ?? 4;
    const label = (node.data('label') as string) || node.id();
    if (!nodesByLayer.has(layer)) nodesByLayer.set(layer, []);
    nodesByLayer.get(layer)!.push({ id: node.id(), label });
  });

  // 2. 逐层排布（从上到下：project → spec → task）
  const sortedLayers = [...nodesByLayer.keys()].sort((a, b) => a - b);
  let currentY = 0;

  for (const layer of sortedLayers) {
    const layerNodes = nodesByLayer.get(layer)!;

    // 估算每个节点的宽高
    const nodeSizes = layerNodes.map((n) => {
      const size = estimateNodeSize(n.label);
      return { id: n.id, w: size.w, h: size.h };
    });

    // 动态行宽：节点越多宽度越大，增长越来越慢（自然对数，无上限）
    const maxRowWidth = 1200 + 600 * Math.log(layerNodes.length + 1);

    // 分行：超过 maxRowWidth 则换行
    const rows: { id: string; w: number; h: number }[][] = [];
    let currentRow: { id: string; w: number; h: number }[] = [];
    let currentRowWidth = 0;

    for (const node of nodeSizes) {
      if (currentRowWidth + node.w + NODE_SPACING > maxRowWidth && currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
        currentRowWidth = 0;
      }
      currentRow.push(node);
      currentRowWidth += node.w + NODE_SPACING;
    }
    if (currentRow.length > 0) rows.push(currentRow);

    // 放置每一行
    for (const row of rows) {
      const rowWidth = row.reduce((sum, n) => sum + n.w, 0) + (row.length - 1) * NODE_SPACING;
      const rowMaxHeight = Math.max(...row.map((n) => n.h));

      let x = -rowWidth / 2;
      for (const node of row) {
        positions[node.id] = { x: x + node.w / 2, y: currentY };
        x += node.w + NODE_SPACING;
      }

      currentY += rowMaxHeight + ROW_GAP;
    }

    // 层间距：最后一行的 ROW_GAP 替换为 LAYER_GAP
    currentY = currentY - ROW_GAP + LAYER_GAP;
  }

  // 3. 手动 tweening 动画过渡（避免 preset 布局每节点独立动画导致的抖动）
  const savedPositions = new Map<string, { x: number; y: number }>();
  cy.nodes().forEach((node) => {
    savedPositions.set(node.id(), { x: node.position().x, y: node.position().y });
  });

  const animDuration = 500;
  const animStart = performance.now();

  const tween = () => {
    const elapsed = performance.now() - animStart;
    const t = Math.min(1, elapsed / animDuration);
    const eased = 1 - Math.pow(1 - t, 3);

    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const saved = savedPositions.get(node.id());
        const target = positions[node.id()];
        if (saved && target) {
          node.position({
            x: saved.x + (target.x - saved.x) * eased,
            y: saved.y + (target.y - saved.y) * eased,
          });
        }
      });
    });

    if (t < 1) {
      requestAnimationFrame(tween);
    } else {
      onReady?.();
    }
  };

  requestAnimationFrame(tween);
}
