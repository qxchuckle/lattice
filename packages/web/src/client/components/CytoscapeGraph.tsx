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
    taskStatusFilter,
    specScopeFilter,
    projectFilter,
    canvasKeyword,
    userFilter,
  } = useSnapshot(canvasStore);
  const graphData = useGlobalGraph();
  const visibleTypesRef = useRef(visibleTypes);
  visibleTypesRef.current = visibleTypes;
  const visibleEdgeTypesRef = useRef(visibleEdgeTypes);
  visibleEdgeTypesRef.current = visibleEdgeTypes;
  const taskStatusFilterRef = useRef(taskStatusFilter);
  taskStatusFilterRef.current = taskStatusFilter;
  const specScopeFilterRef = useRef(specScopeFilter);
  specScopeFilterRef.current = specScopeFilter;
  const projectFilterRef = useRef(projectFilter);
  projectFilterRef.current = projectFilter;
  const canvasKeywordRef = useRef(canvasKeyword);
  canvasKeywordRef.current = canvasKeyword;
  const userFilterRef = useRef(userFilter);
  userFilterRef.current = userFilter;
  const skipAnchorRef = useRef(false);
  const visibleTypesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hoveredElesRef = useRef<cytoscape.Collection | null>(null);
  const hoveredEdgesRef = useRef<cytoscape.EdgeCollection | null>(null);
  const wasPanningRef = useRef(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      userZoomingEnabled: false, // 禁用默认 wheel 缩放，由自定义 wheel 监听器处理触摸板缩放/平移
    });

    cy.on('tap', 'node', (evt) => {
      if (wasPanningRef.current) {
        wasPanningRef.current = false;
        return;
      }
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
      // 记录是否点击的是当前已选中节点：若已选中，selectNode 不改变 selectedNodeId、
      // navigate 不改变 URL，skipAnchorRef 不会被任何 useEffect 消费，会导致残留 true
      const wasAlreadySelected = canvasStore.selectedNodeId === nodeId;
      selectNode(nodeId, entityType as 'task' | 'project' | 'spec', data);
      applyFocus(cy, nodeId, canvasStore.focusDepth);
      if (entityType === 'task' || entityType === 'project' || entityType === 'spec') {
        const urlId = nodeId.startsWith('spec-') ? nodeId.slice(5) : nodeId;
        // 仅在 URL 会变化（节点非已选中）时设置 skipAnchorRef，
        // 否则 skipAnchorRef 残留为 true 会导致下一次 anchorId 变化被错误跳过
        if (!wasAlreadySelected) {
          skipAnchorRef.current = true;
        }
        navigate(getViewPath(entityType as ViewMode, urlId));
      }
    });

    const applyHover = (node: cytoscape.NodeSingular) => {
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
    };

    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target as cytoscape.NodeSingular;
      // 100ms 延迟，避免快速划过时闪烁
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => applyHover(node), 100);
    });

    cy.on('mouseout', 'node', () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (hoveredElesRef.current) {
        hoveredElesRef.current.addClass('dimmed');
        hoveredElesRef.current = null;
      }
      if (hoveredEdgesRef.current) {
        hoveredEdgesRef.current.removeClass('hovered');
        hoveredEdgesRef.current = null;
      }
    });

    cy.on('tap', 'edge', () => {
      if (wasPanningRef.current) {
        wasPanningRef.current = false;
        return;
      }
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
    // HMR 后组件重新挂载：重置模块级 focus 状态（旧 lastNeighborhood 引用已销毁的元素）
    // 并重置 canvasReady 显示 loading 遮罩，直到首次布局完成
    clearFocus(cy);
    canvasStore.canvasReady = false;

    // 自定义 wheel 事件：触摸板捏合→缩放、触摸板双指滚动→平移、鼠标滚轮→缩放
    const container = containerRef.current!;
    const zoomAroundEvent = (e: WheelEvent, factor: number) => {
      const currentZoom = cy.zoom();
      const newZoom = Math.max(
        cy.minZoom(),
        Math.min(cy.maxZoom(), currentZoom * Math.exp(-e.deltaY * factor)),
      );
      const rect = container.getBoundingClientRect();
      const renderedX = e.clientX - rect.left;
      const renderedY = e.clientY - rect.top;
      const pan = cy.pan();
      cy.zoom({
        level: newZoom,
        position: {
          x: (renderedX - pan.x) / currentZoom,
          y: (renderedY - pan.y) / currentZoom,
        },
      });
    };

    // 鼠标 vs 触摸板检测状态（兜底 delta 稳定性方法用）
    let scrollDevice: 'mouse' | 'trackpad' = 'mouse';
    let initialDeltaY = 0;
    let lastWheelTime = 0;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // 触摸板双指捏合缩放
        zoomAroundEvent(e, 0.01);
        return;
      }

      // 分层检测鼠标滚轮 vs 触摸板
      const wdy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      if (e.deltaMode !== 0) {
        // Firefox：行模式 = 鼠标滚轮
        scrollDevice = 'mouse';
      } else if (wdy !== undefined) {
        // Chrome/Safari/Edge：触摸板的 wheelDeltaY === deltaY * -3（Chrome 内部计算），鼠标滚轮不是
        // macOS 鼠标滚轮：deltaY=±100, wheelDeltaY=±120, 比例=-1.2 而非 -3
        // macOS 触摸板：Chrome 计算 wheelDeltaY = deltaY * -3
        scrollDevice = Math.abs(wdy - e.deltaY * -3) > 1 ? 'mouse' : 'trackpad';
      } else {
        // 兜底：delta 稳定性检测
        const now = performance.now();
        const dt = now - lastWheelTime;
        lastWheelTime = now;
        if (dt > 100) {
          // 新滚动会话：默认鼠标，记录初始 deltaY
          scrollDevice = 'mouse';
          initialDeltaY = e.deltaY;
        } else if (e.deltaY !== initialDeltaY) {
          // deltaY 变化 = 触摸板
          scrollDevice = 'trackpad';
        }
      }

      if (scrollDevice === 'trackpad') {
        // 触摸板双指滚动平移（自然滚动方向）
        cy.panBy({ x: -e.deltaX, y: -e.deltaY });
      } else {
        // 鼠标滚轮缩放
        zoomAroundEvent(e, 0.002);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    // 从节点拖拽平移画布：ungrabify 的节点不触发 Cytoscape pan，手动实现
    let panState: 'idle' | 'mightPan' | 'panning' = 'idle';
    let panLastX = 0;
    let panLastY = 0;
    const PAN_THRESHOLD = 5;

    cy.on('vmousedown', 'node', () => {
      panState = 'mightPan';
    });

    const handlePanMouseDown = (e: MouseEvent) => {
      panLastX = e.clientX;
      panLastY = e.clientY;
    };

    const handlePanMouseMove = (e: MouseEvent) => {
      if (panState === 'idle') return;
      if (panState === 'mightPan') {
        if (
          Math.abs(e.clientX - panLastX) < PAN_THRESHOLD &&
          Math.abs(e.clientY - panLastY) < PAN_THRESHOLD
        )
          return;
        panState = 'panning';
      }
      cy.panBy({ x: e.clientX - panLastX, y: e.clientY - panLastY });
      panLastX = e.clientX;
      panLastY = e.clientY;
    };

    const handlePanMouseUp = () => {
      if (panState === 'panning') wasPanningRef.current = true;
      panState = 'idle';
    };

    // 鼠标离开画布时清理 hover 状态
    const handleMouseLeave = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (hoveredElesRef.current) {
        hoveredElesRef.current.addClass('dimmed');
        hoveredElesRef.current = null;
      }
      if (hoveredEdgesRef.current) {
        hoveredEdgesRef.current.removeClass('hovered');
        hoveredEdgesRef.current = null;
      }
    };

    container.addEventListener('mousedown', handlePanMouseDown);
    container.addEventListener('mousemove', handlePanMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('mouseup', handlePanMouseUp);

    return () => {
      container.removeEventListener('mousedown', handlePanMouseDown);
      container.removeEventListener('mousemove', handlePanMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('mouseup', handlePanMouseUp);
      container.removeEventListener('wheel', handleWheel);
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
      taskStatusFilterRef.current,
      specScopeFilterRef.current,
      projectFilterRef.current,
      canvasKeywordRef.current,
    );

    // 同步 lastVisibleKey：图数据更新已全量重建，防止筛选变化 useEffect 重复触发布局
    lastVisibleKey.current = [
      Object.entries(visibleTypesRef.current)
        .map(([k, v]) => `${k}:${v}`)
        .join('|'),
      Object.entries(visibleEdgeTypesRef.current)
        .map(([k, v]) => `${k}:${v}`)
        .join('|'),
      taskStatusFilterRef.current.join(','),
      specScopeFilterRef.current.join(','),
      projectFilterRef.current.join(','),
      canvasKeywordRef.current,
      userFilterRef.current.join(','),
    ].join('||');

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
              // 仅在 selectedNodeId 会变化时设置 skipAnchorRef（HMR 后可能已选中同一节点）
              if (canvasStore.selectedNodeId !== anchorId) {
                skipAnchorRef.current = true;
              }
              selectNode(anchorId, data.entityType as 'task' | 'project' | 'spec', data);
              applyFocus(cy, node.id(), canvasStore.focusDepth, true);
            }
          } else if (selectedNodeId) {
            // 无 anchorId 但有 selectedNodeId（HMR 后全局 store 保留选中状态）
            applyFocus(cy, selectedNodeId, canvasStore.focusDepth, true);
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
      runLayout(
        cy,
        elements.length,
        layoutMode,
        () => {
          canvasStore.layoutRunning = false;
        },
        false,
        true,
      );

      if (anchorId) {
        const node = findNodeById(cy, anchorId);
        if (node.length > 0) {
          const data = node.data() as Record<string, unknown>;
          selectNode(anchorId, data.entityType as 'task' | 'project' | 'spec', data);
          applyFocus(cy, anchorId, canvasStore.focusDepth);
        }
      } else if (selectedNodeId) {
        // 全局视角下有选中节点：恢复 focus，不存在则清除
        const node = findNodeById(cy, selectedNodeId);
        if (node.length > 0) {
          applyFocus(cy, selectedNodeId, canvasStore.focusDepth);
        } else {
          clearFocus(cy);
          closeDetail();
          canvasStore.anchorId = null;
          navigate('/');
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
    runLayout(
      cy,
      cy.elements().length,
      layoutMode,
      () => {
        canvasStore.layoutRunning = false;
      },
      false,
      true,
    );
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
    // 仅在 selectNode 会改变 selectedNodeId 时设置 skipAnchorRef，
    // 否则 selectedNodeId useEffect 不触发，skipAnchorRef 残留为 true
    const node = findNodeById(cy, anchorId);
    const targetNodeId = node.length > 0 ? node.id() : anchorId;
    if (canvasStore.selectedNodeId !== targetNodeId) {
      skipAnchorRef.current = true;
    }
    if (node.length > 0) {
      const data = node.data() as Record<string, unknown>;
      selectNode(node.id(), data.entityType as 'task' | 'project' | 'spec', data);
      applyFocus(cy, node.id(), canvasStore.focusDepth);
    } else {
      const entityType = canvasStore.viewMode === 'global' ? 'task' : canvasStore.viewMode;
      selectNode(anchorId, entityType as 'task' | 'project' | 'spec');
    }
  }, [anchorId]);

  // 筛选变化时重建图（防抖 300ms）
  const lastVisibleKey = useRef<string>('');
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || graphData.isLoading) return;
    const key = [
      Object.entries(visibleTypes)
        .map(([k, v]) => `${k}:${v}`)
        .join('|'),
      Object.entries(visibleEdgeTypes)
        .map(([k, v]) => `${k}:${v}`)
        .join('|'),
      taskStatusFilter.join(','),
      specScopeFilter.join(','),
      projectFilter.join(','),
      canvasKeyword,
      userFilter.join(','),
    ].join('||');
    if (key === lastVisibleKey.current) return;
    lastVisibleKey.current = key;

    if (visibleTypesTimerRef.current) clearTimeout(visibleTypesTimerRef.current);
    visibleTypesTimerRef.current = setTimeout(() => {
      const elements = toElements(
        graphData.nodes,
        graphData.edges,
        { ...visibleTypes },
        { ...visibleEdgeTypes },
        [...taskStatusFilter],
        [...specScopeFilter],
        [...projectFilter],
        canvasKeyword,
      );

      // 增量增减：diff 当前画布与期望集合
      const desiredIds = new Set(elements.map((e) => e.data.id ?? ''));
      const currentEles = cy.elements();
      const currentIds = new Set(currentEles.map((e) => e.id()));
      const toRemove = currentEles.filter((e) => !desiredIds.has(e.id()));
      const toAdd = elements.filter((e) => !currentIds.has(e.data.id ?? ''));

      // 增量增减：只移除/添加变化的元素，保持已有节点位置不跳
      cy.batch(() => {
        if (toRemove.length > 0) {
          cy.remove(toRemove);
          // 清理可能失效的 hover 引用（被移除的元素可能仍在 refs 中）
          hoveredElesRef.current = null;
          hoveredEdgesRef.current = null;
        }
        if (toAdd.length > 0) {
          const newNodes = toAdd.filter((e) => !e.data.source);
          const newEdges = toAdd.filter((e) => e.data.source);
          if (newNodes.length > 0) {
            // 新节点位置：从相连已有节点推断，否则视口中心附近随机散开
            const vp = cy.pan();
            const zoom = cy.zoom();
            const cx = -vp.x / zoom + cy.width() / (2 * zoom);
            const cy_ = -vp.y / zoom + cy.height() / (2 * zoom);
            newNodes.forEach((nodeDef) => {
              let pos: { x: number; y: number } | null = null;
              for (const edge of newEdges) {
                if (edge.data.source === nodeDef.data.id) {
                  const target = cy.getElementById(edge.data.target);
                  if (target.length > 0) {
                    const p = target.position();
                    pos = { x: p.x + 60, y: p.y + 30 };
                    break;
                  }
                }
                if (edge.data.target === nodeDef.data.id) {
                  const source = cy.getElementById(edge.data.source);
                  if (source.length > 0) {
                    const p = source.position();
                    pos = { x: p.x + 60, y: p.y + 30 };
                    break;
                  }
                }
              }
              if (!pos)
                pos = {
                  x: cx + (Math.random() - 0.5) * 120,
                  y: cy_ + (Math.random() - 0.5) * 120,
                };
              nodeDef.position = pos;
            });
            cy.add(newNodes);
          }
          if (newEdges.length > 0) cy.add(newEdges);
          cy.nodes().ungrabify();
          // 有选中节点时，新节点默认 dimmed，applyFocus 会恢复邻域节点的样式
          if (selectedNodeId && newNodes.length > 0) {
            const newNodeIds = newNodes.map((n) => n.data.id).filter((id): id is string => !!id);
            newNodeIds.forEach((id) => {
              cy.getElementById(id).addClass('dimmed');
            });
          }
        }
      });
      // 选中节点被移除时彻底清除选中状态（含 anchorId + URL）
      if (selectedNodeId && cy.getElementById(selectedNodeId).length === 0) {
        clearFocus(cy);
        closeDetail();
        canvasStore.anchorId = null;
        navigate('/');
      }
      // 布局计算：force 模式用增量布局(randomize=false)，sequential/radial 模式全量布局
      const applyFocusAfter = () => {
        const focusId = anchorId || canvasStore.selectedNodeId;
        if (focusId) {
          const node = findNodeById(cy, focusId);
          if (node.length > 0) {
            applyFocus(cy, node.id(), canvasStore.focusDepth, false, true);
          }
        }
      };
      canvasStore.layoutRunning = true;
      runLayout(
        cy,
        cy.nodes().length,
        layoutMode,
        () => {
          canvasStore.layoutRunning = false;
          applyFocusAfter();
        },
        false,
        true,
        false, // 全量重新布局，与其他图类型一致
      );
    }, 300);
    return () => {
      if (visibleTypesTimerRef.current) clearTimeout(visibleTypesTimerRef.current);
    };
  }, [
    visibleTypes,
    visibleEdgeTypes,
    taskStatusFilter,
    specScopeFilter,
    projectFilter,
    canvasKeyword,
    userFilter,
  ]);

  // focusDepth 变化时直接 applyFocus（force=true 跳过同节点去重，否则 depth 变了但 nodeId 没变会被 applyFocus 内部 return）
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (isFirstRenderRef.current) return;
    if (!selectedNodeId) return;
    applyFocus(cy, selectedNodeId, focusDepth, false, true);
  }, [focusDepth]);

  // selectedNodeId 变化时 applyFocus（检查 skipAnchorRef 跳过重复调用）
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (isFirstRenderRef.current) return;
    if (!selectedNodeId) {
      clearFocus(cy);
      return;
    }
    if (skipAnchorRef.current) {
      skipAnchorRef.current = false;
      return;
    }
    applyFocus(cy, selectedNodeId, focusDepth);
  }, [selectedNodeId]);

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
      selectNode(locateNodeId, data.entityType as 'task' | 'project' | 'spec', data);
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
