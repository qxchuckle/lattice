/**
 * Workbench Store — 对话树 + Agent 会话状态管理
 */
import { proxy } from 'valtio';
import type { ConversationNode, ConversationBranch, ConversationTree, AgentEvent } from '@qcqx/lattice-agent';

// ── 对话树状态 ──

export const workbenchStore = proxy({
  /** 当前对话树 */
  tree: null as ConversationTree | null,
  /** 所有节点 */
  nodes: [] as ConversationNode[],
  /** 当前 HEAD 节点 ID */
  headNodeId: null as string | null,
  /** 选中的节点 ID */
  selectedNodeId: null as string | null,
  /** 框选的节点 IDs */
  multiSelectedIds: [] as string[],

  // ── Agent 会话 ──
  sessionId: null as string | null,
  treeId: null as string | null,
  agentStatus: 'idle' as string,
  /** 当前流式响应文本 */
  streamingText: '',
  /** 当前流式事件 */
  streamingEvents: [] as AgentEvent[],

  // ── UI 状态 ──
  layoutMode: 'tree' as string,
  inputMessage: '',
  /** / 命令菜单是否打开 */
  commandMenuOpen: false,
  commandFilter: '',
  /** 分叉对话框 */
  forkDialogOpen: false,
  forkDialogNodeId: null as string | null,
  /** 合并对话框 */
  mergeDialogOpen: false,
  mergeDialogBranchId: null as string | null,

  // ── 编辑器状态 ──
  /** 打开的文件 tabs */
  editorTabs: [] as { path: string; language: string; isDirty: boolean }[],
  /** 当前激活 tab 索引 */
  activeTabIndex: -1,
  /** 文件树数据 */
  fileTree: [] as { name: string; path: string; type: 'file' | 'directory'; children?: unknown[] }[],
  /** workspace 根路径列表 */
  workspaceRoots: [] as string[],
  /** 当前任务 ID（驱动 workspace） */
  activeTaskId: null as string | null,
  /** diff 视图 */
  diffView: null as { path: string; original: string; modified: string; nodeId: string } | null,

  // ── WebSocket ──
  wsConnected: false,
});

// ── Actions ──

export function setTreeData(tree: ConversationTree, nodes: ConversationNode[]) {
  workbenchStore.tree = tree;
  workbenchStore.nodes = nodes;
  workbenchStore.headNodeId = tree.headNodeId;
}

export function selectNode(nodeId: string | null) {
  workbenchStore.selectedNodeId = nodeId;
  workbenchStore.multiSelectedIds = [];
}

export function setMultiSelect(ids: string[]) {
  workbenchStore.multiSelectedIds = ids;
  workbenchStore.selectedNodeId = null;
}

export function setStreaming(text: string, events: AgentEvent[]) {
  workbenchStore.streamingText = text;
  workbenchStore.streamingEvents = events;
}

export function resetStreaming() {
  workbenchStore.streamingText = '';
  workbenchStore.streamingEvents = [];
}

export function openForkDialog(nodeId: string) {
  workbenchStore.forkDialogOpen = true;
  workbenchStore.forkDialogNodeId = nodeId;
}

export function closeForkDialog() {
  workbenchStore.forkDialogOpen = false;
  workbenchStore.forkDialogNodeId = null;
}

export function openMergeDialog(branchId: string) {
  workbenchStore.mergeDialogOpen = true;
  workbenchStore.mergeDialogBranchId = branchId;
}

export function closeMergeDialog() {
  workbenchStore.mergeDialogOpen = false;
  workbenchStore.mergeDialogBranchId = null;
}

// ── Editor Actions ──

export function openFile(path: string, language?: string) {
  const existing = workbenchStore.editorTabs.findIndex((t) => t.path === path);
  if (existing >= 0) {
    workbenchStore.activeTabIndex = existing;
    return;
  }
  const lang = language ?? path.split('.').pop() ?? 'plaintext';
  workbenchStore.editorTabs.push({ path, language: lang, isDirty: false });
  workbenchStore.activeTabIndex = workbenchStore.editorTabs.length - 1;
}

export function closeTab(index: number) {
  workbenchStore.editorTabs.splice(index, 1);
  if (workbenchStore.activeTabIndex >= workbenchStore.editorTabs.length) {
    workbenchStore.activeTabIndex = workbenchStore.editorTabs.length - 1;
  }
}

export function setActiveTab(index: number) {
  workbenchStore.activeTabIndex = index;
}

export function markDirty(path: string, dirty: boolean) {
  const tab = workbenchStore.editorTabs.find((t) => t.path === path);
  if (tab) tab.isDirty = dirty;
}

export function setFileTree(tree: { name: string; path: string; type: 'file' | 'directory'; children?: unknown[] }[]) {
  workbenchStore.fileTree = tree;
}

export function setWorkspaceRoots(roots: string[]) {
  workbenchStore.workspaceRoots = roots;
}

export function showDiff(path: string, original: string, modified: string, nodeId: string) {
  workbenchStore.diffView = { path, original, modified, nodeId };
}

export function closeDiff() {
  workbenchStore.diffView = null;
}
