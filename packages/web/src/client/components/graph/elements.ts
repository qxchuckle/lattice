import type cytoscape from 'cytoscape';
import { getEntityColor, getTaskStatusColor } from '../../lib';
import type { LatticeNode, LatticeEdge, LatticeNodeData } from '../../types/graph';

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

/** 节点标签：单行多标签（[类型][状态] 标题），多用户模式追加用户名 */
export function getNodeLabel(data: LatticeNodeData): string {
  // 类型标签
  const typeTag = (() => {
    switch (data.entityType) {
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
    switch (data.entityType) {
      case 'task':
        return data.title || data.taskId || 'Task';
      case 'project':
        return data.name || data.projectId || 'Project';
      case 'spec':
        return data.title || data.specId || 'Spec';
      default:
        return 'Node';
    }
  })();

  // 属性标签（状态/类型/scope/docType），不同种类用不同符号样式
  const attrTag = (() => {
    switch (data.entityType) {
      case 'task': {
        const status = data.status || 'planning';
        return `[${TASK_STATUS_LABEL[status] ?? status}]`;
      }
      case 'spec': {
        const scope = data.scope || '';
        const label = SPEC_SCOPE_LABEL[scope] ?? scope;
        return label ? `[${label}]` : '';
      }
      case 'project':
        return data.hasGit ? '[git]' : '';
      default:
        return '';
    }
  })();

  // 多用户模式：追加用户名后缀
  const username = data.username;
  const userTag = username ? `\n@${username}` : '';

  return attrTag ? `${typeTag}${attrTag}\n${title}${userTag}` : `${typeTag}\n${title}${userTag}`;
}

/** 从 spec filePath 提取 projectId */
function extractSpecProjectId(filePath: string): string | null {
  const match = filePath.match(/\/projects\/([^/]+)\//);
  return match ? match[1] : null;
}

/** 转换为 Cytoscape 元素，按可见类型过滤 */
export function toElements(
  nodes: LatticeNode[],
  edges: LatticeEdge[],
  visibleTypes: Record<string, boolean>,
  visibleEdgeTypes?: Record<string, boolean>,
  taskStatusFilter?: readonly string[],
  specScopeFilter?: readonly string[],
  projectFilter?: readonly string[],
  canvasKeyword?: string,
): cytoscape.ElementDefinition[] {
  const visibleSet = new Set(
    Object.entries(visibleTypes)
      .filter(([, v]) => v)
      .map(([k]) => k),
  );
  const visibleNodeIds = new Set<string>();
  const cyNodes: cytoscape.ElementDefinition[] = [];

  const hasProjectFilter = projectFilter && projectFilter.length > 0;
  const projectFilterSet = hasProjectFilter ? new Set(projectFilter!) : null;
  const keyword = canvasKeyword?.toLowerCase().trim() || '';

  // 关键字匹配辅助
  const matchesKeyword = (text: string): boolean => {
    if (!keyword) return true;
    return text.toLowerCase().includes(keyword);
  };

  nodes.forEach((n) => {
    const data = n.data;
    const entityType = data.entityType;
    if (!visibleSet.has(entityType)) return;

    // 任务状态筛选
    if (entityType === 'task' && taskStatusFilter && taskStatusFilter.length > 0) {
      const status = data.status || 'planning';
      if (!taskStatusFilter.includes(status)) return;
    }

    // Spec 范围筛选
    if (entityType === 'spec' && specScopeFilter && specScopeFilter.length > 0) {
      const scope = data.scope || '';
      if (!specScopeFilter.includes(scope)) return;
    }

    // 项目筛选
    if (hasProjectFilter) {
      if (entityType === 'project') {
        const projectId = data.projectId || '';
        if (!projectFilterSet!.has(projectId)) return;
      } else if (entityType === 'task') {
        const taskProjectIds = data.projectIds || [];
        if (!taskProjectIds.some((pid) => projectFilterSet!.has(pid))) return;
      } else if (entityType === 'spec') {
        if (data.scope === 'project') {
          // 优先使用已解析的 projectId（多 ID 机制下已 resolve 为 primary ID）
          const specProjectId = data.projectId || extractSpecProjectId(data.filePath || '');
          if (!specProjectId || !projectFilterSet!.has(specProjectId)) return;
        }
        // 全局级/用户级 spec 不受项目筛选影响
      }
    }

    // 关键字筛选
    if (keyword) {
      if (entityType === 'task') {
        const title = data.title || '';
        if (!matchesKeyword(title)) return;
      } else if (entityType === 'project') {
        const name = data.name || '';
        if (!matchesKeyword(name)) return;
      } else if (entityType === 'spec') {
        const title = data.title || '';
        if (!matchesKeyword(title)) return;
      }
    }

    visibleNodeIds.add(n.id);
    const label = getNodeLabel(data);
    const color =
      entityType === 'task'
        ? getTaskStatusColor(data.status || 'planning')
        : getEntityColor(entityType);
    cyNodes.push({ data: { ...data, id: n.id, label, color } });
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
      const label = String(e.label || e.data?.label || '').replace(/-/g, '_');
      return edgeVisibleSet.has(label);
    })
    .map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label || e.data?.label || '',
      },
    }));

  return [...cyNodes, ...cyEdges];
}
