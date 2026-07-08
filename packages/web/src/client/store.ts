import type cytoscape from 'cytoscape';
import { proxy } from 'valtio';

// ── 画布状态 ──

export type ViewMode = 'global' | 'task' | 'project' | 'spec';

export type LayoutMode = 'force' | 'sequential' | 'radial';

export const canvasStore = proxy({
  /** 当前视角模式 */
  viewMode: 'global' as ViewMode,
  /** 锚点 ID（当前聚焦的实体） */
  anchorId: null as string | null,
  /** 选中节点 ID */
  selectedNodeId: null as string | null,
  /** 已展开节点记录（id → true） */
  expandedNodes: {} as Record<string, boolean>,
  /** 需要定位到视口中心的节点 ID（触发后自动清除） */
  locateNodeId: null as string | null,
  /** 布局模式 */
  layoutMode: 'force' as LayoutMode,
  /** 画布可见节点类型（图例过滤） */
  visibleTypes: {
    task: true,
    project: true,
    spec: true,
  } as Record<string, boolean>,
  /** 画布可见边类型（边过滤） */
  visibleEdgeTypes: {
    task: true,
    parent: true,
    spec: true,
    ref_spec: true,
    depends_on: true,
    forked_from: true,
    shares_component: true,
    nested_in: true,
    related: true,
    belongs_to: true,
    overrides: true,
    scope: true,
    semantic: true,
  } as Record<string, boolean>,
  /** 聚焦深度（选中节点后高亮的跳数，0 = 全部，默认 1 跳） */
  focusDepth: 1 as number,
  /** 画布任务状态筛选：空数组 = 全部（值: in_progress / completed / archived） */
  taskStatusFilter: [] as string[],
  /** 画布 Spec 范围筛选：空数组 = 全部（值: global / user / project） */
  specScopeFilter: [] as string[],
  /** 画布项目筛选：空数组 = 全部（值为 projectId） */
  projectFilter: [] as string[],
  /** 画布关键字筛选：空字符串 = 不筛选 */
  canvasKeyword: '' as string,
  /** 布局优化中（触发重新排布时置 true，完成后自动复位） */
  layoutRunning: false,
  /** 画布首次渲染完成（首次数据加载 + 布局完成），用于控制 loading 遮罩 */
  canvasReady: false,
});

/** Cytoscape 实例引用（非响应式，由 CytoscapeGraph 赋值，供 FloatingStatusBar 等跨组件访问） */
export const cyRef: { current: cytoscape.Core | null } = { current: null };

// ── 画布搜索状态 ──

export const canvasSearchStore = proxy({
  /** 搜索框是否打开 */
  open: false,
  /** 搜索关键词 */
  query: '',
  /** 匹配的节点 ID 列表 */
  matchIds: [] as string[],
  /** 当前聚焦的匹配索引（-1 = 无匹配） */
  matchIndex: -1,
  /** 是否自动选中节点（true=选中+聚焦，false=仅聚焦视角不选中），持久化到 localStorage */
  autoSelect: localStorage.getItem('lattice-canvas-search-autoselect') !== 'false',
});

/** 打开画布搜索，清除上次搜索高亮 */
export function openCanvasSearch(): void {
  const cy = cyRef.current;
  if (cy) {
    cy.nodes().removeClass('search-match search-current');
  }
  canvasSearchStore.open = true;
  canvasSearchStore.query = '';
  canvasSearchStore.matchIds = [];
  canvasSearchStore.matchIndex = -1;
}

/** 关闭画布搜索，清除节点高亮 */
export function closeCanvasSearch(): void {
  const cy = cyRef.current;
  if (cy) {
    cy.nodes().removeClass('search-match search-current');
  }
  canvasSearchStore.open = false;
}

// ── 侧栏状态 ──

export type FilterType = 'all' | 'task' | 'project' | 'spec';

/** 搜索面板筛选状态 */
export interface SearchFilters {
  /** 类型筛选：all = 不限 */
  type: FilterType;
  /** 任务状态筛选：空数组 = 全部 */
  taskStatus: readonly string[];
  /** Spec 范围筛选：空数组 = 全部（值: global / user / project） */
  specScope: readonly string[];
}

export const sidebarStore = proxy({
  /** 搜索关键词 */
  searchKeyword: '',
  /** 侧栏是否折叠 */
  collapsed: false,
  /** 树形展开状态：key = nodeKey, value = true/false */
  expandedKeys: {} as Record<string, boolean>,
  /** 侧栏宽度（px），持久化到 localStorage */
  width: parseInt(localStorage.getItem('lattice-sidebar-width') || '260', 10),
  /** 搜索面板筛选状态（会话级，不持久化） */
  searchFilters: {
    type: 'all' as FilterType,
    taskStatus: [] as string[],
    specScope: [] as string[],
  } satisfies SearchFilters,
});

// ── 详情面板状态 ──

export const detailStore = proxy({
  /** 详情面板是否打开 */
  open: false,
  /** 详情面板是否临时收起（不丢失数据，点击展开恢复） */
  collapsed: false,
  /** 面板宽度（px），持久化到 localStorage */
  width: parseInt(localStorage.getItem('lattice-detail-width') || '420', 10),
  /** 当前查看的实体 ID */
  entityId: null as string | null,
  /** 当前查看的实体类型 */
  entityType: null as 'task' | 'project' | 'spec' | null,
  /** 节点 data（spec 直接从此渲染，不走 API） */
  entityData: null as Record<string, unknown> | null,
});

