import type { ViewMode } from '../store';
import type { SearchResult } from '@qcqx/lattice-core';

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
    | 'search-result';
  children?: TreeNode[];
  entityId?: string;
  viewMode?: ViewMode;
  meta?: { desc?: string; status?: string; scope?: string };
}

/** 从搜索结果提取 ID 和视角 */
export function extractSearchResultInfo(item: SearchResult): { id: string; mode: ViewMode } {
  const meta = item.meta;
  const typeMap: Record<string, ViewMode> = {
    task: 'task',
    project: 'project',
    spec: 'spec',
    checkpoint: 'checkpoint',
    relation: 'global',
  };
  const mode = typeMap[item.type] || 'global';
  const directId =
    (meta.id as string) ||
    (meta.taskId as string) ||
    (meta.projectId as string) ||
    (meta.specId as string);
  if (directId) return { id: directId, mode };
  const filePath = (meta.filePath as string) || '';
  const taskMatch = filePath.match(/\/task\/([^/]+)\//);
  if (taskMatch) return { id: taskMatch[1], mode: 'task' };
  const projectMatch = filePath.match(/\/projects\/([^/]+)\//);
  if (projectMatch) return { id: projectMatch[1], mode: 'project' };
  const specMatch = filePath.match(/\/specs\/([^/]+)\.md$/);
  if (specMatch) return { id: specMatch[1], mode: 'spec' };
  return { id: item.title, mode };
}

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

/** 扁平化搜索结果 */
export function flattenSearch(data: SearchResult[]): TreeNode[] {
  return data.map((item: SearchResult, i: number) => {
    const { id, mode } = extractSearchResultInfo(item);
    return {
      key: `search-${i}-${id}`,
      title: item.title,
      type: 'search-result' as const,
      entityId: id,
      viewMode: mode,
      meta: { desc: item.type },
    };
  });
}

/** 筛选面板常量 */
export const nodeLegendItems = [
  { key: 'task', label: 'Task', color: '#1677FF' },
  { key: 'project', label: 'Project', color: '#722ED1' },
  { key: 'spec', label: 'Spec', color: '#13C2C2' },
  { key: 'checkpoint', label: 'CP', color: '#FAAD14' },
];

export const edgeLegendItems = [
  { key: 'task', label: 'task', desc: 'Project → Task', color: '#8C8C8C' },
  { key: 'parent', label: 'parent', desc: 'Task → Task', color: '#1677FF' },
  { key: 'spec', label: 'spec', desc: 'Project → Spec', color: '#13C2C2' },
  { key: 'ref-spec', label: 'ref-spec', desc: 'Task → Spec', color: '#13C2C2' },
  { key: 'depends_on', label: 'depends-on', desc: 'Project → Project', color: '#FA541C' },
  { key: 'forked_from', label: 'forked-from', desc: 'Project → Project', color: '#722ED1' },
  { key: 'belongs-to', label: 'belongs-to', desc: 'Task → Project', color: '#52C41A' },
  { key: 'checkpoint', label: 'checkpoint', desc: 'Task → CP', color: '#FAAD14' },
];

export const focusDepthOptions = [
  { label: '全部', value: 0 },
  { label: '1跳', value: 1 },
  { label: '2跳', value: 2 },
  { label: '3跳', value: 3 },
];
