import type cytoscape from 'cytoscape';
import { getEntityColor, getTaskStatusColor } from '../../lib';
import type { LatticeNode, LatticeEdge } from '../../types/graph';

/** 任务状态中文标签 */
const TASK_STATUS_LABEL: Record<string, string> = {
  in_progress: '进行中',
  completed: '已完成',
  archived: '已归档',
  planning: '规划中',
};

/** spec scope 中文标签 */
const SPEC_SCOPE_LABEL: Record<string, string> = {
  global: '全局',
  user: '用户级',
  project: '项目级',
};

/** 节点标签：单行多标签（[类型][状态] 标题） */
export function getNodeLabel(data: Record<string, unknown>): string {
  const type = data.entityType as string;

  // 类型标签
  const typeTag = (() => {
    switch (type) {
      case 'task':
        return '[Task]';
      case 'project':
        return '[Project]';
      case 'spec':
        return '[Spec]';
      default:
        return '[Node]';
    }
  })();

  // 标题
  const title = (() => {
    switch (type) {
      case 'task':
        return (data.title as string) || (data.taskId as string) || 'Task';
      case 'project':
        return (data.name as string) || (data.projectId as string) || 'Project';
      case 'spec':
        return (data.title as string) || (data.specId as string) || 'Spec';
      default:
        return 'Node';
    }
  })();

  // 属性标签（状态/类型/scope/docType），不同种类用不同符号样式
  const attrTag = (() => {
    switch (type) {
      case 'task': {
        const status = (data.status as string) || 'planning';
        return `[${TASK_STATUS_LABEL[status] ?? status}]`;
      }
      case 'spec': {
        const scope = (data.scope as string) || '';
        const label = SPEC_SCOPE_LABEL[scope] ?? scope;
        return label ? `[${label}]` : '';
      }
      case 'project':
        return data.hasGit ? '[git]' : '';
      default:
        return '';
    }
  })();

  return attrTag ? `${typeTag}${attrTag}\n${title}` : `${typeTag}\n${title}`;
}

/** 转换为 Cytoscape 元素，按可见类型过滤 */
export function toElements(
  nodes: LatticeNode[],
  edges: LatticeEdge[],
  visibleTypes: Record<string, boolean>,
  visibleEdgeTypes?: Record<string, boolean>,
  taskStatusFilter?: readonly string[],
  specScopeFilter?: readonly string[],
): cytoscape.ElementDefinition[] {
  const visibleSet = new Set(
    Object.entries(visibleTypes)
      .filter(([, v]) => v)
      .map(([k]) => k),
  );
  const visibleNodeIds = new Set<string>();
  const cyNodes: cytoscape.ElementDefinition[] = [];

  nodes.forEach((n) => {
    const data = n.data as Record<string, unknown>;
    const entityType = data.entityType as string;
    if (!visibleSet.has(entityType)) return;

    // 任务状态筛选
    if (entityType === 'task' && taskStatusFilter && taskStatusFilter.length > 0) {
      const status = (data.status as string) || 'planning';
      if (!taskStatusFilter.includes(status)) return;
    }

    // Spec 范围筛选
    if (entityType === 'spec' && specScopeFilter && specScopeFilter.length > 0) {
      const scope = (data.scope as string) || '';
      if (!specScopeFilter.includes(scope)) return;
    }

    visibleNodeIds.add(n.id);
    const label = getNodeLabel(data);
    let color = '#8C8C8C';
    if (entityType === 'task') {
      color = getTaskStatusColor((data.status as string) || 'planning');
    } else {
      color = getEntityColor(entityType);
    }
    cyNodes.push({ data: { id: n.id, label, entityType, color, ...data } });
  });

  const edgeVisibleSet = visibleEdgeTypes
    ? new Set(
        Object.entries(visibleEdgeTypes)
          .filter(([, v]) => v)
          .map(([k]) => k),
      )
    : null;

  const cyEdges: cytoscape.ElementDefinition[] = edges
    .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
    .filter((e) => {
      if (!edgeVisibleSet) return true;
      const label = String(e.label || (e.data?.label as string) || '').replace(/-/g, '_');
      return edgeVisibleSet.has(label);
    })
    .map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label || (e.data?.label as string) || '',
      },
    }));

  return [...cyNodes, ...cyEdges];
}
