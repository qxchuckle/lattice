import type cytoscape from 'cytoscape';
import { getEntityColor, getTaskStatusColor, getCheckpointTypeColor } from '../../lib';
import type { LatticeNode, LatticeEdge } from '../../types/graph';

/** 节点标签：带类型 tag */
export function getNodeLabel(data: Record<string, unknown>): string {
  const type = data.entityType as string;
  const typeTag = (() => {
    switch (type) {
      case 'task':
        return 'Task';
      case 'project':
        return 'Project';
      case 'spec':
        return 'Spec';
      case 'checkpoint':
        return 'CP';
      case 'document':
        return 'Doc';
      default:
        return '';
    }
  })();
  const title = (() => {
    switch (type) {
      case 'task':
        return (data.title as string) || (data.taskId as string) || 'Task';
      case 'project':
        return (data.name as string) || (data.projectId as string) || 'Project';
      case 'spec':
        return (data.title as string) || (data.specId as string) || 'Spec';
      case 'checkpoint':
        return (data.title as string) || (data.checkpointId as string) || 'CP';
      case 'document':
        return (data.title as string) || (data.docType as string) || 'Doc';
      default:
        return 'Node';
    }
  })();
  const scopeSuffix = (() => {
    if (type !== 'spec') return '';
    const scope = data.scope as string;
    if (scope === 'global') return ' [全局]';
    if (scope === 'user') return ' [用户]';
    if (scope === 'project') return ' [项目]';
    return '';
  })();
  return `${typeTag}  ${title}${scopeSuffix}`;
}

/** 转换为 Cytoscape 元素，按可见类型过滤 */
export function toElements(
  nodes: LatticeNode[],
  edges: LatticeEdge[],
  visibleTypes: Record<string, boolean>,
  visibleEdgeTypes?: Record<string, boolean>,
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
    visibleNodeIds.add(n.id);
    const label = getNodeLabel(data);
    let color = '#8C8C8C';
    if (entityType === 'task') {
      color = getTaskStatusColor((data.status as string) || 'planning');
    } else if (entityType === 'checkpoint') {
      color = getCheckpointTypeColor((data.checkpointType as string) || 'note');
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
