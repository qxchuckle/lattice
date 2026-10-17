/**
 * 拖拽规划（纯函数，无 vscode 依赖 → 可单测）。
 *
 * 支持的组合（其余一律不支持，防止语义混乱）：
 * - 任务 → 项目（associate：任务关联到项目）
 * - Spec → 任务（refSpec：任务引用 spec）
 */

export type EntityKind = 'task' | 'spec' | 'project';

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export type DropPlan =
  | { action: 'associate'; taskIds: string[]; projectId: string }
  | { action: 'refSpec'; taskId: string; specIds: string[] };

function uniqueIds(refs: EntityRef[]): string[] {
  return [...new Set(refs.map((ref) => ref.id))];
}

/** 依据「拖拽源实体集合 + 落点实体」规划操作；不支持时返回 null。 */
export function planDrop(
  target: EntityRef | null | undefined,
  dragged: EntityRef[],
): DropPlan | null {
  if (!target || dragged.length === 0) return null;

  const tasks = dragged.filter((ref) => ref.kind === 'task');
  const specs = dragged.filter((ref) => ref.kind === 'spec');
  const others = dragged.filter((ref) => ref.kind !== 'task' && ref.kind !== 'spec');

  // 任务 → 项目
  if (target.kind === 'project' && tasks.length > 0 && specs.length === 0 && others.length === 0) {
    const taskIds = uniqueIds(tasks).filter((id) => id !== '');
    if (taskIds.length === 0) return null;
    return { action: 'associate', taskIds, projectId: target.id };
  }

  // Spec → 任务
  if (target.kind === 'task' && specs.length > 0 && tasks.length === 0 && others.length === 0) {
    const specIds = uniqueIds(specs).filter((id) => id !== '');
    if (specIds.length === 0 || !target.id) return null;
    return { action: 'refSpec', taskId: target.id, specIds };
  }

  return null;
}

/** 是否为「可拖拽实体」（用于 handleDrag 过滤）。 */
export function isValidEntityRef(value: unknown): value is EntityRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<EntityRef>;
  return (
    (ref.kind === 'task' || ref.kind === 'spec' || ref.kind === 'project') &&
    typeof ref.id === 'string'
  );
}
