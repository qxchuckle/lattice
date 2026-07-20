import type { ViewMode } from '../../store';
import type { SearchFilters } from '../../store';
import type { SearchResult, TaskMeta, ParsedSpec } from '@qcqx/lattice-core';

/** 树节点类型 */
export interface TreeNode {
  key: string;
  title: string;
  type:
    | 'spec-root'
    | 'project-root'
    | 'task-root'
    | 'spec-scope'
    | 'spec-item'
    | 'project-item'
    | 'task-item'
    | 'search-result'
    | 'search-section'
    | 'browser-match-section';
  children?: TreeNode[];
  entityId?: string;
  viewMode?: ViewMode;
  meta?: { desc?: string; status?: string; scope?: string };
}

// ── Spec scope 辅助 ──

/** 从 filePath 推断 spec scope 值（global / user / project） */
export function inferSpecScope(filePath: string): string {
  if (filePath.includes('/projects/') && filePath.includes('/specs/')) return 'project';
  if (filePath.includes('/specs/') || filePath.includes('/spec/')) {
    if (!filePath.includes('/user/')) return 'global';
    return 'user';
  }
  return '';
}

/** scope 值 → 中文标签 */
export function scopeValueToLabel(value: string): string {
  if (value === 'global') return '全局级';
  if (value === 'user') return '用户级';
  if (value === 'project') return '项目级';
  return '';
}

/** scope 中文标签 → 值 */
export function scopeLabelToValue(scope?: string): string {
  if (scope === '全局级') return 'global';
  if (scope === '用户级') return 'user';
  if (scope === '项目级') return 'project';
  return '';
}

// ── 搜索结果信息提取 ──

