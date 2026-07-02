import type cytoscape from 'cytoscape';
import { canvasStore, type LayoutMode } from '../../store';
import { runRadialLayout } from './radial-layout';
import { runSequentialLayout } from './sequential-layout';
import { resolveOverlapsContinuous } from './overlap-resolution';

// ── 确定性渲染：seeded LCG PRNG 临时替换 Math.random ──

const LAYOUT_SEED = 42;

/**
 * fCoSE 源码直接调用 Math.random()（spectral 采样 + 初始向量），
 * 不支持 Cytoscape 的 seed 参数。用 seeded LCG 临时替换使其确定性。
 * 返回恢复函数，需在 layoutstop 后调用。
 */
function seedMathRandom(seed: number): () => void {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return () => {
    Math.random = original;
  };
}

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

// ── 径向布局在 radial-layout.ts 中实现（仿 GitNexus circles 视图）──

/**
 * 运行布局的统一入口。
 * - 径向模式：自定义确定性排布（radial-layout.ts，同步）
 * - 顺序模式：自定义按类型分层（sequential-layout.ts，同步）
 * - 力导向：fCoSE → layoutstop → resolveOverlaps 防重叠 → fit
 *
 * 防御措施：
 * 1. 运行前清理无效边（端点节点不存在），避免内置布局排序崩溃
 * 2. sequential 失败时回退到 force
 *
 * onComplete 在布局（含防重叠后处理）全部完成后回调。
 */
export function runLayout(
  cy: cytoscape.Core,
  nodeCount: number,
  layoutMode: LayoutMode = 'force',
  onComplete?: () => void,
): void {
  // 清理无效边（端点节点不存在），所有模式通用
  const invalidEdges = cy.edges().filter((e) => e.source().length === 0 || e.target().length === 0);
  if (invalidEdges.length > 0) {
    invalidEdges.remove();
  }

  // 径向：preset 动画 → layoutstop → 持续防重叠 → fit
  if (layoutMode === 'radial') {
    runRadialLayout(cy, nodeCount, () => {
      canvasStore.layoutRunning = true;
      resolveOverlapsContinuous(cy, {
        maxDuration: 3000,
        onDone: () => {
          canvasStore.layoutRunning = false;
          cy.animate({ fit: { eles: cy.elements(), padding: 60 }, duration: 300 });
          onComplete?.();
        },
      });
    });
    return;
  }

  // 顺序：preset 动画 → layoutstop → 持续防重叠 → fit
  if (layoutMode === 'sequential') {
    try {
      runSequentialLayout(cy, nodeCount, () => {
        canvasStore.layoutRunning = true;
        resolveOverlapsContinuous(cy, {
          maxDuration: 3000,
          onDone: () => {
            canvasStore.layoutRunning = false;
            cy.animate({ fit: { eles: cy.elements(), padding: 60 }, duration: 300 });
            onComplete?.();
          },
        });
      });
      return;
    } catch (e) {
      console.warn('Sequential layout failed, falling back to force:', e);
    }
  }

  // force 模式（或回退）：fCoSE → layoutstop → 持续防重叠 → fit
  const restoreRandom = seedMathRandom(LAYOUT_SEED);
  const layout = cy.layout(buildLayoutConfig(nodeCount, 'force'));

  layout.one('layoutstop', () => {
    restoreRandom();
    canvasStore.layoutRunning = true;
    resolveOverlapsContinuous(cy, {
      maxDuration: 3000,
      onDone: () => {
        canvasStore.layoutRunning = false;
        cy.animate({ fit: { eles: cy.elements(), padding: 60 }, duration: 300 });
        onComplete?.();
      },
    });
  });

  try {
    layout.run();
  } catch {
    restoreRandom();
    onComplete?.();
  }
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
