import type cytoscape from 'cytoscape';

// ── 类型分环 ──

export const TYPE_RING: Record<string, number> = {
  project: 0,
  spec: 1,
  task: 2,
};

// ── 布局参数 ──

const INTER_TYPE_GAP = 300;
const SUB_RING_GAP = 80;
const NODE_SPACING = 30;
const MIN_RING_RADIUS = 200;
const START_ANGLE = (-3 * Math.PI) / 4;
const TWO_PI = 2 * Math.PI;

// ── 节点尺寸估算（不依赖 Cytoscape 渲染状态）──

const FONT_SIZE = 10;
const CJK_WIDTH = FONT_SIZE;
const ASCII_WIDTH = FONT_SIZE * 0.55;
const PADDING_X = 24; // 12px * 2
const PADDING_Y = 16; // 8px * 2
const LINE_HEIGHT = FONT_SIZE * 1.3;
const MAX_TEXT_WIDTH = 180;

/** 从 label 文本估算节点宽高——比 boundingBox() 更可靠 */
export function estimateNodeSize(label: string): { w: number; h: number } {
  let textWidth = 0;
  for (const char of label) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)) {
      textWidth += CJK_WIDTH;
    } else {
      textWidth += ASCII_WIDTH;
    }
  }
  const w = Math.min(textWidth, MAX_TEXT_WIDTH) + PADDING_X;
  const lines = Math.max(1, Math.ceil(textWidth / MAX_TEXT_WIDTH));
  const h = lines * LINE_HEIGHT + PADDING_Y;
  return { w: Math.max(60, w), h: Math.max(30, h) };
}

// ── 核心算法 ──

/**
 * 逐个节点放置在环上，按每个节点的估算宽度计算角度占用。
 * 从 START_ANGLE 开始顺序排布，一圈放不下自动加子环。
 */
function placeNodesOnRing(
  ringNodes: { id: string; label: string }[],
  baseRadius: number,
  maxNodeHeight: number,
  positions: Record<string, { x: number; y: number }>,
): number {
  let nodeIndex = 0;
  let subRingIndex = 0;
  let currentRadius = baseRadius;

  while (nodeIndex < ringNodes.length) {
    let angle = START_ANGLE;
    let placedOnThisRing = 0;

    while (nodeIndex < ringNodes.length) {
      const { id, label } = ringNodes[nodeIndex];
      const { w } = estimateNodeSize(label);
      // 精确角度占用：矩形在圆上 = 2 * atan(w / 2r) + 间距角度
      const angularWidth = 2 * Math.atan(w / (2 * currentRadius)) + NODE_SPACING / currentRadius;
      const nextAngle = angle + angularWidth;

      // 预留首尾最小间隙
      const minGap = NODE_SPACING / currentRadius;
      if (placedOnThisRing > 0 && nextAngle - START_ANGLE > TWO_PI - minGap) {
        break;
      }

      const nodeAngle = angle + angularWidth / 2;
      positions[id] = {
        x: currentRadius * Math.cos(nodeAngle),
        y: currentRadius * Math.sin(nodeAngle),
      };

      angle = nextAngle;
      nodeIndex++;
      placedOnThisRing++;
    }

    if (nodeIndex < ringNodes.length) {
      subRingIndex++;
      currentRadius = baseRadius + subRingIndex * (maxNodeHeight + SUB_RING_GAP);
    }
  }

  return currentRadius;
}

/**
 * 径向布局：确定性排布，从 label 文本估算尺寸。
 *
 * 1. 按类型分组（project 中心 → spec → task）
 * 2. 逐个类型排布：从左上角开始，按估算宽度逐个放置
 * 3. 一圈放不下自动加子环（外环半径更大，能放更多节点）
 */
export function runRadialLayout(
  cy: cytoscape.Core,
  _nodeCount: number,
  onReady?: () => void,
): void {
  const cyNodes = cy.nodes();
  if (cyNodes.length === 0) return;

  const positions: Record<string, { x: number; y: number }> = {};

  // 1. 按类型分组，读取 label
  const nodesByRing = new Map<number, { id: string; label: string }[]>();
  cyNodes.forEach((node) => {
    const type = (node.data('entityType') as string) || 'task';
    const ring = TYPE_RING[type] ?? 4;
    const label = (node.data('label') as string) || node.id();
    if (!nodesByRing.has(ring)) nodesByRing.set(ring, []);
    nodesByRing.get(ring)!.push({ id: node.id(), label });
  });

  // 2. 逐个类型环排布
  let currentRadius = 0;
  const sortedRings = [...nodesByRing.keys()].sort((a, b) => a - b);

  for (const ring of sortedRings) {
    const ringNodes = nodesByRing.get(ring)!;

    if (ring === 0) {
      if (ringNodes.length <= 1) {
        positions[ringNodes[0].id] = { x: 0, y: 0 };
        currentRadius = INTER_TYPE_GAP;
      } else {
        const r = Math.max(100, MIN_RING_RADIUS);
        // 估算 project 最大高度
        let maxH = 40;
        for (const { label } of ringNodes) {
          const { h } = estimateNodeSize(label);
          maxH = Math.max(maxH, h);
        }
        const lastR = placeNodesOnRing(ringNodes, r, maxH, positions);
        currentRadius = lastR + maxH + INTER_TYPE_GAP;
      }
      continue;
    }

    // 估算每个节点的尺寸，取最大高度用于子环间距
    let maxHeight = 0;
    for (const { label } of ringNodes) {
      const { h } = estimateNodeSize(label);
      maxHeight = Math.max(maxHeight, h);
    }

    const baseRadius = Math.max(currentRadius, MIN_RING_RADIUS);
    const lastR = placeNodesOnRing(ringNodes, baseRadius, maxHeight, positions);
    currentRadius = lastR + maxHeight + INTER_TYPE_GAP;
  }

  // 3. 应用到 Cytoscape（保留动画，onReady 在 layoutstop 后回调）
  const layout = cy.layout({
    name: 'preset',
    animate: 'end',
    animationDuration: 500,
    fit: true,
    padding: 60,
    positions: (node: cytoscape.NodeSingular) => positions[node.id()] || { x: 0, y: 0 },
  } as unknown as cytoscape.LayoutOptions);

  if (onReady) {
    layout.one('layoutstop', onReady);
  }

  layout.run();
}
