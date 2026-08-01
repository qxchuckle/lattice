/**
 * 集中管理的布局/尺寸 token
 *
 * 所有跨文件共享的尺寸魔法值（像素宽度、间距、节点尺寸等）统一定义于此，
 * 避免散落在 store/lib/types/agentLayout 等多处导致改一处漏多处。
 * 行内 style 中的尺寸值也应尽量引用此处的常量。
 */

// ── 主应用框架 ──

/** 左侧 Activity Bar 宽度（px，桌面端常驻，参与画布遮蔽计算） */
export const ACTIVITY_BAR_WIDTH = 48;

// ── Agent 画布 ──

/** Agent 节点默认宽度 */
export const DEFAULT_NODE_WIDTH = 340;
/** Agent 节点默认高度 */
export const DEFAULT_NODE_HEIGHT = 260;
/** Agent 节点最小宽度 */
export const MIN_NODE_WIDTH = 240;
/** Agent 节点最小高度 */
export const MIN_NODE_HEIGHT = 140;

/** Agent 面板自身侧栏宽度（区别于主应用 ACTIVITY_BAR_WIDTH） */
export const AGENT_PANEL_BAR_WIDTH = 40;

/** Agent 树布局：同层节点水平间距 */
export const NODE_GAP = 40;
/** Agent 树布局：父子层垂直间距 */
export const RANK_GAP = 60;

// ── Cytoscape 画布节点尺寸（全局图谱 dagre 布局） ──

export const CYTO_NODE_WIDTH = 220;
export const CYTO_NODE_HEIGHT = 80;

// ── 面板宽度/高度 clamping 范围 ──

export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 260;

export const DETAIL_WIDTH_MIN = 320;
export const DETAIL_WIDTH_MAX = 800;
export const DETAIL_WIDTH_DEFAULT = 420;

export const TERMINAL_HEIGHT_MIN = 120;
export const TERMINAL_HEIGHT_MAX = 800;
export const TERMINAL_HEIGHT_DEFAULT = 300;

// ── 流式块渲染分批阈值 ──

/** 块数超过此阈值时分批渲染（前 N 块立即，后续异步插入） */
export const BLOCK_BATCH_THRESHOLD = 50;
/** 首批立即渲染的块数 */
export const BLOCK_BATCH_IMMEDIATE = 30;
/** 每批异步追加的块数 */
export const BLOCK_BATCH_SIZE = 20;

// ── Block 内联样式 token（blocks/index.tsx 等行内 style 常量化） ──

export const BLOCK_STYLE = {
  text: {
    fontSize: 12,
    lineHeight: 1.5,
    margin: '4px 0',
  },
  code: {
    fontSize: 10,
    padding: 6,
    borderRadius: 4,
  },
  codeBlockPre: {
    margin: 0,
    padding: '8px 10px',
    borderRadius: 6,
    fontSize: 11,
  },
  diffPre: {
    margin: 0,
    fontSize: 10,
    lineHeight: 1.4,
    maxHeight: 150,
  },
  terminalPre: {
    margin: 0,
    fontSize: 10,
    maxHeight: 120,
  },
  errorBox: {
    margin: '4px 0',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 11,
  },
  noticeBox: {
    margin: '4px 0',
    padding: '4px 8px',
    borderRadius: 6,
    fontSize: 11,
  },
  compactionBox: {
    margin: '6px 0',
    fontSize: 10,
  },
  copyButton: {
    top: 4,
    right: 4,
    padding: '2px 6px',
    fontSize: 9,
    borderRadius: 3,
  },
  usageFooter: {
    fontSize: 9,
    padding: '4px 0',
    marginTop: 4,
  },
} as const;
