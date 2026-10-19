/**
 * Spec 创建向导的纯逻辑（vscode-free，可单测）：
 * - 规范树节点右键入口 → 预置创建参数（scope / projectId）；
 * - 目标项目选择列表排序（当前项目置顶，其余按名称升序）。
 */

export interface SpecCreatePreset {
  scope?: 'global' | 'user' | 'project';
  projectId?: string;
}

interface SpecTreePayloadLike {
  kind?: string;
  projectId?: string;
  groupId?: string;
}

/** 规范树节点 payload → 新建 Spec 预置参数；非新建入口 payload 返回 undefined。 */
export function specCreateArgsFromTreeArg(arg: unknown): SpecCreatePreset | undefined {
  const payload = (arg as { lattice?: SpecTreePayloadLike } | undefined | null)?.lattice;
  if (!payload) return undefined;
  if (payload.kind === 'specProjectGroup' && payload.projectId) {
    return { scope: 'project', projectId: payload.projectId };
  }
  if (payload.kind === 'group') {
    if (payload.groupId === 'spec-user') return { scope: 'user' };
    if (payload.groupId === 'spec-global') return { scope: 'global' };
    // 项目级分区根：scope 预置为 project，稍后弹出可搜索的项目选择器
    if (payload.groupId === 'spec-project') return { scope: 'project' };
  }
  return undefined;
}

/** 排序：当前项目置顶，其余按名称（缺省回退 id）升序；不修改入参。 */
export function sortProjectsForSpecPick<T extends { id: string; name?: string | null }>(
  projects: readonly T[],
  currentId?: string,
): T[] {
  return [...projects].sort((a, b) => {
    if (currentId) {
      if (a.id === currentId) return -1;
      if (b.id === currentId) return 1;
    }
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}