// ── 主题状态 ──

export type ThemeMode = 'light' | 'dark';

export const themeStore = proxy({
  /** 当前主题模式 */
  mode: (localStorage.getItem('lattice-web-theme') as ThemeMode) || 'light',
});

// ── 显示模式 ──

export type DisplayMode = 'canvas' | 'table';

export const uiStore = proxy({
  /** 画布/表格切换 */
  displayMode: 'canvas' as DisplayMode,
});

// ── 辅助方法 ──

/** 根据视角和锚点生成路由路径 */
export function getViewPath(mode: ViewMode, anchorId?: string | null): string {
  switch (mode) {
    case 'global':
      return '/';
    case 'task':
      return anchorId ? `/task/${anchorId}` : '/task';
    case 'project':
      return anchorId ? `/project/${anchorId}` : '/project';
    case 'spec':
      return anchorId ? `/spec/${anchorId}` : '/spec';
  }
}

/** 切换主题 */
export function toggleTheme(): void {
  themeStore.mode = themeStore.mode === 'light' ? 'dark' : 'light';
  localStorage.setItem('lattice-web-theme', themeStore.mode);
}

/** 切换视角模式，同时清除锚点 */
export function setViewMode(mode: ViewMode): void {
  canvasStore.viewMode = mode;
  if (mode === 'global') {
    canvasStore.anchorId = null;
  }
}

/** 选中节点并打开详情面板 */
export function selectNode(
  nodeId: string,
  entityType: 'task' | 'project' | 'spec',
  data?: Record<string, unknown>,
): void {
  canvasStore.selectedNodeId = nodeId;
  detailStore.open = true;
  detailStore.entityId = nodeId;
  detailStore.entityType = entityType;
  detailStore.entityData = data || null;
}

/** 定位节点到视口中心 */
export function locateNode(nodeId: string): void {
  canvasStore.locateNodeId = nodeId;
}

/** 关闭详情面板并清除选中 */
export function closeDetail(): void {
  detailStore.open = false;
  detailStore.collapsed = false;
  detailStore.entityId = null;
  detailStore.entityType = null;
  detailStore.entityData = null;
  canvasStore.selectedNodeId = null;
}

/** 临时收起/展开详情面板（不丢失数据） */
export function toggleDetailCollapse(): void {
  detailStore.collapsed = !detailStore.collapsed;
}

/** 设置详情面板宽度（含 clamping + 持久化） */
export function setDetailWidth(width: number): void {
  const clamped = Math.max(320, Math.min(800, Math.round(width)));
  detailStore.width = clamped;
  localStorage.setItem('lattice-detail-width', String(clamped));
}

/** 设置锚点并切换到对应视角 */
export function setAnchor(id: string, mode: ViewMode): void {
  canvasStore.anchorId = id;
  canvasStore.viewMode = mode;
}

/** 设置侧栏宽度（含 clamping + 持久化） */
export function setSidebarWidth(width: number): void {
  const clamped = Math.max(200, Math.min(480, Math.round(width)));
  sidebarStore.width = clamped;
  localStorage.setItem('lattice-sidebar-width', String(clamped));
}

/** 切换节点展开状态 */
export function toggleNodeExpand(nodeId: string): void {
  canvasStore.expandedNodes[nodeId] = !canvasStore.expandedNodes[nodeId];
}

// ── 可视区域计算（面板遮蔽适配）──

/** 面板遮蔽后的可视画布区域边界 */
export interface VisibleCanvasBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** 计算面板遮蔽后的可视区域边界。
 *  左侧栏展开时占据左侧（12px 边距 + width + 12px 间隔），
 *  详情面板展开时占据右侧（同理）。面板折叠或未打开时遮蔽可忽略。 */
export function getVisibleCanvasBounds(
  containerWidth: number,
  containerHeight: number,
): VisibleCanvasBounds {
  const leftOffset = sidebarStore.collapsed ? 0 : sidebarStore.width + 24;
  const rightOffset = detailStore.collapsed || !detailStore.open ? 0 : detailStore.width + 24;
  const width = Math.max(containerWidth - leftOffset - rightOffset, 200);
  return {
    left: leftOffset,
    right: containerWidth - rightOffset,
    top: 0,
    bottom: containerHeight,
    width,
    height: containerHeight,
  };
}

/** 计算面板遮蔽后的可视区域中心点 */
export function getVisibleCanvasCenter(
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  const bounds = getVisibleCanvasBounds(containerWidth, containerHeight);
  return {
    x: (bounds.left + bounds.right) / 2,
    y: containerHeight / 2,
  };
}

/** 获取面包屑路径 */
export function getBreadcrumb(): string[] {
  const { viewMode, anchorId } = canvasStore;
  const crumbs: string[] = [];
  switch (viewMode) {
    case 'global':
      crumbs.push('全局');
      break;
    case 'task':
      crumbs.push('全局', '任务');
      if (anchorId) crumbs.push(anchorId.slice(0, 12));
      break;
    case 'project':
      crumbs.push('全局', '项目');
      if (anchorId) crumbs.push(anchorId.slice(0, 12));
      break;
    case 'spec':
      crumbs.push('全局', 'Spec');
      if (anchorId) crumbs.push(anchorId.slice(0, 12));
      break;
  }
  return crumbs;
}
