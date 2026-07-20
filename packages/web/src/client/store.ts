import type cytoscape from 'cytoscape';
import { proxy } from 'valtio';
import type { LatticeNodeData } from './types/graph';

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
    cross_user: true,
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
  /** 画布用户筛选：空数组 = 仅当前用户（默认行为），非空 = 选中用户列表 */
  userFilter: [] as string[],
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

// ── 全局搜索面板状态 ──

export const globalSearchStore = proxy({
  /** 面板是否打开 */
  open: false,
  /** 搜索类型筛选：all = 不限 */
  searchType: 'all' as 'all' | 'task' | 'project' | 'spec',
});

/** 打开全局搜索面板 */
export function openGlobalSearch(): void {
  globalSearchStore.open = true;
  globalSearchStore.searchType = 'all';
}

/** 关闭全局搜索面板 */
export function closeGlobalSearch(): void {
  globalSearchStore.open = false;
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

export type SidebarView = 'search' | 'filter';

/** 左侧 Activity Bar 图标栏宽度（px，桌面端常驻，参与画布遮蔽计算） */
export const ACTIVITY_BAR_WIDTH = 48;

export const sidebarStore = proxy({
  /** 搜索关键词 */
  searchKeyword: '',
  /** 侧栏是否折叠（桌面端：仅隐藏内容面板，Activity Bar 常驻） */
  collapsed: false,
  /** 整个侧栏是否完全收起（含 Activity Bar，会话级，同 detailStore.collapsed） */
  fullyCollapsed: false,
  /** 当前侧栏视图（搜索 / 筛选），持久化到 localStorage */
  activeView:
    (localStorage.getItem('lattice-sidebar-view') as SidebarView) === 'filter'
      ? 'filter'
      : 'search',
  /** 移动端侧栏 Drawer 是否打开 */
  mobileOpen: false,
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
  entityData: null as LatticeNodeData | null,
});

// ── 主题状态 ──

export type ThemeMode = 'light' | 'dark';

export const themeStore = proxy({
  /** 当前主题模式 */
  mode: (localStorage.getItem('lattice-web-theme') as ThemeMode) || 'light',
});

// ── 管理面板状态 ──

export type AdminTab = 'overview' | 'rag' | 'doctor' | 'trash' | 'scan' | 'user' | 'git';

export const adminStore = proxy({
  /** 管理面板是否打开 */
  open: false,
  /** 当前 Tab */
  activeTab: 'overview' as AdminTab,
});

/** 打开管理面板 */
export function openAdmin(tab?: AdminTab): void {
  adminStore.open = true;
  if (tab) adminStore.activeTab = tab;
}

/** 关闭管理面板 */
export function closeAdmin(): void {
  adminStore.open = false;
}

// ── 鉴权状态 ──

const AUTH_TOKEN_KEY = 'lattice-web-auth-token';

export const authStore = proxy({
  /** 当前 token（null = 未登录） */
  token: null as string | null,
  /** 鉴权是否启用（配置了密码） */
  authEnabled: false,
  /** 是否已初始化（已查询过 /api/auth/status） */
  initialized: false,
});

/** 从存储加载 token（remember→localStorage，否则 sessionStorage） */
export function loadStoredToken(): void {
  const local = localStorage.getItem(AUTH_TOKEN_KEY);
  if (local) {
    authStore.token = local;
    return;
  }
  const session = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (session) {
    authStore.token = session;
  }
}

/** 保存 token（remember=true 存 localStorage，false 存 sessionStorage） */
export function saveToken(token: string, remember: boolean): void {
  authStore.token = token;
  if (remember) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } else {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

/** 清除 token（登出 / 401） */
export function clearToken(): void {
  authStore.token = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

// 模块加载时同步从存储恢复 token（在 App 首次 render 之前，避免鉴权 useEffect 误跳登录）
if (typeof window !== 'undefined') {
  loadStoredToken();
}

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
  data?: LatticeNodeData,
): void {
  canvasStore.selectedNodeId = nodeId;
  detailStore.open = true;
  detailStore.collapsed = false; // 选中新节点时展开面板（移动端 Drawer 也重新展开）
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

/** 设置侧栏视图（搜索 / 筛选）并持久化 */
export function setSidebarView(view: SidebarView): void {
  sidebarStore.activeView = view;
  localStorage.setItem('lattice-sidebar-view', view);
}

/** 切换节点展开状态 */
export function toggleNodeExpand(nodeId: string): void {
  canvasStore.expandedNodes[nodeId] = !canvasStore.expandedNodes[nodeId];
}

/** 切换移动端侧栏 Drawer 开关 */
export function toggleMobileSidebar(): void {
  if (!sidebarStore.mobileOpen) {
    // 打开时确保侧栏展开（非折叠状态）
    sidebarStore.collapsed = false;
  }
  sidebarStore.mobileOpen = !sidebarStore.mobileOpen;
}

/** 关闭移动端侧栏 Drawer */
export function closeMobileSidebar(): void {
  sidebarStore.mobileOpen = false;
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
 *  左侧 Activity Bar 常驻 48px，内容面板展开时再占据 width，
 *  详情面板展开时占据右侧（width + 24px 边距）。面板折叠或未打开时遮蔽可忽略。
 *  移动端面板由 Drawer 承载，不遮蔽画布，偏移为 0。 */
export function getVisibleCanvasBounds(
  containerWidth: number,
  containerHeight: number,
): VisibleCanvasBounds {
  // 移动端面板由 Drawer 承载，不遮蔽画布
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    return {
      left: 0,
      right: containerWidth,
      top: 0,
      bottom: containerHeight,
      width: containerWidth,
      height: containerHeight,
    };
  }
  const leftOffset = sidebarStore.fullyCollapsed
    ? 0
    : ACTIVITY_BAR_WIDTH + (sidebarStore.collapsed ? 0 : sidebarStore.width);
  const rightOffset = detailStore.collapsed || !detailStore.open ? 0 : detailStore.width;
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

// ── 终端面板状态 ──

export interface TerminalSession {
  /** 会话 ID（前端生成） */
  id: string;
  /** 初始工作目录 */
  cwd: string;
  /** shell 名称（用于显示，后端实际启动用 getDefaultShell） */
  shell: string;
  /** 显示标题 */
  title: string;
}

export const terminalStore = proxy({
  /** 面板是否打开 */
  open: false,
  /** 收起状态（不销毁会话） */
  collapsed: false,
  /** 全屏状态 */
  fullscreen: false,
  /** 移动端会话列表侧栏是否收起 */
  sidebarCollapsed: true,
  /** 面板高度（px，持久化到 localStorage） */
  height: parseInt(localStorage.getItem('lattice-terminal-height') || '300', 10),
  /** 所有终端会话 */
  sessions: [] as TerminalSession[],
  /** 当前活动会话 ID */
  activeSessionId: null as string | null,
  /** 后端 PTY 模式 */
  ptyMode: 'unknown' as 'pty' | 'spawn' | 'unknown',
  /** 拖拽中（禁用 transition 避免不跟手） */
  dragging: false,
});

let sessionCounter = 0;

/** 生成会话 ID */
function generateSessionId(): string {
  sessionCounter++;
  return `term-${Date.now()}-${sessionCounter}`;
}

/** 新建终端会话并打开面板（cwd 来自详情面板路径） */
export function openTerminal(cwd: string, shell = 'zsh', title?: string): string {
  const id = generateSessionId();
  terminalStore.sessions.push({
    id,
    cwd,
    shell,
    title: title || `${shell} #${sessionCounter}`,
  });
  terminalStore.activeSessionId = id;
  terminalStore.open = true;
  terminalStore.collapsed = false;
  return id;
}

/** 新建会话（用于 + 按钮，cwd 默认取上一会话或 /） */
export function addTerminalSession(cwd?: string): string {
  const defaultCwd = cwd || terminalStore.sessions[terminalStore.sessions.length - 1]?.cwd || '';
  return openTerminal(defaultCwd);
}

/** 关闭指定会话 */
export function closeTerminalSession(id: string): void {
  const idx = terminalStore.sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  terminalStore.sessions.splice(idx, 1);
  // 切换活动会话到相邻
  if (terminalStore.activeSessionId === id) {
    if (terminalStore.sessions.length > 0) {
      const newIdx = Math.min(idx, terminalStore.sessions.length - 1);
      terminalStore.activeSessionId = terminalStore.sessions[newIdx].id;
    } else {
      terminalStore.activeSessionId = null;
    }
  }
  // 无会话时关闭面板
  if (terminalStore.sessions.length === 0) {
    terminalStore.open = false;
  }
}

/** 切换活动会话 */
export function setActiveTerminal(id: string): void {
  terminalStore.activeSessionId = id;
}

/** 关闭终端面板 */
export function closeTerminalPanel(): void {
  terminalStore.open = false;
}

/** 从灵动岛唤出/收起终端面板（无会话时新建默认 ~ 终端） */
export function toggleTerminalPanel(): void {
  if (terminalStore.open && !terminalStore.collapsed) {
    // 面板已展开 → 收起
    terminalStore.collapsed = true;
  } else if (terminalStore.sessions.length > 0) {
    // 有会话 → 展开面板，恢复上次活动会话
    terminalStore.open = true;
    terminalStore.collapsed = false;
  } else {
    // 无会话 → 新建默认 ~ 终端（cwd 空，后端用 HOME）
    openTerminal('', 'zsh', '~');
  }
}

/** 收起/展开终端面板（不销毁会话） */
export function toggleTerminalCollapse(): void {
  terminalStore.collapsed = !terminalStore.collapsed;
}

/** 全屏切换 */
export function toggleTerminalFullscreen(): void {
  terminalStore.fullscreen = !terminalStore.fullscreen;
}

export function toggleTerminalSidebar(): void {
  terminalStore.sidebarCollapsed = !terminalStore.sidebarCollapsed;
}

/** 设置终端面板高度（含 clamping + 持久化） */
export function setTerminalHeight(height: number): void {
  const clamped = Math.max(120, Math.min(800, Math.round(height)));
  terminalStore.height = clamped;
  localStorage.setItem('lattice-terminal-height', String(clamped));
}

/** 设置 PTY 模式 */
export function setTerminalPtyMode(mode: 'pty' | 'spawn'): void {
  terminalStore.ptyMode = mode;
}
