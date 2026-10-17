import * as vscode from 'vscode';
import { showDeduped } from '../commands/shared';
import { LatticeDataService } from '../data/service';
import { errorLog } from '../logging';
import { SnapshotStore } from '../state/snapshot';
import { t } from '../t';
import { isValidEntityRef, planDrop, type EntityRef } from './dnd-logic';
import { LatticeTreeItem } from './items';

/** 自定义拖拽 MIME：跨视图共享（ext host 全局 ITreeViewsDnDService 按拖拽会话传递）。 */
export const LATTICE_DND_MIME = 'application/vnd.lattice.entity';

/** 树项 → 可拖拽实体（仅任务/spec/项目；其余节点不可拖拽）。 */
export function entityRefFromItem(item: LatticeTreeItem | undefined): EntityRef | null {
  const payload = item?.lattice;
  switch (payload?.kind) {
    case 'task':
      return { kind: 'task', id: payload.taskId };
    case 'spec':
      return { kind: 'spec', id: payload.specId };
    case 'project':
      return { kind: 'project', id: payload.projectId };
    default:
      return null;
  }
}

/**
 * 跨视图拖拽联动：
 * - 任务（含多选）→ 项目节点：associate
 * - Spec → 任务节点：refSpec
 * 反向与其它组合不处理（给出一次性提示）。
 */
export class LatticeDragAndDropController implements vscode.TreeDragAndDropController<LatticeTreeItem> {
  readonly dragMimeTypes = [LATTICE_DND_MIME];
  readonly dropMimeTypes = [LATTICE_DND_MIME];

  constructor(
    private readonly data: LatticeDataService,
    private readonly snapshot: SnapshotStore,
  ) {}

  handleDrag(source: readonly LatticeTreeItem[], dataTransfer: vscode.DataTransfer): void {
    const refs = source
      .map((item) => entityRefFromItem(item))
      .filter((ref): ref is EntityRef => ref !== null);
    if (refs.length === 0) return;
    const unique = [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()];
    dataTransfer.set(LATTICE_DND_MIME, new vscode.DataTransferItem(JSON.stringify(unique)));
  }

  async handleDrop(
    target: LatticeTreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const raw = await dataTransfer.get(LATTICE_DND_MIME)?.asString();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const dragged = Array.isArray(parsed) ? parsed.filter(isValidEntityRef) : [];
    if (dragged.length === 0) return;

    const targetRef = entityRefFromItem(target);
    const plan = planDrop(targetRef, dragged);
    if (!plan) {
      // 实体间的不支持组合：给一次性提示（30s 去重）
      if (targetRef) {
        void showDeduped('info', t('Only "Task → Project" and "Spec → Task" drags are supported.'));
      }
      return;
    }

    try {
      if (plan.action === 'associate') {
        const failed: string[] = [];
        let done = 0;
        for (const taskId of plan.taskIds) {
          if (token.isCancellationRequested) break;
          try {
            await this.data.taskAssociate(taskId, { projectId: plan.projectId });
            done += 1;
          } catch (error) {
            failed.push(taskId);
            errorLog(`drop associate failed: ${taskId} → ${plan.projectId}`, error);
          }
        }
        await this.snapshot.invalidate(['tasks', 'projects']);
        const projectName = this.snapshot.findProject(plan.projectId)?.name || plan.projectId;
        if (failed.length === 0) {
          void showDeduped('info', t('Associated {0} task(s) with "{1}".', done, projectName));
        } else {
          const showLogs = t('Show Logs');
          const picked = await showDeduped(
            'warn',
            t(
              'Batch update finished: {0} updated, {1} failed, {2} skipped.',
              done,
              failed.length,
              0,
            ),
            showLogs,
          );
          if (picked === showLogs) void vscode.commands.executeCommand('lattice.logs.show');
        }
        return;
      }

      // refSpec
      await this.data.taskRefSpec(plan.taskId, plan.specIds);
      await this.snapshot.invalidate(['tasks']);
      const taskTitle = this.snapshot.taskById(plan.taskId)?.title ?? plan.taskId;
      void showDeduped('info', t('Referenced {0} from "{1}".', plan.specIds.join(', '), taskTitle));
    } catch (error) {
      errorLog('drop handling failed', error);
      void showDeduped(
        'warn',
        t('Drag and drop failed: {0}', error instanceof Error ? error.message : String(error)),
      );
    }
  }
}
