import type cytoscape from 'cytoscape';

// ── 参数 ──

const PADDING = 12;
const MAX_ITERATIONS = 30;
const FALLBACK_WIDTH = 120;
const FALLBACK_HEIGHT = 40;

// ── 类型 ──

interface NodeData {
  id: string;
  x: number;
  y: number;
  hw: number; // half-width
  hh: number; // half-height
}

// ── 核心算法 ──

/**
 * AABB 防重叠：在布局完成后消除节点重叠。
 *
 * 1. 读取所有节点的实际位置和尺寸（node.width() / node.height()）
 * 2. 逐对检测 AABB 重叠
 * 3. 沿最小重叠轴推开，同步计算位移后批量应用
 * 4. 迭代直至无重叠或达到最大迭代次数
 * 5. cy.batch() 批量应用最终位置
 */
export function resolveOverlaps(cy: cytoscape.Core): void {
  const cyNodes = cy.nodes();
  const n = cyNodes.length;
  if (n < 2) return;

  // 收集节点数据——读取实际尺寸而非估算
  const data: NodeData[] = [];
  cyNodes.forEach((node) => {
    data.push({
      id: node.id(),
      x: node.position().x,
      y: node.position().y,
      hw: (node.width() || FALLBACK_WIDTH) / 2,
      hh: (node.height() || FALLBACK_HEIGHT) / 2,
    });
  });

  let hasOverlap = true;
  let iter = 0;

  while (hasOverlap && iter < MAX_ITERATIONS) {
    hasOverlap = false;
    iter++;

    // 同步计算所有位移（避免连锁抖动）
    const displacements: Array<{ dx: number; dy: number }> = data.map(() => ({ dx: 0, dy: 0 }));

    for (let i = 0; i < n; i++) {
      const a = data[i];
      for (let j = i + 1; j < n; j++) {
        const b = data[j];

        const dx = b.x - a.x;
        const dy = b.y - a.y;

        const minDistX = a.hw + b.hw + PADDING;
        const minDistY = a.hh + b.hh + PADDING;

        const overlapX = minDistX - Math.abs(dx);
        const overlapY = minDistY - Math.abs(dy);

        if (overlapX > 0 && overlapY > 0) {
          hasOverlap = true;

          if (overlapX < overlapY) {
            // 沿 X 轴推开（重叠更小的方向）
            const push = overlapX / 2;
            const sign = dx >= 0 ? 1 : -1;
            displacements[i].dx -= sign * push;
            displacements[j].dx += sign * push;
          } else {
            // 沿 Y 轴推开
            const push = overlapY / 2;
            const sign = dy >= 0 ? 1 : -1;
            displacements[i].dy -= sign * push;
            displacements[j].dy += sign * push;
          }
        }
      }
    }

    if (hasOverlap) {
      for (let i = 0; i < n; i++) {
        data[i].x += displacements[i].dx;
        data[i].y += displacements[i].dy;
      }
    }
  }

  // 批量应用最终位置到 Cytoscape
  cy.batch(() => {
    for (let i = 0; i < n; i++) {
      cyNodes.eq(i).position({ x: data[i].x, y: data[i].y });
    }
  });
}

// ── 持续迭代防重叠 ──

/**
 * 持续防重叠优化：通过 requestAnimationFrame 每帧检测并微调，
 * 直到收敛（无重叠）或达到最大持续时间。
 *
 * 和 resolveOverlaps 的区别：
 * - resolveOverlaps：同步批量迭代（最多 30 轮，一次性应用）
 * - resolveOverlapsContinuous：每帧一轮，Cytoscape 自动渲染过渡，视觉平滑
 */
export function resolveOverlapsContinuous(
  cy: cytoscape.Core,
  options: {
    maxDuration?: number;
    padding?: number;
    onDone?: () => void;
  } = {},
): void {
  const maxDuration = options.maxDuration ?? 3000;
  const padding = options.padding ?? PADDING;
  const startTime = Date.now();

  const cyNodes = cy.nodes();
  const n = cyNodes.length;
  if (n < 2) {
    options.onDone?.();
    return;
  }

  function step() {
    const elapsed = Date.now() - startTime;
    if (elapsed > maxDuration) {
      options.onDone?.();
      return;
    }

    // 读取节点当前位置和实际尺寸
    const data: NodeData[] = [];
    cyNodes.forEach((node) => {
      data.push({
        id: node.id(),
        x: node.position().x,
        y: node.position().y,
        hw: (node.width() || FALLBACK_WIDTH) / 2,
        hh: (node.height() || FALLBACK_HEIGHT) / 2,
      });
    });

    let hasOverlap = false;
    const displacements: Array<{ dx: number; dy: number }> = data.map(() => ({ dx: 0, dy: 0 }));

    for (let i = 0; i < n; i++) {
      const a = data[i];
      for (let j = i + 1; j < n; j++) {
        const b = data[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDistX = a.hw + b.hw + padding;
        const minDistY = a.hh + b.hh + padding;
        const overlapX = minDistX - Math.abs(dx);
        const overlapY = minDistY - Math.abs(dy);

        if (overlapX > 0 && overlapY > 0) {
          hasOverlap = true;
          if (overlapX < overlapY) {
            const push = overlapX / 2;
            const sign = dx >= 0 ? 1 : -1;
            displacements[i].dx -= sign * push;
            displacements[j].dx += sign * push;
          } else {
            const push = overlapY / 2;
            const sign = dy >= 0 ? 1 : -1;
            displacements[i].dy -= sign * push;
            displacements[j].dy += sign * push;
          }
        }
      }
    }

    if (!hasOverlap) {
      options.onDone?.();
      return;
    }

    // 批量应用位移（Cytoscape 会自动渲染过渡）
    cy.batch(() => {
      for (let i = 0; i < n; i++) {
        if (displacements[i].dx !== 0 || displacements[i].dy !== 0) {
          cyNodes.eq(i).position({
            x: data[i].x + displacements[i].dx,
            y: data[i].y + displacements[i].dy,
          });
        }
      }
    });

    requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}
