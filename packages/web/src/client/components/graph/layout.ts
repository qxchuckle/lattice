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
  skipAnimation = false,
): cytoscape.LayoutOptions {
  const animate = skipAnimation ? false : 'end';
  const animationDuration = skipAnimation ? 0 : 500;
  if (layoutMode === 'sequential') {
    return {
      name: 'breadthfirst',
      animate,
      animationDuration,
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
      animate,
      animationDuration,
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
    animate,
    animationDuration,
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
  skipAnimation = false,
): void {
  // 清理无效边（端点节点不存在），所有模式通用
  const invalidEdges = cy.edges().filter((e) => e.source().length === 0 || e.target().length === 0);
  if (invalidEdges.length > 0) {
    invalidEdges.remove();
  }

  // 首次加载跳过入场动画和 fit 动画，直接到位
  const fitDuration = skipAnimation ? 0 : 300;

  // 径向：preset 动画 → layoutstop → 持续防重叠 → fit
  if (layoutMode === 'radial') {
    runRadialLayout(cy, nodeCount, () => {
      canvasStore.layoutRunning = true;
      resolveOverlapsContinuous(cy, {
        maxDuration: skipAnimation ? 0 : 3000,
        onDone: () => {
          canvasStore.layoutRunning = false;
          if (skipAnimation) {
            cy.fit(cy.elements(), 60);
          } else {
            cy.animate({ fit: { eles: cy.elements(), padding: 60 }, duration: fitDuration });
          }
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
          maxDuration: skipAnimation ? 0 : 3000,
          onDone: () => {
            canvasStore.layoutRunning = false;
            if (skipAnimation) {
              cy.fit(cy.elements(), 60);
            } else {
              cy.animate({ fit: { eles: cy.elements(), padding: 60 }, duration: fitDuration });
            }
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
  const layout = cy.layout(buildLayoutConfig(nodeCount, 'force', skipAnimation));

  layout.one('layoutstop', () => {
    restoreRandom();
    canvasStore.layoutRunning = true;
    resolveOverlapsContinuous(cy, {
      maxDuration: skipAnimation ? 0 : 3000,
      onDone: () => {
        canvasStore.layoutRunning = false;
        if (skipAnimation) {
          cy.fit(cy.elements(), 60);
        } else {
          cy.animate({ fit: { eles: cy.elements(), padding: 60 }, duration: fitDuration });
        }
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

// ── Focus 状态追踪：用于 diff 增量更新，避免每次全量遍历 ──
let lastFocusedNodeId: string | null = null;
let lastNeighborhood: cytoscape.Collection | null = null;

/** Focus+Context：高亮选中节点的 N 跳邻域，其余变灰。
 *  优化点：cy.batch() 合并 class 操作为单次 style recalculation；
 *  diff 增量更新仅触碰变化的元素。 */
export function applyFocus(
  cy: cytoscape.Core,
  nodeId: string,
  depth: number = 0,
  skipAnimation = false,
  force = false,
): void {
  const node = cy.getElementById(nodeId);
  if (node.length === 0) return;

  // 同一节点重复聚焦：完全跳过，避免重复动画导致闪动
  // force=true 时豁免（用于详情面板「在图中定位」主动触发场景）
  if (!force && nodeId === lastFocusedNodeId && lastNeighborhood) {
    return;
  }

  let neighborhood: cytoscape.Collection;
  if (depth === 0) {
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

  // 检查上次追踪状态是否仍有效（元素可能已被重建）
  const hasValidLast =
    lastNeighborhood && lastFocusedNodeId ? cy.getElementById(lastFocusedNodeId).length > 0 : false;

  cy.batch(() => {
    if (hasValidLast && lastNeighborhood) {
      // diff 增量：仅触碰状态变化的元素
      const all = cy.elements();
      const oldHighlight = lastNeighborhood!;
      const oldDimmed = all.not(oldHighlight);
      const newDimmed = all.not(neighborhood);

      // dimmed → highlighted（旧 dimmed 中不在新 dimmed 的）
      oldDimmed.not(newDimmed).removeClass('dimmed');
      // highlighted → dimmed（新 dimmed 中不在旧 dimmed 的）
      newDimmed.not(oldDimmed).addClass('dimmed');
      // highlighted → 非 highlighted（旧 highlight 中不在新 highlight 的）
      oldHighlight.not(neighborhood).removeClass('highlighted');
      // 非 highlighted → highlighted（新 highlight 中不在旧 highlight 的）
      neighborhood.not(oldHighlight).addClass('highlighted');
      // focused 节点切换
      cy.getElementById(lastFocusedNodeId!).removeClass('focused');
    } else {
      // 首次聚焦或元素已重建：全量更新
      cy.elements().removeClass('dimmed highlighted focused');
      cy.elements().not(neighborhood).addClass('dimmed');
    }
    neighborhood.addClass('highlighted');
    node.addClass('focused');
  });

  lastFocusedNodeId = nodeId;
  lastNeighborhood = neighborhood;

  // 手动计算目标 pan 替代 cy.animate({ center: ... }),
  // 避免 center 选项与 zoom 同时变化时产生位置跳变
  const targetZoom = Math.max(cy.zoom(), 1.0);
  const nodePos = node.position();
  const container = cy.container();
  if (container) {
    const targetPan = {
      x: container.clientWidth / 2 - nodePos.x * targetZoom,
      y: container.clientHeight / 2 - nodePos.y * targetZoom,
    };
    if (skipAnimation) {
      cy.viewport({ zoom: targetZoom, pan: targetPan });
    } else {
      cy.animate({ pan: targetPan, zoom: targetZoom, duration: 200 });
    }
  }
}

/** 清除 Focus 状态 */
export function clearFocus(cy: cytoscape.Core): void {
  cy.elements().removeClass('dimmed highlighted focused');
  lastFocusedNodeId = null;
  lastNeighborhood = null;
}

/** 根据 anchorId 查找图中的节点（处理 spec 前缀问题） */
export function findNodeById(cy: cytoscape.Core, id: string): cytoscape.NodeSingular {
  let node = cy.getElementById(id);
  if (node.length === 0) node = cy.getElementById(`spec-${id}`);
  return node;
}
