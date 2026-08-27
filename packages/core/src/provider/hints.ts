import { createComposite } from './composite';
import { sourceLabel } from './types';

/**
 * 域对象识别提示（F4）：写操作在主数据找不到对象时，
 * 反查合并视图判断是否来自某个域——把「未找到」升级为「域只读对象」。
 * 仅错误路径调用（零正常路径开销）。
 */

export interface DomainObjectHint {
  /** 来源域标注（label(hash8)） */
  label: string;
  kind: 'task' | 'project' | 'spec';
}

/** 反查任务 id 是否来自域（本地无、域有） */
export async function findDomainTaskHint(
  username: string,
  taskId: string,
): Promise<DomainObjectHint | null> {
  try {
    const composite = await createComposite(username);
    const view = await composite.knowledgeView();
    const hit = view.tasks.find((t) => t.task.id === taskId && t.source !== 'local');
    if (!hit) return null;
    return { label: sourceLabel(hit.source, view.labels), kind: 'task' };
  } catch {
    return null;
  }
}

/** 反查项目（按 id/契约 ID）是否来自域 */
export async function findDomainProjectHint(
  username: string,
  projectId: string,
): Promise<DomainObjectHint | null> {
  try {
    const composite = await createComposite(username);
    const view = await composite.knowledgeView();
    const hit = view.projects.find(
      (p) => p.source !== 'local' && (p.project.id === projectId || p.contractId === projectId),
    );
    if (!hit) return null;
    return { label: sourceLabel(hit.source, view.labels), kind: 'project' };
  } catch {
    return null;
  }
}

/** 域只读对象的统一提示文案 */
export function domainReadOnlyMessage(hint: DomainObjectHint): string {
  const kindName = hint.kind === 'task' ? '任务' : hint.kind === 'project' ? '项目' : 'spec';
  return `未在本地找到该${kindName}，它来自域 ${hint.label}：域数据只读，本机写操作仅支持本地数据（域内容只读展示/显式导入为后续版本）`;
}
