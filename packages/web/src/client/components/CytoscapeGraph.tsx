import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useSnapshot } from 'valtio';
import {
  canvasStore,
  selectNode,
  closeDetail,
  getViewPath,
  themeStore,
  type ViewMode,
} from '../store';
import { useGlobalGraph } from '../hooks';
import { CanvasToolbar } from './graph/CanvasToolbar';
import { buildStylesheet } from './graph/stylesheet';
import { buildLayoutConfig, applyFocus, clearFocus, findNodeById } from './graph/layout';
import { toElements } from './graph/elements';

cytoscape.use(fcose);

export function CytoscapeGraph() {
  const { mode } = useSnapshot(themeStore);
  const isDark = mode === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const lastElementCountRef = useRef<number>(0);
  const navigate = useNavigate();
  const {
    anchorId,
    locateNodeId,
    visibleTypes,
    visibleEdgeTypes,
    focusDepth,
    selectedNodeId,
    layoutMode,
  } = useSnapshot(canvasStore);
  const graphData = useGlobalGraph();
  const visibleTypesRef = useRef(visibleTypes);
  visibleTypesRef.current = visibleTypes;
  const visibleEdgeTypesRef = useRef(visibleEdgeTypes);
  visibleEdgeTypesRef.current = visibleEdgeTypes;
  const skipAnchorRef = useRef(false);
  const visibleTypesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        clearFocus(cy);
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
    if (elementCount === lastElementCountRef.current) return;
    lastElementCountRef.current = elementCount;

    const elements = toElements(
      graphData.nodes,
      graphData.edges,
      visibleTypesRef.current,
      visibleEdgeTypesRef.current,
    );
    cy.elements().remove();
    cy.add(elements);
    cy.nodes().ungrabify();
    cy.layout(buildLayoutConfig(elements.length, layoutMode)).run();

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
  }, [graphData.nodes, graphData.edges, graphData.isLoading]);

  // 布局模式变化时重新运行布局
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) return;
    cy.layout(buildLayoutConfig(cy.elements().length, layoutMode)).run();
  }, [layoutMode]);

  // 锚点变化：仅聚焦
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !anchorId) return;
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
      cy.layout(buildLayoutConfig(elements.length, layoutMode)).run();
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

  // 聚焦深度变化时重新 applyFocus
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) return;
    if (skipAnchorRef.current) return;
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
      applyFocus(cy, node.id(), canvasStore.focusDepth);
    }
    canvasStore.locateNodeId = null;
  }, [locateNodeId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: isDark ? '#1D1D26' : '#F5F5F5' }}
      />
      <CanvasToolbar isDark={isDark} cyRef={cyRef} />
    </div>
  );
}
