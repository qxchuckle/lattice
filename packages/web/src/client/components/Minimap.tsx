import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';
import {
  AimOutlined,
  CompassOutlined,
  CompressOutlined,
  ExpandOutlined,
  MinusOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { Core } from 'cytoscape';
import {
  canvasSearchStore,
  canvasStore,
  cyRef,
  detailStore,
  getVisibleCanvasBounds,
  getVisibleCanvasCenter,
  themeStore,
  toggleMinimap,
} from '../store';
import { getEntityColor } from '../lib';
import { fitToElements } from './graph/layout';
import { useIsMobile } from '../hooks/ui';
import type { LatticeNodeData } from '../types/graph';
import './Minimap.less';

/** 缩略图内容尺寸（CSS 像素） */
const MAP_W = 208;
const MAP_H = 146;
/** 内容区内边距 */
const PAD = 10;
/** 缩放步进倍率（指数缩放，+/- 对称） */
const ZOOM_FACTOR = 1.25;
/** 搜索命中环颜色（与 stylesheet .search-match 一致） */
const SEARCH_MATCH_COLOR = '#FAAD14';

const LEGEND_TYPES = ['task', 'project', 'spec'] as const;
type LegendType = (typeof LEGEND_TYPES)[number];
type LegendCounts = Record<LegendType, number>;

interface Mapping {
  scale: number;
  ox: number;
  oy: number;
}

/** 计算「模型坐标 → 缩略图坐标」映射：全部节点包围盒 + padding，等比缩放居中 */
function computeMapping(cy: Core): Mapping | null {
  const nodes = cy.nodes();
  if (nodes.length === 0) return null;
  const bbox = nodes.boundingBox();
  const bw = bbox.w || 1;
  const bh = bbox.h || 1;
  const scale = Math.min((MAP_W - PAD * 2) / bw, (MAP_H - PAD * 2) / bh);
  const ox = PAD + (MAP_W - PAD * 2 - bw * scale) / 2 - bbox.x1 * scale;
  const oy = PAD + (MAP_H - PAD * 2 - bh * scale) / 2 - bbox.y1 * scale;
  return { scale, ox, oy };
}

/** 绘制圆角矩形路径（不依赖 ctx.roundRect 兼容性） */
function traceRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 命中检测：客户端坐标 → 缩略图坐标 → 模型坐标，对比节点包围盒（带 4px 缩略图像素容错） */
function hitTestNode(
  cy: Core,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): string | null {
  const mapping = computeMapping(cy);
  if (!mapping) return null;
  const rect = canvas.getBoundingClientRect();
  const modelX = (clientX - rect.left - mapping.ox) / mapping.scale;
  const modelY = (clientY - rect.top - mapping.oy) / mapping.scale;
  const padModel = 4 / mapping.scale;
  let foundId: string | null = null;
  cy.nodes().forEach((node) => {
    const pos = node.position();
    const hw = (node.width() || 120) / 2 + padModel;
    const hh = (node.height() || 40) / 2 + padModel;
    if (Math.abs(modelX - pos.x) <= hw && Math.abs(modelY - pos.y) <= hh) {
      foundId = node.id();
    }
  });
  return foundId;
}

/**
 * 全景导航框（minimap）：画布右下角浮动缩略图 + 缩放控件条。
 * - 缩略图：边淡色直线 + 类型着色节点（dimmed 淡化 / 选中描边 / 搜索命中高亮环）
 *   + 当前可视区域矩形（基于面板遮蔽后的真实可见区域）
 * - 交互：点击 / 拖拽平移主画布；缩放条 +/− / 重置 100% / 适配全部
 * - 重绘：cy 事件驱动（viewport/position/class/add/remove/layoutstop/resize）+ rAF 节流
 */
export const Minimap = memo(function Minimap() {
  const { mode } = useSnapshot(themeStore);
  const { minimapOpen, canvasReady, selectedNodeId, visibleTypes } = useSnapshot(canvasStore);
  const { matchIds, matchIndex } = useSnapshot(canvasSearchStore);
  // 详情面板状态：展开时集群右移让出面板宽度（width 拖拽 resize 期间逐帧更新，实时跟随）；
  // 关闭 / 折叠态的展开按钮贴顶部（top:12px）不占右下角，无需让出
  const {
    open: detailOpen,
    collapsed: detailCollapsed,
    width: detailWidth,
  } = useSnapshot(detailStore);
  const rightOffset = detailOpen && !detailCollapsed ? detailWidth + 16 : 16;
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const minimapHoverNodeRef = useRef<string | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [legend, setLegend] = useState<LegendCounts>({ task: 0, project: 0, spec: 0 });

  // 绘制：状态全部实时读取（cyRef / valtio proxy 在非 React 上下文读取是安全的）
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const cy = cyRef.current;
    if (!canvas || !cy) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // dpr 缩放保证高清屏清晰度
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== MAP_W * dpr || canvas.height !== MAP_H * dpr) {
      canvas.width = MAP_W * dpr;
      canvas.height = MAP_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    const mapping = computeMapping(cy);
    const dark = themeStore.mode === 'dark';

    // ── 节点类型计数（图例）：独立于映射计算，空图时也能归零 ──
    const counts: LegendCounts = { task: 0, project: 0, spec: 0 };
    cy.nodes().forEach((node) => {
      const data = node.data() as LatticeNodeData;
      counts[data.entityType]++;
    });
    // 相等守卫防止无变化时触发重渲染
    setLegend((prev) =>
      prev.task === counts.task && prev.project === counts.project && prev.spec === counts.spec
        ? prev
        : counts,
    );

    if (!mapping) return;
    const { scale, ox, oy } = mapping;
    const toMapX = (x: number) => x * scale + ox;
    const toMapY = (y: number) => y * scale + oy;

    // ── 边：淡色直线（缩略尺度下忽略 bezier 控制点），单路径批量绘制 ──
    ctx.strokeStyle = dark ? 'rgba(234, 234, 240, 0.13)' : 'rgba(42, 42, 50, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    cy.edges().forEach((edge) => {
      const s = edge.source().position();
      const t = edge.target().position();
      ctx.moveTo(toMapX(s.x), toMapY(s.y));
      ctx.lineTo(toMapX(t.x), toMapY(t.y));
    });
    ctx.stroke();

    // ── 节点：类型着色圆角矩形；dimmed 淡化，选中描边高亮 ──
    const selected = canvasStore.selectedNodeId;
    cy.nodes().forEach((node) => {
      const data = node.data() as LatticeNodeData;
      const pos = node.position();
      const w = Math.max((node.width() || 120) * scale, 2.5);
      const h = Math.max((node.height() || 40) * scale, 2.5);
      const x = toMapX(pos.x) - w / 2;
      const y = toMapY(pos.y) - h / 2;
      const isSelected = node.id() === selected;
      const isDimmed = node.hasClass('dimmed');
      ctx.globalAlpha = isSelected ? 1 : isDimmed ? 0.25 : 0.8;
      ctx.fillStyle = getEntityColor(data.entityType);
      traceRoundRect(ctx, x, y, w, h, 2);
      ctx.fill();
      if (isSelected) {
        ctx.strokeStyle = dark ? '#FFFFFF' : '#1F1F1F';
        ctx.lineWidth = 1;
        traceRoundRect(ctx, x - 1, y - 1, w + 2, h + 2, 3);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    // ── 搜索命中环：matchIds 金色描边，当前命中项加粗 ──
    const matches = canvasSearchStore.matchIds;
    if (matches.length > 0) {
      const currentId =
        canvasSearchStore.matchIndex >= 0 ? matches[canvasSearchStore.matchIndex] : null;
      matches.forEach((id) => {
        const node = cy.getElementById(id);
        if (node.length === 0) return;
        const pos = node.position();
        const w = Math.max((node.width() || 120) * scale, 2.5) + 4;
        const h = Math.max((node.height() || 40) * scale, 2.5) + 4;
        const isCurrent = id === currentId;
        ctx.globalAlpha = isCurrent ? 1 : 0.65;
        ctx.strokeStyle = SEARCH_MATCH_COLOR;
        ctx.lineWidth = isCurrent ? 2 : 1.25;
        traceRoundRect(ctx, toMapX(pos.x) - w / 2, toMapY(pos.y) - h / 2, w, h, 3);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // ── 可视区域矩形：渲染坐标 → 模型坐标 → 缩略图坐标 ──
    const pan = cy.pan();
    const zoom = cy.zoom();
    const bounds = getVisibleCanvasBounds(cy.width(), cy.height());
    const mLeft = (bounds.left - pan.x) / zoom;
    const mTop = (bounds.top - pan.y) / zoom;
    const mRight = (bounds.right - pan.x) / zoom;
    const mBottom = (bounds.bottom - pan.y) / zoom;
    const vx = toMapX(mLeft);
    const vy = toMapY(mTop);
    const vw = toMapX(mRight) - vx;
    const vh = toMapY(mBottom) - vy;
    ctx.fillStyle = dark ? 'rgba(64, 150, 255, 0.14)' : 'rgba(22, 119, 255, 0.10)';
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeStyle = dark ? '#4096FF' : '#1677FF';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx, vy, vw, vh);
  }, []);

  // rAF 节流：布局 tweening 期间 position 事件高频触发，一帧最多绘制一次
  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  // 绑定 Cytoscape 事件驱动重绘（class：applyFocus 的 dimmed/highlighted 变更）
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !canvasReady || !minimapOpen || isMobile) return;
    const handler = () => {
      scheduleDraw();
      setZoomPct(Math.round(cy.zoom() * 100));
    };
    cy.on('viewport position class add remove layoutstop resize', handler);
    setZoomPct(Math.round(cy.zoom() * 100));
    scheduleDraw();
    return () => {
      cy.off('viewport position class add remove layoutstop resize', handler);
    };
  }, [canvasReady, minimapOpen, isMobile, scheduleDraw]);

  // 主题 / 选中节点 / 搜索命中变化时重绘
  useEffect(() => {
    if (canvasReady && minimapOpen && !isMobile) scheduleDraw();
  }, [
    mode,
    selectedNodeId,
    matchIds,
    matchIndex,
    canvasReady,
    minimapOpen,
    isMobile,
    scheduleDraw,
  ]);

  // 卸载时清理：未执行的 rAF + 主画布 hover 高亮 class
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const cy = cyRef.current;
      if (cy && minimapHoverNodeRef.current) {
        cy.getElementById(minimapHoverNodeRef.current).removeClass('minimap-hover');
        minimapHoverNodeRef.current = null;
      }
    },
    [],
  );

  // 快捷键 M：切换 minimap 显隐（排除修饰键与输入焦点）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return;
      if (e.key === 'm' || e.key === 'M') toggleMinimap();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 点击 / 拖拽：指针对应模型坐标 → 平移到可视区域中心（直接设置，无动画）
  const navigateTo = useCallback((clientX: number, clientY: number) => {
    const cy = cyRef.current;
    const canvas = canvasRef.current;
    if (!cy || !canvas) return;
    const mapping = computeMapping(cy);
    if (!mapping) return;
    const rect = canvas.getBoundingClientRect();
    const modelX = (clientX - rect.left - mapping.ox) / mapping.scale;
    const modelY = (clientY - rect.top - mapping.oy) / mapping.scale;
    const zoom = cy.zoom();
    const center = getVisibleCanvasCenter(cy.width(), cy.height());
    cy.pan({ x: center.x - modelX * zoom, y: center.y - modelY * zoom });
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      navigateTo(e.clientX, e.clientY);
      const move = (ev: MouseEvent) => navigateTo(ev.clientX, ev.clientY);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [navigateTo],
  );

  // 指数缩放，以可视区域中心为锚点（Cytoscape 自动保持该模型点不偏移）
  const zoomBy = useCallback((factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const currentZoom = cy.zoom();
    const newZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), currentZoom * factor));
    const pan = cy.pan();
    const center = getVisibleCanvasCenter(cy.width(), cy.height());
    cy.zoom({
      level: newZoom,
      position: {
        x: (center.x - pan.x) / currentZoom,
        y: (center.y - pan.y) / currentZoom,
      },
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const currentZoom = cy.zoom();
    const targetZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), 1));
    const pan = cy.pan();
    const center = getVisibleCanvasCenter(cy.width(), cy.height());
    cy.zoom({
      level: targetZoom,
      position: {
        x: (center.x - pan.x) / currentZoom,
        y: (center.y - pan.y) / currentZoom,
      },
    });
  }, []);

  const handleFitAll = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    fitToElements(cy, cy.elements());
  }, []);

  // 聚焦到选中节点：视口移到可视区域中心 + 缩放至至少 1.2（与灵动岛 handleFocusSelected 同行为）
  const handleFocusSelected = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const id = canvasStore.selectedNodeId;
    if (!id) return;
    const node = cy.getElementById(id);
    if (node.length === 0) return;
    const center = getVisibleCanvasCenter(cy.width(), cy.height());
    const targetZoom = Math.max(cy.zoom(), 1.2);
    const nodePos = node.position();
    cy.animate({
      pan: {
        x: center.x - nodePos.x * targetZoom,
        y: center.y - nodePos.y * targetZoom,
      },
      zoom: targetZoom,
      duration: 400,
    });
  }, []);

  // 缩放至选中节点及其关联节点（closedNeighborhood 包围盒，同灵动岛 handleFitSelected）
  const handleFitSelected = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const id = canvasStore.selectedNodeId;
    if (!id) return;
    const node = cy.getElementById(id);
    if (node.length === 0) return;
    fitToElements(cy, node.closedNeighborhood(), 60, 500);
  }, []);

  // 图例项：切换节点类型显隐（与筛选面板同源 visibleTypes）
  const handleLegendToggle = useCallback((t: LegendType) => {
    canvasStore.visibleTypes[t] = !canvasStore.visibleTypes[t];
  }, []);

  // 悬停节点缩略：主画布对应节点 minimap-hover 高亮（空间定位反馈，不显示名字浮层）
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cy = cyRef.current;
    const canvas = canvasRef.current;
    if (!cy || !canvas) return;
    const hitId = hitTestNode(cy, canvas, e.clientX, e.clientY);
    const prevId = minimapHoverNodeRef.current;
    if (prevId && prevId !== hitId) {
      cy.getElementById(prevId).removeClass('minimap-hover');
      minimapHoverNodeRef.current = null;
    }
    if (hitId && prevId !== hitId) {
      cy.getElementById(hitId).addClass('minimap-hover');
      minimapHoverNodeRef.current = hitId;
    }
  }, []);

  const handleCanvasMouseLeave = useCallback(() => {
    const cy = cyRef.current;
    if (cy && minimapHoverNodeRef.current) {
      cy.getElementById(minimapHoverNodeRef.current).removeClass('minimap-hover');
      minimapHoverNodeRef.current = null;
    }
  }, []);

  // 双击：以该点为锚放大一级（与 mousedown 导航叠加 = 先居中再放大）
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cy = cyRef.current;
    const canvas = canvasRef.current;
    if (!cy || !canvas) return;
    const mapping = computeMapping(cy);
    if (!mapping) return;
    const rect = canvas.getBoundingClientRect();
    const modelX = (e.clientX - rect.left - mapping.ox) / mapping.scale;
    const modelY = (e.clientY - rect.top - mapping.oy) / mapping.scale;
    const currentZoom = cy.zoom();
    const newZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), currentZoom * ZOOM_FACTOR));
    cy.zoom({ level: newZoom, position: { x: modelX, y: modelY } });
  }, []);

  if (isMobile || !canvasReady) return null;

  if (!minimapOpen) {
    return (
      <button
        className='minimap-expand-btn'
        style={{
          right: rightOffset,
          bottom: 'calc(16px + var(--terminal-offset, 0px))',
        }}
        onClick={toggleMinimap}
        title='展开全景导航'>
        <CompassOutlined />
      </button>
    );
  }

  return (
    <div
      className='minimap-cluster'
      style={{
        right: rightOffset,
        bottom: 'calc(16px + var(--terminal-offset, 0px))',
      }}>
      <div className='minimap-zoombar'>
        <button
          className='minimap-zoombar__btn'
          onClick={() => zoomBy(1 / ZOOM_FACTOR)}
          title='缩小'>
          <MinusOutlined />
        </button>
        <button className='minimap-zoombar__pct' onClick={handleResetZoom} title='重置为 100%'>
          {zoomPct}%
        </button>
        <button className='minimap-zoombar__btn' onClick={() => zoomBy(ZOOM_FACTOR)} title='放大'>
          <PlusOutlined />
        </button>
        <button className='minimap-zoombar__btn' onClick={handleFitAll} title='适配全部'>
          <ExpandOutlined />
        </button>
        <span className='minimap-zoombar__divider' />
        <button
          className='minimap-zoombar__btn'
          onClick={handleFocusSelected}
          disabled={!selectedNodeId}
          title='聚焦到选中节点'>
          <AimOutlined />
        </button>
        <button
          className='minimap-zoombar__btn'
          onClick={handleFitSelected}
          disabled={!selectedNodeId}
          title='缩放至选中节点及其关联节点'>
          <CompressOutlined />
        </button>
      </div>
      <div className='minimap'>
        <canvas
          ref={canvasRef}
          className='minimap__canvas'
          style={{ width: MAP_W, height: MAP_H }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
          onDoubleClick={handleDoubleClick}
        />
        <div className='minimap__legend'>
          {LEGEND_TYPES.map((t) => (
            <button
              type='button'
              className={`minimap__legend-item${
                visibleTypes[t] ? '' : ' minimap__legend-item--off'
              }`}
              key={t}
              onClick={() => handleLegendToggle(t)}
              title={`点击${visibleTypes[t] ? '隐藏' : '显示'} ${t} 节点`}>
              <i style={{ background: getEntityColor(t) }} />
              {legend[t]}
            </button>
          ))}
        </div>
        <button className='minimap__collapse' onClick={toggleMinimap} title='收起全景导航'>
          <MinusOutlined />
        </button>
      </div>
    </div>
  );
});
