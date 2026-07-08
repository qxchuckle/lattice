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
 * AABB 防重叠 + 密度扩展（同步一次性）：在布局完成后消除节点重叠并拉开密集节点。
 *
 * 1. 读取所有节点的实际位置和尺寸（node.width() / node.height()）
 * 2. 逐对检测 AABB 重叠 → 沿最小重叠轴推开
 * 3. 无重叠时检测密度 gap < minSpacing → 各轴独立推开（仅非连接对）
 * 4. 迭代直至无工作或达到最大迭代次数
 * 5. cy.batch() 批量应用最终位置
 */
export function resolveOverlaps(
  cy: cytoscape.Core,
  options: { padding?: number; minSpacing?: number } = {},
): void {
  const padding = options.padding ?? PADDING;
  const minSpacing = options.minSpacing ?? 0;
  const cyNodes = cy.nodes();
  const n = cyNodes.length;
  if (n < 2) return;

  // 预计算有边连接的节点对（密度扩展仅对非连接对生效）
  let connectedPairs: Set<string> | null = null;
  if (minSpacing > 0) {
    connectedPairs = new Set<string>();
    cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      connectedPairs!.add(`${s}\0${t}`);
      connectedPairs!.add(`${t}\0${s}`);
    });
  }

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

  let hasWork = true;
  let iter = 0;

  while (hasWork && iter < MAX_ITERATIONS) {
    hasWork = false;
    iter++;

    // 同步计算所有位移（避免连锁抖动）
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
          // AABB 重叠——沿最小重叠轴推开
          hasWork = true;
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
        } else if (minSpacing > 0 && !(connectedPairs && connectedPairs.has(`${a.id}\0${b.id}`))) {
          // 无 AABB 重叠但距离太近——密度扩展推开（仅非连接对，各轴独立）
          const gapX = Math.abs(dx) - (a.hw + b.hw);
          const gapY = Math.abs(dy) - (a.hh + b.hh);
          if (gapX < minSpacing) {
            hasWork = true;
            const deficit = minSpacing - gapX;
            const push = deficit * 0.2;
            const sign = dx >= 0 ? 1 : -1;
            displacements[i].dx -= sign * push;
            displacements[j].dx += sign * push;
          }
          if (gapY < minSpacing) {
            hasWork = true;
            const deficit = minSpacing - gapY;
            const push = deficit * 0.2;
            const sign = dy >= 0 ? 1 : -1;
            displacements[i].dy -= sign * push;
            displacements[j].dy += sign * push;
          }
        }
      }
    }

    if (hasWork) {
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
    /** 非连接节点对之间的最小间距阈值（边界 gap）。>0 时启用密度扩展 */
    minSpacing?: number;
    onDone?: () => void;
  } = {},
): void {
  const maxDuration = options.maxDuration ?? 3000;
  const padding = options.padding ?? PADDING;
  const minSpacing = options.minSpacing ?? 0;
  const startTime = Date.now();

  const cyNodes = cy.nodes();
  const n = cyNodes.length;
  if (n < 2) {
    options.onDone?.();
    return;
  }

  // 预计算有边连接的节点对（密度扩展仅对非连接对生效）
  let connectedPairs: Set<string> | null = null;
  if (minSpacing > 0) {
    connectedPairs = new Set<string>();
    cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      connectedPairs!.add(`${s}\0${t}`);
      connectedPairs!.add(`${t}\0${s}`);
    });
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

    let hasWork = false;
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
          // AABB 重叠——沿最小重叠轴推开
          hasWork = true;
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
        } else if (minSpacing > 0 && !(connectedPairs && connectedPairs.has(`${a.id}\0${b.id}`))) {
          // 无 AABB 重叠但距离太近——密度扩展推开（仅非连接对）
          // 各轴独立检测：水平近推水平，垂直近推垂直
          const gapX = Math.abs(dx) - (a.hw + b.hw);
          const gapY = Math.abs(dy) - (a.hh + b.hh);
          if (gapX < minSpacing) {
            hasWork = true;
            const deficit = minSpacing - gapX;
            const push = deficit * 0.2;
            const sign = dx >= 0 ? 1 : -1;
            displacements[i].dx -= sign * push;
            displacements[j].dx += sign * push;
          }
          if (gapY < minSpacing) {
            hasWork = true;
            const deficit = minSpacing - gapY;
            const push = deficit * 0.2;
            const sign = dy >= 0 ? 1 : -1;
            displacements[i].dy -= sign * push;
            displacements[j].dy += sign * push;
          }
        }
      }
    }

    if (!hasWork) {
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
