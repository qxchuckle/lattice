import * as vscode from 'vscode';
import type { SearchRow } from '../cli/types';
import { LatticeItemPayload, LatticeTreeItem } from './items';
import type { ProjectsProvider } from './projects';
import type { SpecsProvider } from './specs';
import type { TasksProvider } from './tasks';

/** reveal 目标：跨视图的实体定位（task → 任务视图；spec → 规范视图；project → 项目视图）。 */
export interface RevealEntity {
  kind: 'task' | 'spec' | 'project';
  id: string;
}

export interface RevealSlot {
  provider: TasksProvider | SpecsProvider | ProjectsProvider;
  view: vscode.TreeView<LatticeTreeItem>;
}

export interface RevealDeps {
  tasks: RevealSlot;
  specs: RevealSlot;
  projects: RevealSlot;
}

/** 在侧栏定位实体：打开容器 → 展开祖先 → 选中并聚焦（节点不在当前视图范围时返回 false）。 */
export class RevealService {
  constructor(private readonly deps: RevealDeps) {}

  async reveal(target: RevealEntity): Promise<boolean> {
    const slot =
      this.deps[target.kind === 'task' ? 'tasks' : target.kind === 'spec' ? 'specs' : 'projects'];
    // 先确保 Lattice 容器可见（否则 reveal 在隐藏面板中不可见）
    await vscode.commands.executeCommand('workbench.view.extension.lattice');
    const element = (await slot.provider.resolveRevealElement(target.id)) as LatticeTreeItem | null;
    if (!element) return false;
    await slot.view.reveal(element, { select: true, focus: true, expand: true });
    return true;
  }
}

/** 搜索结果行 → reveal 目标。 */
function targetFromSearchRow(row: SearchRow): RevealEntity | null {
  switch (row.type) {
    case 'task':
    case 'prd':
    case 'design':
    case 'checkpoint':
      return row.taskId ? { kind: 'task', id: row.taskId } : null;
    case 'spec':
      // specId 缺失时回退 filePath 反查（快照索引按 id 检索）
      return row.specId ? { kind: 'spec', id: row.specId } : null;
    case 'project':
    case 'relation':
      return row.projectIds[0] ? { kind: 'project', id: row.projectIds[0] } : null;
    default:
      return null;
  }
}

/** 树项 payload → reveal 目标（任务相关节点定位到任务，spec 定位到规范）。 */
export function targetFromPayload(payload: LatticeItemPayload): RevealEntity | null {
  switch (payload.kind) {
    case 'task':
    case 'checkpoint':
    case 'progressAll':
    case 'taskDoc':
    case 'taskRefsGroup':
    case 'taskSubtasksGroup':
    case 'taskProjectsGroup':
      return { kind: 'task', id: payload.taskId };
    case 'refSpecLeaf':
      return payload.specId ? { kind: 'spec', id: payload.specId } : null;
    case 'spec':
      return { kind: 'spec', id: payload.specId };
    case 'conflict':
      return payload.specId ? { kind: 'spec', id: payload.specId } : null;
    case 'project':
      return { kind: 'project', id: payload.projectId };
    case 'currentProject':
      return payload.projectId ? { kind: 'project', id: payload.projectId } : null;
    case 'specProjectGroup':
      return { kind: 'project', id: payload.projectId };
    case 'relation':
      return payload.projectId ? { kind: 'project', id: payload.projectId } : null;
    case 'searchResult':
      return targetFromSearchRow(payload.row);
    default:
      return null;
  }
}

/**
 * 命令参数归一化：
 * - 树项（含 .lattice payload）→ payload 映射
 * - 搜索结果行 / 纯对象 {kind,id} / {taskId|specId|projectId} → 目标
 */
export function resolveRevealTarget(arg: unknown): RevealEntity | null {
  if (!arg || typeof arg !== 'object') return null;
  const obj = arg as Record<string, unknown>;
  if (obj.lattice && typeof obj.lattice === 'object') {
    return targetFromPayload(obj.lattice as LatticeItemPayload);
  }
  if (
    (obj.kind === 'task' || obj.kind === 'spec' || obj.kind === 'project') &&
    typeof obj.id === 'string' &&
    obj.id
  ) {
    return { kind: obj.kind, id: obj.id };
  }
  if (typeof obj.taskId === 'string' && obj.taskId) return { kind: 'task', id: obj.taskId };
  if (typeof obj.specId === 'string' && obj.specId) return { kind: 'spec', id: obj.specId };
  if (typeof obj.projectId === 'string' && obj.projectId)
    return { kind: 'project', id: obj.projectId };
  return null;
}