/** 从搜索结果提取 ID 和视角 */
export function extractSearchResultInfo(
  item: SearchResult,
  specIdByPath?: Map<string, string>,
): { id: string; mode: ViewMode } {
  const meta = item.meta;
  const typeMap: Record<string, ViewMode> = {
    task: 'task',
    project: 'project',
    spec: 'spec',
    relation: 'global',
  };
  const mode = typeMap[item.type] || 'global';
  // 优先从 meta 取直接 ID
  const directId = (meta.id as string) || meta.taskId || (meta.projectId as string) || meta.specId;
  if (directId) return { id: directId, mode };
  const filePath = meta.filePath || '';
  // spec: 优先从 specIdByPath 查找（frontmatter.id || fileName），与侧栏树 spec-item entityId 规则一致
  if (item.type === 'spec' && specIdByPath) {
    const specId = specIdByPath.get(filePath);
    if (specId) return { id: specId, mode: 'spec' };
  }
  // project: meta.projectIds 是数组，取第一个（project 搜索结果的 filePath 是源码路径，不匹配 lattice 路径格式）
  // 仅 project 类型走此分支；task 类型虽携带 projectIds（关联项目），但应从 filePath 提取 taskId
  const projectIds = meta.projectIds;
  if (item.type === 'project' && projectIds && projectIds.length > 0)
    return { id: projectIds[0], mode };
  // 从 filePath 提取
  const taskMatch = filePath.match(/\/task\/([^/]+)\//);
  if (taskMatch) return { id: taskMatch[1], mode: 'task' };
  // spec fallback: 从 filePath 提取文件名（含 .md 后缀，与 fileName 一致），兼容 /spec/ 单数与 /specs/ 复数
  const specMatch = filePath.match(/\/specs?\/([^/]+\.md)$/);
  if (specMatch) return { id: specMatch[1], mode: 'spec' };
  return { id: item.title, mode };
}

// ── 树过滤 ──

/** 递归过滤树（搜索模式） */
export function filterTree(nodes: TreeNode[], keyword: string): TreeNode[] {
  if (!keyword) return nodes;
  const lower = keyword.toLowerCase();
  const result: TreeNode[] = [];
  for (const node of nodes) {
    const titleMatch = node.title.toLowerCase().includes(lower);
    const filteredChildren = node.children ? filterTree(node.children, keyword) : [];
    if (titleMatch || filteredChildren.length > 0) {
      result.push({
        ...node,
        children: filteredChildren.length > 0 ? filteredChildren : node.children,
      });
    }
  }
  return result;
}

/** 更新容器节点标题中的计数 */
function updateTitleCount(title: string, children: TreeNode[] | undefined): string {
  if (!children) return title;
  const match = title.match(/^(.+?)\s*\((\d+)\)$/);
  if (!match) return title;
  return `${match[1]} (${children.length})`;
}

/**
 * 递归过滤树（关键词 + 筛选条件）
 * - 顶层根节点按 type 筛选：任务/Spec 类型同时保留 project-root
 * - 非顶层叶子节点按 type 过滤（task 过滤 spec-item，spec 过滤 task-item）
 * - task-item 按 taskStatus 筛选
 * - spec-item 按 specScope 筛选
 * - 有筛选条件时更新容器标题计数
 * - 有关键词时保持原 filterTree 语义（标题匹配或子节点匹配）
 * - 无关键词时容器节点仅在有匹配子节点时保留
 */
export function filterTreeByKeywordAndFilters(
  nodes: TreeNode[],
  keyword: string,
  filters: SearchFilters,
  isTopLevel = true,
): TreeNode[] {
  const hasKeyword = !!keyword;
  const hasTypeFilter = filters.type !== 'all';
  const hasAnyFilter =
    hasTypeFilter || filters.taskStatus.length > 0 || filters.specScope.length > 0;

  if (!hasKeyword && !hasAnyFilter) return nodes;

  const lower = keyword.toLowerCase();
  const result: TreeNode[] = [];

  for (const node of nodes) {
    // 顶层根节点：类型筛选（任务/Spec 同时保留 project-root）
    if (isTopLevel && hasTypeFilter) {
      const typeMatch =
        (filters.type === 'task' && (node.type === 'task-root' || node.type === 'project-root')) ||
        (filters.type === 'project' && node.type === 'project-root') ||
        (filters.type === 'spec' && (node.type === 'spec-root' || node.type === 'project-root'));
      if (!typeMatch) continue;
    }

    // 非顶层叶子节点：类型筛选
    if (!isTopLevel && hasTypeFilter) {
      if (filters.type === 'task' && node.type === 'spec-item') continue;
      if (filters.type === 'spec' && node.type === 'task-item') continue;
    }

    // 任务状态筛选（仅 task-item）
    if (filters.taskStatus.length > 0 && node.type === 'task-item') {
      const status = node.meta?.status;
      if (!status || !filters.taskStatus.includes(status)) continue;
    }

    // Spec 范围筛选（仅 spec-item）
    if (filters.specScope.length > 0 && node.type === 'spec-item') {
      const scopeValue = scopeLabelToValue(node.meta?.scope);
      if (!scopeValue || !filters.specScope.includes(scopeValue)) continue;
    }

    // 递归过滤子节点
    const filteredChildren = node.children
      ? filterTreeByKeywordAndFilters(node.children, keyword, filters, false)
      : [];

    const titleMatch = !hasKeyword || node.title.toLowerCase().includes(lower);
    const hasChildren = !!node.children;

    if (hasKeyword && !hasAnyFilter) {
      // 纯关键词搜索：保持原 filterTree 逻辑
      if (titleMatch || filteredChildren.length > 0) {
        result.push({
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
        });
      }
    } else if (hasKeyword && hasAnyFilter) {
      // 关键词 + 筛选：总是用过滤后的子节点 + 更新计数
      if (titleMatch || filteredChildren.length > 0) {
        result.push({
          ...node,
          title: updateTitleCount(
            node.title,
            filteredChildren.length > 0 ? filteredChildren : undefined,
          ),
          children: filteredChildren.length > 0 ? filteredChildren : undefined,
        });
      }
    } else {
      // 纯筛选（无关键词）：容器需要子节点不为空 + 更新计数
      if (!hasChildren || filteredChildren.length > 0) {
        result.push({
          ...node,
          title: updateTitleCount(node.title, hasChildren ? filteredChildren : undefined),
          children: hasChildren ? filteredChildren : undefined,
        });
      }
    }
  }
  return result;
}

// ── 搜索结果扁平化（带筛选 + 补全） ──

/**
 * 扁平化搜索结果
 * @param data 搜索结果数组
 * @param filters 筛选条件（可选）
 * @param tasks 全量任务列表（可选，用于补全 task status）
 */
export function flattenSearch(
  data: SearchResult[],
  filters?: SearchFilters,
  tasks?: TaskMeta[],
  specs?: ParsedSpec[],
): TreeNode[] {
  // 构建 filePath → specId 映射（frontmatter.id || fileName），与侧栏树 spec-item entityId 一致
  const specIdByPath = new Map<string, string>();
  for (const s of specs || []) {
    specIdByPath.set(s.filePath, s.frontmatter.id || s.fileName);
  }

  const items = data
    .map((item: SearchResult, i: number) => {
      const { id, mode } = extractSearchResultInfo(item, specIdByPath);
      const meta: TreeNode['meta'] = { desc: item.type };

      // 补全 task status
      if (item.type === 'task' && tasks) {
        const task = tasks.find((t) => t.id === id);
        if (task) meta.status = task.status;
      }

      // 补全 spec scope
      if (item.type === 'spec') {
        const filePath = item.meta.filePath || '';
        meta.scope = scopeValueToLabel(inferSpecScope(filePath));
      }

      return {
        key: `search-${i}-${id}`,
        title: item.title,
        type: 'search-result' as const,
        entityId: id,
        viewMode: mode,
        meta,
      };
    })
    .filter((node) => {
      if (!filters) return true;
      // 任务状态筛选
      if (filters.taskStatus.length > 0 && node.meta?.desc === 'task') {
        return !!node.meta?.status && filters.taskStatus.includes(node.meta.status);
      }
      // Spec 范围筛选
      if (filters.specScope.length > 0 && node.meta?.desc === 'spec') {
        const scopeValue = scopeLabelToValue(node.meta?.scope);
        return !!scopeValue && filters.specScope.includes(scopeValue);
      }
      return true;
    });

  // 按类型分组，返回可折叠树节点
  const groups: { label: string; typePrefix: string; types: string[] }[] = [
    { label: '项目', typePrefix: 'project', types: ['project'] },
    { label: 'Spec', typePrefix: 'spec', types: ['spec'] },
    { label: '任务', typePrefix: 'task', types: ['task', 'design', 'checkpoint'] },
    { label: '关联关系', typePrefix: 'relation', types: ['relation'] },
  ];

  const result: TreeNode[] = [];
  for (const group of groups) {
    const children = items.filter((n) => group.types.includes(n.meta?.desc || ''));
    if (children.length === 0) continue;
    result.push({
      key: `search-group-${group.typePrefix}`,
      title: `${group.label}（${children.length}）`,
      type: `${group.typePrefix}-root` as TreeNode['type'],
      children,
    });
  }
  return result;
}

// ── 筛选面板常量 ──

export const nodeLegendItems = [
  { key: 'task', label: 'Task', color: '#1677FF' },
  { key: 'project', label: 'Project', color: '#FA8C16' },
  { key: 'spec', label: 'Spec', color: '#13C2C2' },
];

/** 边类型分组 */
export type EdgeGroupKey = 'task' | 'spec' | 'project';

export interface EdgeLegendItem {
  key: string;
  label: string;
  desc: string;
  color: string;
  group: EdgeGroupKey;
}

export const edgeLegendItems: EdgeLegendItem[] = [
  // 任务关系
  { key: 'task', label: '项目→任务', desc: 'Project → Task', color: '#8C8C8C', group: 'task' },
  { key: 'parent', label: '任务→任务', desc: 'Task → Task', color: '#1677FF', group: 'task' },
  {
    key: 'belongs_to',
    label: '任务→项目',
    desc: 'Task → Project',
    color: '#52C41A',
    group: 'task',
  },
  {
    key: 'scope',
    label: '项目→任务(范围)',
    desc: 'Project → Task (scopePath)',
    color: '#FA8C16',
    group: 'task',
  },
  // Spec 关系
  { key: 'spec', label: '项目→Spec', desc: 'Project → Spec', color: '#13C2C2', group: 'spec' },
  { key: 'ref_spec', label: '任务→Spec', desc: 'Task → Spec', color: '#13C2C2', group: 'spec' },
  {
    key: 'overrides',
    label: 'Spec分层',
    desc: 'Spec → Spec (layering)',
    color: '#FA8C16',
    group: 'spec',
  },
  {
    key: 'semantic',
    label: '任务→Spec(RAG)',
    desc: 'Task → Spec (RAG)',
    color: '#EB2F96',
    group: 'spec',
  },
  // 项目关系
  {
    key: 'depends_on',
    label: '依赖',
    desc: 'Project → Project',
    color: '#FA541C',
    group: 'project',
  },
  {
    key: 'forked_from',
    label: 'Fork',
    desc: 'Project → Project',
    color: '#722ED1',
    group: 'project',
  },
  {
    key: 'shares_component',
    label: '共享组件',
    desc: 'Project → Project',
    color: '#13C2C2',
    group: 'project',
  },
  {
    key: 'nested_in',
    label: '嵌套',
    desc: 'Project → Project',
    color: '#722ED1',
    group: 'project',
  },
  { key: 'related', label: '关联', desc: 'Project → Project', color: '#8C8C8C', group: 'project' },
  {
    key: 'cross_user',
    label: '跨用户',
    desc: '虚拟合并 (cross-user)',
    color: '#722ED1',
    group: 'project',
  },
];

export const edgeGroups: { key: EdgeGroupKey; label: string; items: EdgeLegendItem[] }[] = [
  { key: 'task', label: '任务关系', items: edgeLegendItems.filter((i) => i.group === 'task') },
  { key: 'spec', label: 'Spec 关系', items: edgeLegendItems.filter((i) => i.group === 'spec') },
  {
    key: 'project',
    label: '项目关系',
    items: edgeLegendItems.filter((i) => i.group === 'project'),
  },
];

/** 画布快捷预设 */
export interface CanvasPreset {
  label: string;
  nodes: Record<string, boolean>;
  edges: Record<string, boolean>;
}

export const canvasPresets: CanvasPreset[] = [
  {
    label: '全部',
    nodes: { task: true, project: true, spec: true },
    edges: Object.fromEntries(edgeLegendItems.map((i) => [i.key, true])),
  },
  {
    label: '任务',
    nodes: { task: true, project: true, spec: false },
    edges: Object.fromEntries(edgeLegendItems.map((i) => [i.key, i.group === 'task'])),
  },
  {
    label: '项目',
    nodes: { task: false, project: true, spec: false },
    edges: Object.fromEntries(edgeLegendItems.map((i) => [i.key, i.group === 'project'])),
  },
  {
    label: 'Spec',
    nodes: { task: false, project: true, spec: true },
    edges: Object.fromEntries(edgeLegendItems.map((i) => [i.key, i.group === 'spec'])),
  },
];

export const focusDepthOptions = [
  { label: '全部', value: 0 },
  { label: '1跳', value: 1 },
  { label: '2跳', value: 2 },
  { label: '3跳', value: 3 },
];

/** 搜索 Tab 类型筛选选项 */
export const searchTypeOptions: { label: string; value: 'all' | 'task' | 'project' | 'spec' }[] = [
  { label: '全部', value: 'all' },
  { label: '任务', value: 'task' },
  { label: '项目', value: 'project' },
  { label: 'Spec', value: 'spec' },
];

/** 任务状态筛选选项 */
export const taskStatusOptions: { label: string; value: string }[] = [
  { label: '进行中', value: 'in_progress' },
  { label: '已完成', value: 'completed' },
  { label: '已归档', value: 'archived' },
];

/** Spec 范围筛选选项 */
export const specScopeOptions: { label: string; value: string }[] = [
  { label: '全局级', value: 'global' },
  { label: '用户级', value: 'user' },
  { label: '项目级', value: 'project' },
];
