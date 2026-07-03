import { useEffect, useRef, memo } from 'react';
import { Spin } from 'antd';
import { useNavigate } from 'react-router';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useSnapshot } from 'valtio';
import {
  canvasStore,
  cyRef,
  selectNode,
  closeDetail,
  getViewPath,
  themeStore,
  type ViewMode,
} from '../store';
import { useGlobalGraph } from '../hooks';
import { buildStylesheet } from './graph/stylesheet';
import { runLayout, applyFocus, clearFocus, findNodeById } from './graph/layout';
import { toElements } from './graph/elements';

cytoscape.use(fcose);

export const CytoscapeGraph = memo(function CytoscapeGraph() {
  const { mode } = useSnapshot(themeStore);
  const isDark = mode === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const lastElementCountRef = useRef<number>(0);
  const isFirstRenderRef = useRef(true);
  const navigate = useNavigate();
  const {
    anchorId,
    locateNodeId,
    visibleTypes,
    visibleEdgeTypes,
    focusDepth,
    selectedNodeId,
    layoutMode,
    canvasReady,
  } = useSnapshot(canvasStore);
  const graphData = useGlobalGraph();
  const visibleTypesRef = useRef(visibleTypes);
  visibleTypesRef.current = visibleTypes;
  const visibleEdgeTypesRef = useRef(visibleEdgeTypes);
  visibleEdgeTypesRef.current = visibleEdgeTypes;
  const skipAnchorRef = useRef(false);
  const visibleTypesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hoveredElesRef = useRef<cytoscape.Collection | null>(null);
  const hoveredEdgesRef = useRef<cytoscape.EdgeCollection | null>(null);

  // 初始化（仅一次）
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: buildStylesheet(isDark),
      layout: { name: 'grid' },
      wheelSensitivity: 0.3,
      minZoom: 0.08,
      maxZoom: 3,
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      // 清理 hover 状态：移除旧 hovered 边的 class + 恢复旧 dimmed 元素
      if (hoveredEdgesRef.current) {
        hoveredEdgesRef.current.removeClass('hovered');
      }
      if (hoveredElesRef.current) {
        hoveredElesRef.current.addClass('dimmed');
      }
      hoveredElesRef.current = null;
      hoveredEdgesRef.current = null;
      const data = node.data() as Record<string, unknown>;
      const entityType = data.entityType as string;
      const nodeId = node.id();
      selectNode(
        nodeId,
        entityType as 'task' | 'project' | 'spec' | 'checkpoint' | 'document',
        data,
      );
      applyFocus(cy, nodeId, canvasStore.focusDepth);
      if (
        entityType === 'task' ||
        entityType === 'project' ||
        entityType === 'spec' ||
        entityType === 'checkpoint'
      ) {
        const urlId = nodeId.startsWith('spec-') ? nodeId.slice(5) : nodeId;
        skipAnchorRef.current = true;
        navigate(getViewPath(entityType as ViewMode, urlId));
      }
    });

    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target as cytoscape.NodeSingular;
      // 恢复上次被移除 dimmed 的元素
      if (hoveredElesRef.current) {
        hoveredElesRef.current.addClass('dimmed');
      }
      // 移除上次被加 hovered 的边
      if (hoveredEdgesRef.current) {
        hoveredEdgesRef.current.removeClass('hovered');
      }
      // 找出当前邻域中 dimmed 的元素，移除 dimmed 恢复可见性
      const neighborhood = node.closedNeighborhood();
      const dimmedInNeighborhood = neighborhood.filter((el) => el.hasClass('dimmed'));
      dimmedInNeighborhood.removeClass('dimmed');
      hoveredElesRef.current = dimmedInNeighborhood;
      // 给邻域中的边加 hovered（绿色连线）
      const edges = neighborhood.edges();
      edges.addClass('hovered');
      hoveredEdgesRef.current = edges as cytoscape.EdgeCollection;
    });

    cy.on('mouseout', 'node', () => {
      if (hoveredElesRef.current) {
        hoveredElesRef.current.addClass('dimmed');
        hoveredElesRef.current = null;
      }
      if (hoveredEdgesRef.current) {
        hoveredEdgesRef.current.removeClass('hovered');
        hoveredEdgesRef.current = null;
      }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        clearFocus(cy);
        if (hoveredEdgesRef.current) {
          hoveredEdgesRef.current.removeClass('hovered');
        }
        if (hoveredElesRef.current) {
          hoveredElesRef.current.addClass('dimmed');
        }
        hoveredElesRef.current = null;
        hoveredEdgesRef.current = null;
        closeDetail();
        navigate('/');
      }
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // 主题切换
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style(buildStylesheet(isDark));
  }, [isDark]);

  // 图数据更新：仅在元素数量变化时重建
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || graphData.isLoading) return;
    const elementCount = graphData.nodes.length + graphData.edges.length;
    if (elementCount === lastElementCountRef.current) {
      // 首次加载但元素为 0 时也需标记 ready，避免 loading 遮罩永远不消失
      if (isFirstRenderRef.current && elementCount === 0) {
        canvasStore.canvasReady = true;
        isFirstRenderRef.current = false;
      }
      return;
    }
    lastElementCountRef.current = elementCount;

    const isFirst = isFirstRenderRef.current;
    const elements = toElements(
      graphData.nodes,
      graphData.edges,
      visibleTypesRef.current,
      visibleEdgeTypesRef.current,
    );

    if (isFirst) {
      // 首次加载：batch 合并 DOM 操作，禁用布局/fit/focus 动画，避免中间状态闪烁
      cy.batch(() => {
        cy.elements().remove();
        cy.add(elements);
      });
      cy.nodes().ungrabify();
      canvasStore.layoutRunning = true;
      runLayout(
        cy,
        elements.length,
        layoutMode,
        () => {
          canvasStore.layoutRunning = false;
          canvasStore.canvasReady = true;
          isFirstRenderRef.current = false;
          // 首次布局完成后处理 anchorId 聚焦（无动画）
          if (anchorId) {
            const node = findNodeById(cy, anchorId);
            if (node.length > 0) {
              const data = node.data() as Record<string, unknown>;
              selectNode(
                anchorId,
                data.entityType as 'task' | 'project' | 'spec' | 'checkpoint' | 'document',
                data,
              );
              // 标记跳过 selectedNodeId useEffect 的重复 applyFocus
              skipAnchorRef.current = true;
              applyFocus(cy, node.id(), canvasStore.focusDepth, true);
            }
          }
        },
        true,
      );
    } else {
      // 后续更新：保持原有动画逻辑
      cy.elements().remove();
      cy.add(elements);
      cy.nodes().ungrabify();
      canvasStore.layoutRunning = true;
      runLayout(cy, elements.length, layoutMode, () => {
        canvasStore.layoutRunning = false;
      });

      if (anchorId) {
        const node = findNodeById(cy, anchorId);
        if (node.length > 0) {
          const data = node.data() as Record<string, unknown>;
          selectNode(
            anchorId,
            data.entityType as 'task' | 'project' | 'spec' | 'checkpoint' | 'document',
            data,
          );
          applyFocus(cy, anchorId, canvasStore.focusDepth);
        }
      }
    }
  }, [graphData.nodes, graphData.edges, graphData.isLoading]);

  // 布局模式变化时重新运行布局
  useEffect(() => {
    if (isFirstRenderRef.current) return;
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) return;
    canvasStore.layoutRunning = true;
    runLayout(cy, cy.elements().length, layoutMode, () => {
      canvasStore.layoutRunning = false;
    });
  }, [layoutMode]);

  // 锚点变化：仅聚焦
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !anchorId) return;
    if (isFirstRenderRef.current) return;
    if (skipAnchorRef.current) {
      skipAnchorRef.current = false;
      return;
    }
    // 标记跳过 selectedNodeId useEffect 的重复 applyFocus
    skipAnchorRef.current = true;
    const node = findNodeById(cy, anchorId);
    if (node.length > 0) {
      const data = node.data() as Record<string, unknown>;
      selectNode(
        node.id(),
        data.entityType as 'task' | 'project' | 'spec' | 'checkpoint' | 'document',
        data,
      );
      applyFocus(cy, node.id(), canvasStore.focusDepth);
    } else {
      const entityType = canvasStore.viewMode === 'global' ? 'task' : canvasStore.viewMode;
      selectNode(anchorId, entityType as 'task' | 'project' | 'spec' | 'checkpoint');
    }
    // selectNode 是同步的，但 React useEffect 批量执行，
    // selectedNodeId 变化触发的 useEffect 会在本 effect 之后执行，此时 skipAnchorRef 仍为 true
  }, [anchorId]);

  // 筛选变化时重建图（防抖 300ms）
  const lastVisibleKey = useRef<string>('');
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || graphData.isLoading) return;
    const key = Object.entries(visibleTypes)
      .map(([k, v]) => `${k}:${v}`)
      .join('|');
    if (key === lastVisibleKey.current) return;
    lastVisibleKey.current = key;

    if (visibleTypesTimerRef.current) clearTimeout(visibleTypesTimerRef.current);
    visibleTypesTimerRef.current = setTimeout(() => {
      const elements = toElements(
        graphData.nodes,
        graphData.edges,
        { ...visibleTypes },
        { ...visibleEdgeTypes },
      );
      cy.elements().remove();
      cy.add(elements);
      cy.nodes().ungrabify();
      canvasStore.layoutRunning = true;
      runLayout(cy, elements.length, layoutMode, () => {
        canvasStore.layoutRunning = false;
      });
      if (anchorId) {
        const node = findNodeById(cy, anchorId);
        if (node.length > 0) {
          const data = node.data() as Record<string, unknown>;
          selectNode(
            anchorId,
            data.entityType as 'task' | 'project' | 'spec' | 'checkpoint' | 'document',
            data,
          );
          applyFocus(cy, node.id(), canvasStore.focusDepth);
        }
      }
    }, 300);
    return () => {
      if (visibleTypesTimerRef.current) clearTimeout(visibleTypesTimerRef.current);
    };
  }, [visibleTypes, visibleEdgeTypes]);

  // 聚焦深度变化时重新 applyFocus；selectedNodeId 清空时清除聚焦样式
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!selectedNodeId) {
      clearFocus(cy);
      return;
    }
    if (skipAnchorRef.current) {
      skipAnchorRef.current = false;
      return;
    }
    applyFocus(cy, selectedNodeId, focusDepth);
  }, [focusDepth, selectedNodeId]);

  // 脉冲动效
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (pulseTimerRef.current) {
      clearInterval(pulseTimerRef.current);
      pulseTimerRef.current = null;
    }
    if (!selectedNodeId) {
      cy.nodes().removeClass('pulse');
      return;
    }
    pulseTimerRef.current = setInterval(() => {
      const node = cy.getElementById(selectedNodeId);
      if (node.length > 0) node.toggleClass('pulse');
    }, 800);
    return () => {
      if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
    };
  }, [selectedNodeId]);

  // 定位节点
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !locateNodeId) return;
    const node = findNodeById(cy, locateNodeId);
    if (node.length > 0) {
      const data = node.data() as Record<string, unknown>;
      selectNode(
        locateNodeId,
        data.entityType as 'task' | 'project' | 'spec' | 'checkpoint' | 'document',
        data,
      );
      // force=true 强制执行视口动画，即使用户已选中该节点
      // 不设置 skipAnchorRef：若 selectedNodeId 变化，selectedNodeId useEffect 中的
      // applyFocus(force=false) 会因同一节点自然跳过；若 selectedNodeId 不变，useEffect 不触发
      applyFocus(cy, node.id(), canvasStore.focusDepth, false, true);
    }
    canvasStore.locateNodeId = null;
  }, [locateNodeId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: isDark ? '#1D1D26' : '#F5F5F5' }}
      />
      {(graphData.isLoading || !canvasReady) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDark ? '#1D1D26' : '#F5F5F5',
            zIndex: 10,
          }}>
          <Spin size='large' />
        </div>
      )}
    </div>
  );
});
